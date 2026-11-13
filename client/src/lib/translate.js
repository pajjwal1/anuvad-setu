// Translation orchestrator.
//  - Normal mode : server API when online, on-device models when offline (or when the server fails).
//  - Private mode: on-device only. No request to /api is ever made.
import { detectLanguage, langName } from './languages.js';
import { formatIndian } from './indianFormat.js';
import { canTranslateOffline, offlineHint, translateOffline } from '../offline/engine.js';

const ONLINE_TIMEOUT_MS = 15_000;

async function translateOnline(text, source, target, outerSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ONLINE_TIMEOUT_MS);
  outerSignal?.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, source, target }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return {
      text: data.text,
      source: data.source,
      detected: data.detected ? data.detected.split('-')[0] : null,
      engine: 'online',
    };
  } finally {
    clearTimeout(timer);
  }
}

// Providers that translate Indian languages better than the on-device model. Without one of them, the
// installed model is the better choice for Indian <-> English even when online.
const STRONG = new Set(['sarvam', 'google']);
let strongOnline = null; // null = not asked yet
async function hasStrongOnlineEngine() {
  if (strongOnline !== null) return strongOnline;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3000);
    const res = await fetch('/api/health', { signal: ctl.signal });
    clearTimeout(t);
    const { providers = [] } = await res.json();
    strongOnline = providers.some((p) => STRONG.has(p));
  } catch {
    return true; // unknown: keep the normal online path, and ask again next time
  }
  return strongOnline;
}

async function runOffline(text, source, target, opts) {
  let src = source;
  if (src === 'auto') {
    src = detectLanguage(text);
    if (!src) throw new Error("Couldn't detect the language on this device. Please choose the source language.");
  }
  if (!canTranslateOffline(src, target)) {
    throw new Error(
      `${langName(src)} → ${langName(target)} isn't available on this device yet. ${offlineHint(src, target)}`,
    );
  }
  const out = await translateOffline(text, src, target, opts);
  return { text: out, source: src, detected: source === 'auto' ? src : null, engine: 'offline' };
}

/** Translate, then (by default) apply Indian number / currency / date formatting to the result. */
export async function translate({ indianFormat = true, ...args }) {
  const r = await translateRaw(args);
  return indianFormat ? { ...r, text: formatIndian(r.text, args.target) } : r;
}

async function translateRaw({ text, source, target, privateMode = false, signal, onStatus }) {
  const opts = { signal, onStatus };
  if (privateMode) return runOffline(text, source, target, opts);

  if (navigator.onLine) {
    const local = source === 'auto' ? detectLanguage(text) : source;
    if (local && canTranslateOffline(local, target) && !(await hasStrongOnlineEngine())) {
      try {
        return await runOffline(text, source, target, opts);
      } catch (err) {
        if (signal?.aborted) throw err;
        // the on-device engine failed: fall through to the online service
      }
    }
    try {
      return await translateOnline(text, source, target, signal);
    } catch (err) {
      if (signal?.aborted) throw err;
      // Bad input (4xx) shouldn't fall back; network / server failures should.
      if (err.status && err.status < 500 && err.status !== 429) throw err;
      const src = source === 'auto' ? detectLanguage(text) : source;
      if (src && canTranslateOffline(src, target)) return runOffline(text, source, target, opts);
      throw new Error(
        err.name === 'AbortError' ? 'The translation service timed out. Please try again.' : err.message,
      );
    }
  }
  return runOffline(text, source, target, opts);
}
