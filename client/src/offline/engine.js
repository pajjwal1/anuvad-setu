// Main-thread client for the on-device translation worker.
import { planOffline, bundlesNeeded } from '../lib/languages.js';
import { segmentText, assemble } from '../lib/chunk.js';
import { getInstalledBundles, ensureOrtCached } from './store.js';

let worker;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./translator.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      if (data.type === 'progress' || data.type === 'status') p.onEvent?.(data);
      else {
        pending.delete(data.id);
        if (data.type === 'error') {
          const err = new Error(data.message);
          if (data.cancelled) err.name = 'AbortError';
          p.reject(err);
        } else p.resolve(data);
      }
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'The offline engine crashed. Please try again.'));
      pending.clear();
      worker.terminate();
      worker = undefined;
    };
  }
  return worker;
}

function call(message, { onEvent, signal } = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject, onEvent });
    signal?.addEventListener('abort', () => getWorker().postMessage({ id: ++seq, type: 'cancel', target: id }), { once: true });
    getWorker().postMessage({ id, ...message });
  });
}

/** Steps for source->target with the bundles installed on this device, or null. */
export const planFor = (source, target, installed = getInstalledBundles()) => planOffline(source, target, installed);

export const canTranslateOffline = (source, target, installed) => source === target || !!planFor(source, target, installed);

/** Human hint for "what do I need to download to translate source->target offline". */
export function offlineHint(source, target) {
  const need = bundlesNeeded(source, target);
  if (!need) return 'Offline translation is available for the 22 Indian languages, English and the world languages listed under menu → Offline.';
  return 'Download the offline language packs (menu → Offline) while you are online to translate this offline.';
}

export async function translateOffline(text, source, target, { signal, onStatus } = {}) {
  if (source === target) return text;
  const steps = planFor(source, target);
  if (!steps) throw new Error(offlineHint(source, target));
  if (navigator.onLine) await ensureOrtCached(); // repairs installs made before the runtime was stored for offline use
  const segments = segmentText(text, 200);
  const chunks = segments.filter((s) => 'chunk' in s).map((s) => s.chunk);
  const { translations } = await call({ type: 'translate', chunks, steps }, { onEvent: onStatus, signal });
  return assemble(segments, translations);
}

export const unloadEngine = () => (worker ? call({ type: 'unload' }).catch(() => {}) : Promise.resolve());
