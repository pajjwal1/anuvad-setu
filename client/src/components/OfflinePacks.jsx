import { useEffect, useRef, useState } from 'react';
import { BUNDLES, downloadBundle, estimateStorage, getInstalledBundles, refreshInstalled, removeBundle } from '../offline/store.js';
import { unloadEngine } from '../offline/engine.js';
import { REGIONS, bundleBytes, storageLevel } from '../lib/region.js';

const fmtBytes = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);

const ORDER = [
  { id: 'en-indic', why: 'Translate from English into any of the 22 Indian languages.' },
  { id: 'indic-en', why: 'Translate from any Indian language into English.' },
  { id: 'indic-indic', why: 'Translate directly between Indian languages (e.g. Tamil to Hindi). Without it, those go via English and need both packs above.' },
];

export default function OfflinePacks({ online, onClose, onChange }) {
  const [installed, setInstalled] = useState(getInstalledBundles);
  const [busy, setBusy] = useState({}); // id -> 0..1
  const [errors, setErrors] = useState({});
  const [notes, setNotes] = useState({}); // id -> "preparing on the server" message (phones and tablets)
  const [storage, setStorage] = useState(null);
  const aborts = useRef({});

  useEffect(() => {
    refreshInstalled().then((s) => {
      setInstalled(s);
      onChange?.(s);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    estimateStorage().then(setStorage);
  }, [installed]);

  // Free space the browser reports (quota minus usage). Packs already installed are inside "usage".
  const free = storage ? storage.quota - storage.usage : null;
  const missing = REGIONS.IN.bundles.filter((id) => !installed.has(id));
  const recommended = missing.length ? storageLevel(free, bundleBytes(missing)) : { level: 'ok', message: '' };
  const packLevel = (id) => storageLevel(free, BUNDLES[id].size);

  const sync = (s) => {
    setInstalled(s);
    onChange?.(s);
  };

  const install = async (id) => {
    setErrors((e) => ({ ...e, [id]: '' }));
    setBusy((b) => ({ ...b, [id]: 0 }));
    const ctl = new AbortController();
    aborts.current[id] = ctl;
    try {
      await navigator.storage?.persist?.(); // ask the browser not to evict the models
      await downloadBundle(id, (p) => setBusy((b) => ({ ...b, [id]: p })), ctl.signal, {
        onStatus: (note) => setNotes((n) => ({ ...n, [id]: note })),
      });
      sync(getInstalledBundles());
    } catch (err) {
      if (!ctl.signal.aborted) setErrors((e) => ({ ...e, [id]: err.message || 'Download failed' }));
    } finally {
      delete aborts.current[id];
      setBusy((b) => {
        const { [id]: _, ...rest } = b;
        return rest;
      });
    }
  };

  const cancel = (id) => aborts.current[id]?.abort();

  const remove = async (id) => {
    await unloadEngine();
    await removeBundle(id);
    sync(getInstalledBundles());
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Offline language packs" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>Offline language packs</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <p className="muted">
          Download once while online. After that Anuvad Setu translates the 22 Indian languages and English with no internet,
          and nothing you type leaves your device.
        </p>
        {storage && (
          <p className="muted small">
            Storage used by this app: {fmtBytes(storage.usage)} of {fmtBytes(storage.quota)} available.
          </p>
        )}
        {recommended.level !== 'ok' && recommended.level !== 'unknown' && (
          <p className={`storage-warn ${recommended.level}`} role="alert" data-testid="storage-warning" data-level={recommended.level}>
            ⚠ {recommended.message}
          </p>
        )}
        <ul className="pack-list">
          {ORDER.map(({ id, why }) => {
            const b = BUNDLES[id];
            const has = installed.has(id);
            const progress = busy[id];
            const downloading = progress !== undefined;
            return (
              <li key={id} className="pack" data-testid={`pack-${id}`}>
                <div className="pack-info">
                  <strong>{b.label}</strong>
                  <span className="muted small">
                    {why} · {fmtBytes(b.size)}
                  </span>
                  {downloading && (
                    <div className="bar" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                      <span style={{ width: `${Math.round(progress * 100)}%` }} />
                    </div>
                  )}
                  {downloading && notes[id] && <span className="muted small">{notes[id]}</span>}
                  {errors[id] && <span className="error small">{errors[id]}</span>}
                  {!has && !downloading && packLevel(id).level === 'critical' && (
                    <span className="error small">Not enough free storage: offline translation would not work.</span>
                  )}
                </div>
                {has ? (
                  <button className="btn ghost" onClick={() => remove(id)}>
                    Remove
                  </button>
                ) : downloading ? (
                  <button className="btn ghost" onClick={() => cancel(id)}>
                    {Math.round(progress * 100)}% · Cancel
                  </button>
                ) : (
                  <button className="btn" onClick={() => install(id)} disabled={!online || packLevel(id).level === 'critical'}>
                    {!online ? 'Needs internet' : packLevel(id).level === 'low' ? 'Download anyway' : 'Download'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <p className="muted small">
          Recommended: English → Indian + Indian → English (about {fmtBytes(BUNDLES['en-indic'].size + BUNDLES['indic-en'].size)}).
          If a download is interrupted, tap Download again and it continues from the last finished file. On-device quality is
          a little below the online engine and best for short, clear sentences.
        </p>
      </div>
    </div>
  );
}
