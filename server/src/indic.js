// India-specific language data used by the providers and by script-based detection.

// App language code -> Sarvam language code (sarvam-translate:v1 supports all of these + English).
export const SARVAM_CODES = {
  en: 'en-IN',
  as: 'as-IN',
  bn: 'bn-IN',
  brx: 'brx-IN',
  doi: 'doi-IN',
  gu: 'gu-IN',
  hi: 'hi-IN',
  kn: 'kn-IN',
  ks: 'ks-IN',
  kok: 'kok-IN',
  mai: 'mai-IN',
  ml: 'ml-IN',
  mni: 'mni-IN',
  mr: 'mr-IN',
  ne: 'ne-IN',
  or: 'od-IN',
  pa: 'pa-IN',
  sa: 'sa-IN',
  sat: 'sat-IN',
  sd: 'sd-IN',
  ta: 'ta-IN',
  te: 'te-IN',
  ur: 'ur-IN',
};

export const isIndic = (code) => code !== 'en' && code in SARVAM_CODES;

// Unicode ranges -> most likely language. Devanagari/Bengali/Arabic are shared by several
// languages; we pick the most widely used one and let the user override it.
const SCRIPTS = [
  [/[\u0980-\u09ff]/, 'bn'],
  [/[\u0a00-\u0a7f]/, 'pa'],
  [/[\u0a80-\u0aff]/, 'gu'],
  [/[\u0b00-\u0b7f]/, 'or'],
  [/[\u0b80-\u0bff]/, 'ta'],
  [/[\u0c00-\u0c7f]/, 'te'],
  [/[\u0c80-\u0cff]/, 'kn'],
  [/[\u0d00-\u0d7f]/, 'ml'],
  [/[\u1c50-\u1c7f]/, 'sat'],
  [/[\u0900-\u097f]/, 'hi'],
  [/[\u0600-\u06ff]/, 'ur'],
];

/** Returns a language code when the text is written in an Indian script, otherwise null. */
export function detectIndicScript(text) {
  const counts = new Map();
  for (const [re, code] of SCRIPTS) {
    const m = text.match(new RegExp(re.source, 'g'));
    if (m) counts.set(code, m.length);
  }
  if (!counts.size) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
