// Translation providers.
// Each provider exposes:
//   name, maxChars, size?  - chunk limit (measured with `size`, default characters)
//   supports(source, target) -> boolean   (source may be 'auto')
//   translate(chunk, source, target) -> { text, detected? }
// Providers are tried in order; the first that succeeds wins.

import { SARVAM_CODES } from './indic.js';
import { utf8Bytes } from './chunk.js';

const ENTITIES = { '&quot;': '"', '&#39;': "'", '&apos;': "'", '&amp;': '&', '&lt;': '<', '&gt;': '>' };
const decode = (s) =>
  s
    .replace(/&(quot|apos|amp|lt|gt);|&#39;/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

async function fetchJson(url, options = {}, timeoutMs = 10_000) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message || body?.error || '';
    } catch {
      /* ignore */
    }
    throw new Error(`Upstream ${res.status}${detail ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  }
  return res.json();
}

/* ---------------- Sarvam (best quality for the 22 scheduled Indian languages) ---------------- */

export function sarvamProvider({ apiKey, model = 'sarvam-translate:v1' }) {
  return {
    name: 'sarvam',
    maxChars: 1500, // API limit is 2000 characters per request
    supports: (source, target) =>
      source !== 'auto' && source !== target && source in SARVAM_CODES && target in SARVAM_CODES,
    async translate(chunk, source, target) {
      const data = await fetchJson(
        'https://api.sarvam.ai/translate',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'api-subscription-key': apiKey },
          body: JSON.stringify({
            input: chunk,
            source_language_code: SARVAM_CODES[source],
            target_language_code: SARVAM_CODES[target],
            model,
          }),
        },
        20_000,
      );
      if (!data.translated_text) throw new Error('Sarvam returned no translation');
      return { text: data.translated_text };
    },
  };
}

/* ---------------- Google Cloud Translation (Basic / v2) ---------------- */

const GOOGLE_CODES = { zh: 'zh-CN', 'zh-TW': 'zh-TW', mni: 'mni-Mtei', or: 'or', he: 'iw' };
const gg = (code) => GOOGLE_CODES[code] ?? code;

export function googleProvider({ apiKey }) {
  return {
    name: 'google',
    maxChars: 4000,
    supports: (source, target) => source !== target,
    async translate(chunk, source, target) {
      const body = { q: chunk, target: gg(target), format: 'text' };
      if (source !== 'auto') body.source = gg(source);
      const data = await fetchJson(
        `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
      const t = data?.data?.translations?.[0];
      if (!t?.translatedText) throw new Error('Google returned no translation');
      return { text: decode(t.translatedText), detected: t.detectedSourceLanguage };
    },
  };
}

/* ---------------- LibreTranslate (self-hosted) ---------------- */

export function libreTranslateProvider({ url, apiKey }) {
  const base = url.replace(/\/$/, '');
  return {
    name: 'libretranslate',
    maxChars: 1500,
    supports: (source, target) => source !== target,
    async translate(chunk, source, target) {
      const data = await fetchJson(`${base}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: chunk,
          source,
          target,
          format: 'text',
          ...(apiKey ? { api_key: apiKey } : {}),
        }),
      });
      if (!data.translatedText) throw new Error(data.error || 'LibreTranslate error');
      return { text: data.translatedText, detected: data.detectedLanguage?.language };
    },
  };
}

/* ---------------- MyMemory (free, rate-limited; last resort) ---------------- */

const MYMEMORY_CODES = { zh: 'zh-CN', 'zh-TW': 'zh-TW', or: 'or-IN', fil: 'tl' };
const mm = (code) => MYMEMORY_CODES[code] ?? code;

export function myMemoryProvider({ email } = {}) {
  return {
    name: 'mymemory',
    maxChars: 450, // MyMemory's limit is 500 *bytes*, and Indian scripts take 3 bytes per character
    size: utf8Bytes,
    supports: (source, target) => source !== target,
    async translate(chunk, source, target) {
      const params = new URLSearchParams({
        q: chunk,
        langpair: `${source === 'auto' ? 'Autodetect' : mm(source)}|${mm(target)}`,
      });
      if (email) params.set('de', email);
      const data = await fetchJson(`https://api.mymemory.translated.net/get?${params}`);
      const status = Number(data.responseStatus);
      const text = data.responseData?.translatedText;
      if (status !== 200 || !text || /MYMEMORY WARNING/i.test(text)) {
        throw new Error(data.responseDetails || `MyMemory status ${status}`);
      }
      return { text: decode(text), detected: data.responseData?.detectedLanguage };
    },
  };
}

export function buildProviders(env = process.env) {
  const providers = [];
  if (env.SARVAM_API_KEY) providers.push(sarvamProvider({ apiKey: env.SARVAM_API_KEY, model: env.SARVAM_MODEL || undefined }));
  if (env.LIBRETRANSLATE_URL) {
    providers.push(libreTranslateProvider({ url: env.LIBRETRANSLATE_URL, apiKey: env.LIBRETRANSLATE_API_KEY }));
  }
  if (env.GOOGLE_TRANSLATE_API_KEY) providers.push(googleProvider({ apiKey: env.GOOGLE_TRANSLATE_API_KEY }));
  providers.push(myMemoryProvider({ email: env.MYMEMORY_EMAIL }));
  return providers;
}
