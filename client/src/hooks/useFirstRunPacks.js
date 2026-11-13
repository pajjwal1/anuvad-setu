import { useCallback, useEffect, useRef, useState } from 'react';
import { bundleBytes, countryFromLocale, downloadPolicy, regionForCountry } from '../lib/region.js';
import { downloadBundle, estimateStorage, getInstalledBundles, refreshInstalled } from '../offline/store.js';

const FLAG = 'anuvadsetu.firstrun.v1';
/** True when we must not offer anything again. 'done' is re-checked against the real cache (browsers can evict it). */
const flagged = () => {
  try {
    const v = localStorage.getItem(FLAG);
    return !!v && v !== 'done';
  } catch {
    return true; // storage unavailable: do not loop on every visit
  }
};
const setFlag = (v) => {
  try {
    localStorage.setItem(FLAG, v);
  } catch {
    /* ignore */
  }
};

async function detectCountry() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3000);
    const r = await fetch('/api/region', { signal: ctl.signal });
    clearTimeout(t);
    const { country } = await r.json();
    if (country) return country;
  } catch {
    /* fall through to the browser's own hints */
  }
  return countryFromLocale({
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    languages: navigator.languages || [navigator.language],
  });
}

/**
 * First visit only: work out the visitor's region, then OFFER that region's packs. Nothing is ever downloaded
 * without the user choosing to (571 MB is their decision; online translation works without it).
 * Computers get one button for everything; phones and tablets (`choose`) pick which pack(s) to download.
 *
 * phase: idle | offer | downloading | done | error | blocked
 */
export function useFirstRunPacks({ online, onInstalled }) {
  const [state, setState] = useState({ phase: 'idle', region: null, progress: 0, reason: '', needBytes: 0, error: '' });
  const ctl = useRef(null);
  const ran = useRef(false);
  const missingRef = useRef([]);

  const start = useCallback(
    async (region, missing) => {
      missingRef.current = missing; // "Retry" repeats the same choice
      const need = bundleBytes(missing);
      const aborter = new AbortController();
      ctl.current = aborter;
      setState((s) => ({ ...s, phase: 'downloading', region, progress: 0, needBytes: need, error: '' }));
      try {
        await navigator.storage?.persist?.(); // ask the browser not to evict the models
        let doneBytes = 0;
        for (const id of missing) {
          const size = bundleBytes([id]);
          await downloadBundle(
            id,
            (p) => setState((s) => ({ ...s, progress: Math.min((doneBytes + p * size) / need, 0.999) })),
            aborter.signal,
            { onStatus: (note) => setState((s) => ({ ...s, note })) },
          );
          doneBytes += size;
        }
        const all = region.bundles.every((id) => getInstalledBundles().has(id));
        setFlag(all ? 'done' : 'chosen'); // 'chosen': they picked only some packs, so do not offer the rest again
        setState((s) => ({ ...s, phase: 'done', progress: 1, partial: !all }));
        onInstalled?.();
      } catch (err) {
        if (aborter.signal.aborted) setState((s) => ({ ...s, phase: 'offer', reason: 'Download paused.' }));
        else setState((s) => ({ ...s, phase: 'error', error: err.message || 'Download failed' }));
      }
    },
    [onInstalled],
  );

  useEffect(() => {
    if (ran.current || !online || flagged()) return;
    ran.current = true;
    (async () => {
      const country = await detectCountry();
      const region = regionForCountry(country);
      if (!region) {
        setFlag('no-region'); // nothing to offer for this country yet
        return;
      }
      const installed = await refreshInstalled(); // what is really in the cache, not just our note of it
      const missing = region.bundles.filter((id) => !installed.has(id));
      if (!missing.length) {
        setFlag('done');
        return;
      }
      missingRef.current = missing;
      const needBytes = bundleBytes(missing);
      const storage = await estimateStorage();
      const c = navigator.connection || {};
      const coarse = !!window.matchMedia?.('(pointer: coarse)').matches; // phone / tablet
      const policy = downloadPolicy({
        saveData: c.saveData,
        type: c.type,
        effectiveType: c.effectiveType,
        coarsePointer: coarse,
        freeBytes: storage ? storage.quota - storage.usage : null,
        needBytes,
      });
      // Not flagged when blocked: someone who frees up space is offered the packs again on the next visit.
      if (policy.blocked) {
        setState({ phase: 'blocked', region, progress: 0, reason: policy.reason, needBytes, error: '', level: policy.level });
      } else {
        setState({ phase: 'offer', region, progress: 0, reason: policy.reason, needBytes, error: '', level: policy.level, choose: coarse, missing });
      }
    })();
  }, [online, start]);

  return {
    ...state,
    // accept() = every missing pack; accept(['en-indic']) = just those. (An onClick event is not an array.)
    accept: (ids) => start(state.region, Array.isArray(ids) ? ids : missingRef.current),
    cancel: () => ctl.current?.abort(),
    dismiss: () => {
      ctl.current?.abort();
      setFlag('dismissed');
      setState((s) => ({ ...s, phase: 'idle' }));
    },
    close: () => setState((s) => ({ ...s, phase: 'idle' })),
  };
}
