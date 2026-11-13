import { useCallback, useRef, useState } from 'react';
import { BY_CODE, isRtl } from '../lib/languages.js';
import { translate } from '../lib/translate.js';
import { canListen, canSpeak, speak, useDictation } from '../hooks/useSpeech.js';
import LanguageSelect from './LanguageSelect.jsx';

/**
 * Face-to-face mode. The screen is split in two; the top half is rotated 180° so the person opposite can
 * read and type on their side. Each half shows every message in that person's own language.
 */
function Side({ side, lang, onLang, recents, privateMode, messages, onSend, busy, autoSpeak, flipped, online }) {
  const [draft, setDraft] = useState('');
  const dictation = useDictation(
    BY_CODE[lang]?.speech || 'en-US',
    useCallback((t) => onSend(t, side), [onSend, side]),
  );
  const submit = (e) => {
    e.preventDefault();
    const v = draft.trim();
    if (!v) return;
    setDraft('');
    onSend(v, side);
  };
  const voiceOk = canListen && online && !privateMode;
  return (
    <section className={`conv-side ${flipped ? 'flipped' : ''}`} data-testid={`conv-${side}`}>
      <LanguageSelect label={`${side === 'top' ? 'Top' : 'Bottom'} person's language`} value={lang} onChange={onLang} recents={recents} deviceOnly={privateMode} />
      <ul className="conv-log" aria-live="polite">
        {messages.length === 0 && <li className="muted small">Type or speak in {BY_CODE[lang]?.name}.</li>}
        {messages.map((m) => {
          const mine = m.from === side;
          const text = mine ? m.original : m.translated;
          const l = mine ? lang : lang;
          return (
            <li key={m.id} className={`conv-msg ${mine ? 'mine' : 'theirs'}`} dir={isRtl(l) ? 'rtl' : 'auto'} lang={l}>
              {text}
            </li>
          );
        })}
        {busy && <li className="muted small">Translating…</li>}
      </ul>
      <form className="conv-input" onSubmit={submit}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Type in ${BY_CODE[lang]?.name}`}
          aria-label={`${side} message`}
          dir={isRtl(lang) ? 'rtl' : 'auto'}
        />
        {voiceOk && (
          <button
            type="button"
            className={`icon-btn ${dictation.listening ? 'active' : ''}`}
            onClick={dictation.listening ? dictation.stop : dictation.start}
            aria-label="Speak"
          >
            🎤
          </button>
        )}
        <button className="btn" type="submit" disabled={!draft.trim()}>
          Send
        </button>
      </form>
      {dictation.error && <div className="error small">{dictation.error}</div>}
    </section>
  );
}

export default function Conversation({ langs, onLangs, recents, privateMode, online, onClose }) {
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(null); // side that is waiting for a translation
  const [error, setError] = useState('');
  const [autoSpeak, setAutoSpeak] = useState(true);
  const seq = useRef(0);
  const queue = useRef(Promise.resolve());
  const { top, bottom } = langs;

  const onSend = useCallback(
    (text, side) => {
      const from = side === 'top' ? top : bottom;
      const to = side === 'top' ? bottom : top;
      // Translations share the single on-device engine, so messages are processed in order.
      queue.current = queue.current.then(async () => {
        setBusy(side);
        setError('');
        try {
          const r = from === to ? { text } : await translate({ text, source: from, target: to, privateMode });
          const msg = { id: ++seq.current, from: side, original: text, translated: r.text };
          setMessages((m) => [...m.slice(-19), msg]);
          if (autoSpeak && canSpeak()) speak(r.text, BY_CODE[to]?.speech || to, { localOnly: privateMode });
        } catch (err) {
          setError(err.message || 'Translation failed.');
        } finally {
          setBusy(null);
        }
      });
    },
    [top, bottom, privateMode, autoSpeak],
  );

  const common = { recents, privateMode, messages, onSend, autoSpeak, online };
  return (
    <div className="conversation" role="dialog" aria-modal="true" aria-label="Conversation mode">
      <Side side="top" flipped lang={top} onLang={(c) => onLangs({ top: c, bottom })} busy={busy === 'bottom'} {...common} />
      <div className="conv-bar">
        <button className="btn ghost small-btn" onClick={onClose}>
          ✕ Close
        </button>
        <label className="small">
          <input type="checkbox" checked={autoSpeak} onChange={(e) => setAutoSpeak(e.target.checked)} /> Speak translations
        </label>
        <button className="btn ghost small-btn" onClick={() => setMessages([])}>
          Clear
        </button>
        {error && <span className="error small">{error}</span>}
      </div>
      <Side side="bottom" lang={bottom} onLang={(c) => onLangs({ top, bottom: c })} busy={busy === 'top'} {...common} />
    </div>
  );
}
