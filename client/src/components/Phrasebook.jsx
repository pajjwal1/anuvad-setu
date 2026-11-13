import { useEffect, useRef, useState } from 'react';
import { PHRASE_CATEGORIES, phraseKey } from '../lib/phrases.js';
import { BY_CODE, isRtl } from '../lib/languages.js';
import { romanize } from '../lib/romanize.js';
import { translate } from '../lib/translate.js';
import { canSpeak, speak } from '../hooks/useSpeech.js';
import LanguageSelect from './LanguageSelect.jsx';

function Roman({ text, lang }) {
  const l = BY_CODE[lang];
  const r = l?.script ? romanize(text, l.script, lang) : null;
  return r ? <span className="roman">{r}</span> : null;
}

/** Large, high-contrast card to hold up to someone. */
function ShowCard({ phrase, onClose, privateMode }) {
  return (
    <div className="show-card" role="dialog" aria-modal="true" aria-label="Show to someone" onClick={onClose}>
      <div className="show-text" dir={isRtl(phrase.lang) ? 'rtl' : 'auto'} lang={phrase.lang}>
        {phrase.result}
      </div>
      <div className="show-sub">{phrase.text}</div>
      <div className="show-actions">
        {canSpeak() && (
          <button
            className="btn"
            onClick={(e) => {
              e.stopPropagation();
              speak(phrase.result, BY_CODE[phrase.lang]?.speech || phrase.lang, { localOnly: privateMode });
            }}
          >
            🔊 Speak
          </button>
        )}
        <button className="btn ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

export default function Phrasebook({ lang, onLang, recents, privateMode, phrasebook, setPhrasebook, onClose }) {
  const [tab, setTab] = useState(PHRASE_CATEGORIES[0].id);
  const [show, setShow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const runId = useRef(0);

  const category = PHRASE_CATEGORIES.find((c) => c.id === tab);
  const list =
    tab === 'saved'
      ? phrasebook.saved.map((s) => ({ id: s.id, text: s.text, saved: true, result: s.result, dstLang: s.target }))
      : category.phrases.map((text) => ({
          id: text,
          text,
          result: lang === 'en' ? text : phrasebook.cache[phraseKey(lang, text)],
          dstLang: lang,
        }));

  // Translate the category's missing phrases one by one (the on-device engine is single-threaded).
  useEffect(() => {
    if (tab === 'saved' || lang === 'en') return undefined;
    const missing = category.phrases.filter((t) => !phrasebook.cache[phraseKey(lang, t)]);
    if (!missing.length) return undefined;
    const id = ++runId.current;
    const ctl = new AbortController();
    (async () => {
      setBusy(true);
      setError('');
      try {
        for (const text of missing) {
          if (id !== runId.current) return;
          const r = await translate({ text, source: 'en', target: lang, privateMode, signal: ctl.signal });
          if (id !== runId.current) return;
          setPhrasebook((p) => ({ ...p, cache: { ...p.cache, [phraseKey(lang, text)]: r.text } }));
        }
      } catch (err) {
        if (id === runId.current && err.name !== 'AbortError') setError(err.message);
      } finally {
        if (id === runId.current) setBusy(false);
      }
    })();
    return () => {
      ctl.abort();
      runId.current++;
      setBusy(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, lang, privateMode]);

  const removeSaved = (id) => setPhrasebook((p) => ({ ...p, saved: p.saved.filter((s) => s.id !== id) }));

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Phrasebook" onClick={onClose}>
      <div className="sheet tall" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>Phrasebook</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="lang-bar">
          <LanguageSelect label="Phrase language" value={lang} onChange={onLang} recents={recents} deviceOnly={privateMode} />
        </div>
        <div className="tabs" role="tablist">
          {[...PHRASE_CATEGORIES, { id: 'saved', name: `Saved (${phrasebook.saved.length})` }].map((c) => (
            <button key={c.id} role="tab" aria-selected={tab === c.id} className={`tab ${tab === c.id ? 'on' : ''}`} onClick={() => setTab(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
        {busy && <p className="muted small">Translating phrases…</p>}
        {error && <p className="error small">{error}</p>}
        <ul className="phrase-list">
          {list.map((p) => (
            <li key={p.id} className="phrase">
              <div className="phrase-main">
                <div className="muted small">{p.text}</div>
                {p.result ? (
                  <>
                    <div className="phrase-out" dir={isRtl(p.dstLang) ? 'rtl' : 'auto'} lang={p.dstLang}>
                      {p.result}
                    </div>
                    <Roman text={p.result} lang={p.dstLang} />
                  </>
                ) : (
                  <div className="muted">…</div>
                )}
              </div>
              <div className="tools">
                {p.result && (
                  <button className="btn small-btn" onClick={() => setShow({ text: p.text, result: p.result, lang: p.dstLang })}>
                    Show
                  </button>
                )}
                {p.saved && (
                  <button className="icon-btn" onClick={() => removeSaved(p.id)} aria-label="Remove from saved">
                    🗑
                  </button>
                )}
              </div>
            </li>
          ))}
          {tab === 'saved' && list.length === 0 && (
            <li className="muted">Nothing saved yet. Use "Save phrase" under any translation.</li>
          )}
        </ul>
        <p className="muted small">
          Phrases are translated once and then kept on this device, so they work offline. Use Show to display large text
          to someone.
        </p>
      </div>
      {show && <ShowCard phrase={show} privateMode={privateMode} onClose={() => setShow(null)} />}
    </div>
  );
}
