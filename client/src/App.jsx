import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LanguageSelect from './components/LanguageSelect.jsx';
import OfflinePacks from './components/OfflinePacks.jsx';
import History from './components/History.jsx';
import Phrasebook from './components/Phrasebook.jsx';
import Conversation from './components/Conversation.jsx';
import FirstRunBanner from './components/FirstRunBanner.jsx';
import { useFirstRunPacks } from './hooks/useFirstRunPacks.js';
import { BY_CODE, OFFLINE_WORLD_CODES, detectLanguage, isRtl, langName } from './lib/languages.js';
import { romanize } from './lib/romanize.js';
import { translate } from './lib/translate.js';
import { getInstalledBundles, refreshInstalled } from './offline/store.js';
import {
  loadHistory,
  loadPhrasebook,
  loadSettings,
  pushHistory,
  saveHistory,
  savePhrasebook,
  saveSettings,
  setPrivateSession,
} from './lib/storage.js';
import { useOnline, usePwa } from './hooks/usePwa.js';
import { canListen, canSpeak, speak, useDictation } from './hooks/useSpeech.js';

const MAX_CHARS = 5000;
const DEBOUNCE_MS = 700;

export default function App() {
  const online = useOnline();
  const pwa = usePwa();

  const [settings, setSettings] = useState(loadSettings);
  const { source, target, theme, recents } = settings;
  const [text, setText] = useState('');
  const [result, setResult] = useState(null); // { text, source, detected, engine }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState(loadHistory);
  const [panel, setPanel] = useState(null); // 'offline' | 'history' | 'phrasebook' | 'conversation'
  const [copied, setCopied] = useState(false);
  const [packsVersion, setPacksVersion] = useState(0);
  const [status, setStatus] = useState('');
  const [phrasebook, setPhrasebook] = useState(loadPhrasebook);
  const [convLangs, setConvLangs] = useState({ top: 'en', bottom: 'hi' });
  const requestId = useRef(0);
  const abortRef = useRef(null);
  const inputRef = useRef(null);
  const { privateMode } = settings;
  const firstRun = useFirstRunPacks({ online, onInstalled: useCallback(() => setPacksVersion((v) => v + 1), []) });

  const update = (patch) => setSettings((s) => ({ ...s, ...patch }));
  // Normal mode saves to localStorage. Private mode saves to sessionStorage, which the browser erases when the
  // tab (or the installed app window) is closed.
  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveHistory(history, privateMode), [history, privateMode]);
  useEffect(() => savePhrasebook(phrasebook, privateMode), [phrasebook, privateMode]);
  // The browser may evict cached models; re-check what is really installed at startup.
  useEffect(() => {
    refreshInstalled().then(() => setPacksVersion((v) => v + 1));
  }, []);

  // Private mode only works with on-device languages.
  const togglePrivate = () => {
    const next = !privateMode;
    setPrivateSession(next); // turning it off erases everything kept for the private session
    if (next) {
      const fix = {};
      if (BY_CODE[source]?.group === 'world' && !OFFLINE_WORLD_CODES.has(source)) fix.source = 'auto';
      if (BY_CODE[target]?.group === 'world' && !OFFLINE_WORLD_CODES.has(target)) fix.target = 'hi';
      update({ privateMode: true, ...fix });
    } else {
      // Back to the normal data; private-session language "recents" are dropped with the rest.
      setSettings((s) => ({ ...s, privateMode: false, recents: loadSettings(false).recents }));
    }
    setHistory(loadHistory(next));
    setPhrasebook(loadPhrasebook(next));
    setResult(null);
    setText('');
    setError('');
  };

  // Theme
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (new URLSearchParams(location.search).has('focus')) inputRef.current?.focus();
  }, []);

  const detected = source === 'auto' ? (result?.detected ?? null) : null;
  const srcLang = source === 'auto' ? detected : source;

  const rememberLang = (code) =>
    setSettings((s) => ({ ...s, recents: [code, ...s.recents.filter((c) => c !== code)].slice(0, 4) }));

  const run = useCallback(
    async (value, src, tgt, priv, fmt) => {
      const id = ++requestId.current;
      abortRef.current?.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;
      setLoading(true);
      setError('');
      setStatus('');
      try {
        const r = await translate({
          text: value,
          source: src,
          target: tgt,
          privateMode: priv,
          indianFormat: fmt,
          signal: ctl.signal,
          onStatus: (e) => e.type === 'status' && id === requestId.current && setStatus(e.message),
        });
        if (id !== requestId.current) return; // a newer request superseded this one
        setResult(r);
        setHistory((h) => pushHistory(h, { text: value, result: r.text, source: r.source || src, target: tgt }));
      } catch (err) {
        if (id !== requestId.current || err.name === 'AbortError') return;
        setResult(null);
        setError(err.message || 'Translation failed.');
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setStatus('');
        }
      }
    },
    [],
  );

  // Auto-translate while typing (debounced).
  useEffect(() => {
    const value = text.trim();
    if (!value) {
      requestId.current++;
      abortRef.current?.abort();
      setResult(null);
      setError('');
      setLoading(false);
      return;
    }
    if (source !== 'auto' && source === target) {
      requestId.current++;
      abortRef.current?.abort();
      setLoading(false);
      setError('');
      setResult({ text, source, detected: null, engine: 'none' });
      return;
    }
    const t = setTimeout(() => run(value, source, target, privateMode, settings.indianFormat), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, source, target, run, packsVersion, privateMode, settings.indianFormat]);

  const swap = () => {
    const from = source === 'auto' ? (result?.detected ?? detectLanguage(text)) : source;
    if (!from) {
      setError('Pick a source language first (it could not be detected).');
      return;
    }
    const nextText = result?.text && result.engine !== 'none' ? result.text : text;
    setText(nextText);
    update({ source: target, target: from });
  };

  const onSourceChange = (code) => {
    if (code !== 'auto') rememberLang(code);
    update({ source: code });
  };
  const onTargetChange = (code) => {
    rememberLang(code);
    update({ target: code });
  };

  const copy = async () => {
    if (!result?.text) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy to clipboard.');
    }
  };

  const share = async () => {
    if (!result?.text) return;
    if (navigator.share) {
      try {
        await navigator.share({ text: result.text });
      } catch {
        /* user cancelled */
      }
    } else copy();
  };

  const dictation = useDictation(
    BY_CODE[source === 'auto' ? 'en' : source]?.speech || 'en-US',
    useCallback((t) => setText((prev) => (prev ? `${prev} ${t}` : t)), []),
  );

  const nextTheme = { system: 'light', light: 'dark', dark: 'system' }[theme];
  const outRtl = isRtl(target);
  const inRtl = isRtl(srcLang);

  const romanOf = (value, lang) => {
    const l = BY_CODE[lang];
    return value && l?.script ? romanize(value, l.script, lang) : null;
  };
  const outRoman = useMemo(() => (settings.romanize ? romanOf(result?.text, target) : null), [result, target, settings.romanize]);
  const inRoman = useMemo(() => (settings.romanize ? romanOf(text, srcLang) : null), [text, srcLang, settings.romanize]);

  const savePhrase = () => {
    if (!result?.text) return;
    setPhrasebook((p) => ({
      ...p,
      saved: [
        { id: Date.now(), text, result: result.text, source: result.source || srcLang || source, target },
        ...p.saved.filter((s) => !(s.text === text && s.target === target)),
      ],
    }));
    setCopied('saved');
    setTimeout(() => setCopied(false), 1500);
  };

  const openHistoryItem = (h) => {
    setText(h.text);
    update({ source: h.source, target: h.target });
    setPanel(null);
  };

  return (
    <div className="app">
      <FirstRunBanner run={firstRun} onOpenPacks={() => setPanel('offline')} />
      {privateMode && (
        <div className="banner private" role="status" data-testid="private-badge">
          🔒 Private mode: your text is translated on this device only and is not sent anywhere. History and saved phrases are kept for this session only and erased when you close this tab or app.
        </div>
      )}
      {!online && !privateMode && (
        <div className="banner offline" role="status">
          You're offline. Translation uses downloaded language packs.
          <button className="link" onClick={() => setPanel('offline')}>
            Manage packs
          </button>
        </div>
      )}
      {pwa.needRefresh && (
        <div className="banner info" role="status">
          A new version is available.
          <button className="link" onClick={pwa.applyUpdate}>
            Update
          </button>
          <button className="link" onClick={pwa.dismissUpdate}>
            Later
          </button>
        </div>
      )}
      {pwa.offlineReady && (
        <div className="banner info" role="status">
          The app is ready to open offline. Download a language pack to translate offline.
          <button className="link" onClick={() => setPanel('offline')}>
            Get packs
          </button>
          <button className="link" onClick={pwa.dismissOfflineReady}>
            Dismiss
          </button>
        </div>
      )}
      {pwa.showIosHint && (
        <div className="banner info">To install on iPhone/iPad: tap Share, then "Add to Home Screen".</div>
      )}

      <header className="topbar">
        <div className="brand">
          <img src="/icon.svg" alt="" width="28" height="28" />
          <h1>Anuvad Setu</h1>
          {!online && <span className="pill">Offline</span>}
        </div>
        <nav className="actions">
          {pwa.canInstall && (
            <button className="btn small-btn" onClick={pwa.install}>
              Install app
            </button>
          )}
          <button
            className={`btn ghost small-btn ${privateMode ? 'on' : ''}`}
            onClick={togglePrivate}
            aria-pressed={privateMode}
            title="Private mode: on-device only, nothing saved"
          >
            🔒 Private
          </button>
          <button className="btn ghost small-btn" onClick={() => setPanel('conversation')}>
            Talk
          </button>
          <button className="btn ghost small-btn" onClick={() => setPanel('phrasebook')}>
            Phrases
          </button>
          <button className="btn ghost small-btn" onClick={() => setPanel('offline')}>
            Offline
          </button>
          <button className="btn ghost small-btn" onClick={() => setPanel('history')}>
            History
          </button>
          <button
            className={`btn ghost small-btn ${settings.indianFormat ? 'on' : ''}`}
            onClick={() => update({ indianFormat: !settings.indianFormat })}
            aria-pressed={settings.indianFormat}
            title="Indian number format: lakh/crore grouping, ₹ and DD/MM/YYYY dates"
          >
            ₹ 1,00,000
          </button>
          <button
            className="icon-btn"
            onClick={() => update({ theme: nextTheme })}
            aria-label={`Theme: ${theme}. Switch to ${nextTheme}`}
            title={`Theme: ${theme}`}
          >
            {theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥'}
          </button>
        </nav>
      </header>

      <main className="translator">
        <div className="lang-bar">
          <LanguageSelect
            label="Translate from"
            value={source}
            onChange={onSourceChange}
            recents={recents}
            withAuto
            detected={detected}
            deviceOnly={privateMode}
          />
          <button className="icon-btn swap" onClick={swap} aria-label="Swap languages" title="Swap languages">
            ⇄
          </button>
          <LanguageSelect label="Translate to" value={target} onChange={onTargetChange} recents={recents} deviceOnly={privateMode} />
        </div>

        <div className="panes">
          <section className="pane">
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
              placeholder="Enter text to translate"
              aria-label="Text to translate"
              dir={inRtl ? 'rtl' : 'auto'}
              lang={srcLang || undefined}
              spellCheck="false"
            />
            <footer className="pane-foot">
              <div className="tools">
                {canListen && !privateMode && (
                  <button
                    className={`icon-btn ${dictation.listening ? 'active' : ''}`}
                    onClick={dictation.listening ? dictation.stop : dictation.start}
                    aria-label={dictation.listening ? 'Stop voice input' : 'Voice input'}
                    aria-pressed={dictation.listening}
                    disabled={!online}
                    title={online ? 'Voice input' : 'Voice input needs internet'}
                  >
                    🎤
                  </button>
                )}
                {canSpeak() && (
                  <button
                    className="icon-btn"
                    onClick={() => speak(text, BY_CODE[srcLang || 'en']?.speech || 'en-US', { localOnly: privateMode })}
                    aria-label="Listen to source text"
                    disabled={!text}
                  >
                    🔊
                  </button>
                )}
                {text && (
                  <button className="icon-btn" onClick={() => setText('')} aria-label="Clear text">
                    ✕
                  </button>
                )}
              </div>
              <span className="muted small">
                {text.length}/{MAX_CHARS}
              </span>
            </footer>
            {inRoman && (
              <div className="roman-line" data-testid="roman-in">
                {inRoman}
              </div>
            )}
            {dictation.error && <div className="error small pad">{dictation.error}</div>}
          </section>

          <section className="pane output" aria-live="polite">
            <div className={`result ${loading ? 'dim' : ''}`} dir={outRtl ? 'rtl' : 'auto'} lang={target}>
              {result?.text ? (
                result.text
              ) : error ? (
                <span className="error">{error}</span>
              ) : loading ? (
                <span className="muted">Translating…</span>
              ) : (
                <span className="muted">Translation</span>
              )}
            </div>
            {outRoman && (
              <div className="roman-line" data-testid="roman-out">
                {outRoman}
              </div>
            )}
            {loading && status && <div className="muted small pad">{status}</div>}
            <footer className="pane-foot">
              <div className="tools">
                {canSpeak() && (
                  <button
                    className="icon-btn"
                    onClick={() => speak(result.text, BY_CODE[target]?.speech || target, { localOnly: privateMode })}
                    aria-label="Listen to translation"
                    disabled={!result?.text}
                  >
                    🔊
                  </button>
                )}
                <button className="icon-btn" onClick={copy} aria-label="Copy translation" disabled={!result?.text}>
                  {copied === true ? '✓' : '📋'}
                </button>
                <button className="icon-btn" onClick={savePhrase} aria-label="Save phrase" title={privateMode ? 'Save for this private session only' : 'Save to phrasebook'} disabled={!result?.text || result.engine === 'none'}>
                  {copied === 'saved' ? '✓' : '⭐'}
                </button>
                <button className="icon-btn" onClick={share} aria-label="Share translation" disabled={!result?.text}>
                  ↗
                </button>
              </div>
              {result?.engine && result.engine !== 'none' && (
                <span className="muted small">
                  {result.engine === 'offline' ? 'Translated on this device' : 'Translated online'}
                  {loading ? ' · updating…' : ''}
                </span>
              )}
            </footer>
          </section>
        </div>

        {detected && (
          <p className="muted small hint">
            Detected {langName(detected)}.{' '}
            <button className="link" onClick={() => update({ source: detected })}>
              Use {langName(detected)} as source
            </button>
          </p>
        )}
      </main>

      <footer className="site-foot muted small">
        Anuvad Setu · अनुवाद सेतु · Works offline once installed · Your history stays on your device
      </footer>

      {panel === 'offline' && (
        <OfflinePacks online={online} onClose={() => setPanel(null)} onChange={() => setPacksVersion((v) => v + 1)} />
      )}
      {panel === 'phrasebook' && (
        <Phrasebook
          lang={settings.phraseLang || 'hi'}
          onLang={(c) => update({ phraseLang: c })}
          recents={recents}
          privateMode={privateMode}
          phrasebook={phrasebook}
          setPhrasebook={setPhrasebook}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'conversation' && (
        <Conversation
          langs={convLangs}
          onLangs={setConvLangs}
          recents={recents}
          privateMode={privateMode}
          online={online}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'history' && (
        <History
          items={history}
          onSelect={openHistoryItem}
          onToggleStar={(id) => setHistory((h) => h.map((x) => (x.id === id ? { ...x, starred: !x.starred } : x)))}
          onDelete={(id) => setHistory((h) => h.filter((x) => x.id !== id))}
          onClear={() => setHistory((h) => h.filter((x) => x.starred))}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  );
}
