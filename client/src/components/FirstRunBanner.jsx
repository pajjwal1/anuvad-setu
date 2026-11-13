import { BUNDLES } from '../offline/store.js';

const mb = (n) => `${Math.round(n / 1e6)} MB`;

/** First-visit banner: offers / shows progress of the region's offline packs. */
export default function FirstRunBanner({ run, onOpenPacks }) {
  const { phase, region, progress, reason, needBytes, error, level, note, choose, missing, partial } = run;
  if (phase === 'idle') return null;
  const pct = Math.round(progress * 100);
  const warn = phase === 'blocked' || level === 'low';
  return (
    <div className={`banner first-run ${warn ? 'warn' : ''}`} role="status" data-testid="first-run" data-phase={phase} data-level={level || ''}>
      {phase === 'offer' && (
        <>
          <span>
            {level === 'low' ? '⚠ ' : ''}
            {choose && missing?.length > 1
              ? 'Use Anuvad Setu without internet? Choose what to download (one time, kept on this device). '
              : `Use Anuvad Setu without internet? Download ${region.languages} (${mb(needBytes)}, one time). `}
            {reason}
          </span>
          {choose && missing?.length > 1 ? (
            <>
              {missing.map((id) => (
                <button key={id} className="btn small-btn" data-testid={`choose-${id}`} onClick={() => run.accept([id])}>
                  {BUNDLES[id].label} · {mb(BUNDLES[id].size)}
                </button>
              ))}
              <button className="btn small-btn" data-testid="choose-all" onClick={() => run.accept()}>
                Both · {mb(needBytes)}
              </button>
            </>
          ) : (
            <button className="btn small-btn" onClick={() => run.accept()}>
              {level === 'low' ? 'Download anyway' : 'Download'} {mb(needBytes)}
            </button>
          )}
          <button className="link" onClick={run.dismiss}>
            Not now
          </button>
        </>
      )}
      {phase === 'downloading' && (
        <>
          <span>
            Downloading offline packs for {region.name}… {pct}% · keep this page open
            {note ? ` · ${note}` : ''}
          </span>
          <div className="bar wide" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <button className="link" onClick={run.cancel}>
            Pause
          </button>
        </>
      )}
      {phase === 'done' && (
        <>
          <span>
            {partial
              ? '✓ Ready offline for the pack you chose. You can add the other one any time from Offline.'
              : `✓ Ready offline: ${region.languages}. You can now translate without internet.`}
          </span>
          <button className="link" onClick={run.close}>
            OK
          </button>
        </>
      )}
      {phase === 'error' && (
        <>
          <span>Offline download stopped: {error}</span>
          <button className="link" onClick={() => run.accept()}>
            Retry
          </button>
          <button className="link" onClick={onOpenPacks}>
            Manage packs
          </button>
        </>
      )}
      {phase === 'blocked' && (
        <>
          <span>⚠ {reason}</span>
          <button className="link" onClick={onOpenPacks}>
            Manage packs
          </button>
          <button className="link" onClick={run.close}>
            Dismiss
          </button>
        </>
      )}
    </div>
  );
}
