// Language catalogue, India first.
//  code    - code sent to the API (ISO 639-1/3)
//  flores  - IndicTrans2 language tag (on-device engine)
//  speech  - BCP-47 tag for speech synthesis / recognition
//  group   - 'india' | 'core' | 'world'

const row = (s) =>
  s
    .trim()
    .split('\n')
    .map((l) => l.trim().split('|'));

// code|name|native|flores|speech   (the 22 scheduled languages, largest first)
const INDIAN_ROWS = row(`
hi|Hindi|हिन्दी|hin_Deva|hi-IN
bn|Bengali|বাংলা|ben_Beng|bn-IN
mr|Marathi|मराठी|mar_Deva|mr-IN
te|Telugu|తెలుగు|tel_Telu|te-IN
ta|Tamil|தமிழ்|tam_Taml|ta-IN
gu|Gujarati|ગુજરાતી|guj_Gujr|gu-IN
ur|Urdu|اردو|urd_Arab|ur-IN
kn|Kannada|ಕನ್ನಡ|kan_Knda|kn-IN
or|Odia|ଓଡ଼ିଆ|ory_Orya|or-IN
ml|Malayalam|മലയാളം|mal_Mlym|ml-IN
pa|Punjabi|ਪੰਜਾਬੀ|pan_Guru|pa-IN
as|Assamese|অসমীয়া|asm_Beng|as-IN
mai|Maithili|मैथिली|mai_Deva|hi-IN
sa|Sanskrit|संस्कृतम्|san_Deva|hi-IN
sat|Santali|ᱥᱟᱱᱛᱟᱲᱤ|sat_Olck|hi-IN
ks|Kashmiri|کٲشُر|kas_Arab|ur-IN
ne|Nepali|नेपाली|npi_Deva|ne-NP
sd|Sindhi|سنڌي|snd_Arab|ur-IN
kok|Konkani|कोंकणी|gom_Deva|hi-IN
doi|Dogri|डोगरी|doi_Deva|hi-IN
mni|Manipuri (Meitei)|ꯃꯤꯇꯩꯂꯣꯟ|mni_Mtei|hi-IN
brx|Bodo|बड़ो|brx_Deva|hi-IN
`);

// code|name|native|speech   (online only)
const WORLD_ROWS = row(`
af|Afrikaans|Afrikaans|af-ZA
sq|Albanian|Shqip|sq-AL
am|Amharic|አማርኛ|am-ET
ar|Arabic|العربية|ar-SA
hy|Armenian|Հայերեն|hy-AM
az|Azerbaijani|Azərbaycan|az-AZ
eu|Basque|Euskara|eu-ES
be|Belarusian|Беларуская|be-BY
bs|Bosnian|Bosanski|bs-BA
bg|Bulgarian|Български|bg-BG
ca|Catalan|Català|ca-ES
zh|Chinese (Simplified)|简体中文|zh-CN
zh-TW|Chinese (Traditional)|繁體中文|zh-TW
hr|Croatian|Hrvatski|hr-HR
cs|Czech|Čeština|cs-CZ
da|Danish|Dansk|da-DK
nl|Dutch|Nederlands|nl-NL
eo|Esperanto|Esperanto|eo
et|Estonian|Eesti|et-EE
fi|Finnish|Suomi|fi-FI
fr|French|Français|fr-FR
gl|Galician|Galego|gl-ES
ka|Georgian|ქართული|ka-GE
de|German|Deutsch|de-DE
el|Greek|Ελληνικά|el-GR
ha|Hausa|Hausa|ha
he|Hebrew|עברית|he-IL
hu|Hungarian|Magyar|hu-HU
is|Icelandic|Íslenska|is-IS
id|Indonesian|Bahasa Indonesia|id-ID
ga|Irish|Gaeilge|ga-IE
it|Italian|Italiano|it-IT
ja|Japanese|日本語|ja-JP
jv|Javanese|Basa Jawa|jv-ID
kk|Kazakh|Қазақ|kk-KZ
km|Khmer|ខ្មែរ|km-KH
ko|Korean|한국어|ko-KR
lo|Lao|ລາວ|lo-LA
lv|Latvian|Latviešu|lv-LV
lt|Lithuanian|Lietuvių|lt-LT
mk|Macedonian|Македонски|mk-MK
ms|Malay|Bahasa Melayu|ms-MY
mt|Maltese|Malti|mt-MT
mn|Mongolian|Монгол|mn-MN
no|Norwegian|Norsk|nb-NO
fa|Persian|فارسی|fa-IR
pl|Polish|Polski|pl-PL
pt|Portuguese|Português|pt-PT
ro|Romanian|Română|ro-RO
ru|Russian|Русский|ru-RU
sr|Serbian|Српски|sr-RS
si|Sinhala|සිංහල|si-LK
sk|Slovak|Slovenčina|sk-SK
sl|Slovenian|Slovenščina|sl-SI
so|Somali|Soomaali|so-SO
es|Spanish|Español|es-ES
sw|Swahili|Kiswahili|sw-KE
sv|Swedish|Svenska|sv-SE
th|Thai|ไทย|th-TH
tr|Turkish|Türkçe|tr-TR
uk|Ukrainian|Українська|uk-UA
uz|Uzbek|Oʻzbek|uz-UZ
vi|Vietnamese|Tiếng Việt|vi-VN
cy|Welsh|Cymraeg|cy-GB
xh|Xhosa|isiXhosa|xh-ZA
yo|Yoruba|Yorùbá|yo-NG
zu|Zulu|isiZulu|zu-ZA
`);

const RTL = new Set(['ar', 'he', 'fa', 'ur', 'ks', 'sd']);

export const INDIAN_LANGUAGES = INDIAN_ROWS.map(([code, name, native, flores, speech]) => ({
  code,
  name,
  native,
  flores,
  speech,
  script: flores.split('_')[1],
  group: 'india',
  rtl: RTL.has(code),
}));

export const ENGLISH = { code: 'en', name: 'English', native: 'English', flores: 'eng_Latn', speech: 'en-IN', script: 'Latn', group: 'core' };

export const WORLD_LANGUAGES = WORLD_ROWS.map(([code, name, native, speech]) => ({
  code,
  name,
  native,
  speech,
  group: 'world',
  rtl: RTL.has(code),
}));

export const LANGUAGES = [...INDIAN_LANGUAGES, ENGLISH, ...WORLD_LANGUAGES];
export const BY_CODE = Object.fromEntries(LANGUAGES.map((l) => [l.code, l]));
export const INDIAN_CODES = new Set(INDIAN_LANGUAGES.map((l) => l.code));

export const langName = (code) => BY_CODE[code]?.name ?? code;
export const isRtl = (code) => !!BY_CODE[code]?.rtl;
export const isIndian = (code) => INDIAN_CODES.has(code);
/** Languages the on-device engine can handle (22 Indian languages + English). */
export const hasOnDevice = (code) => code === 'en' || INDIAN_CODES.has(code);

/**
 * On-device model chain for source -> target, or null when unsupported.
 * Each step names the model bundle and the IndicTrans2 language tags.
 * Indian <-> Indian uses the direct model when installed, else pivots through English.
 */
export function planOffline(source, target, installed) {
  if (!hasOnDevice(source) || !hasOnDevice(target) || source === target) return null;
  const tag = (c) => BY_CODE[c].flores;
  const has = (b) => installed.has(b);
  if (source === 'en') return has('en-indic') ? [{ bundle: 'en-indic', src: tag(source), tgt: tag(target) }] : null;
  if (target === 'en') return has('indic-en') ? [{ bundle: 'indic-en', src: tag(source), tgt: tag(target) }] : null;
  if (has('indic-indic')) return [{ bundle: 'indic-indic', src: tag(source), tgt: tag(target) }];
  if (has('indic-en') && has('en-indic')) {
    return [
      { bundle: 'indic-en', src: tag(source), tgt: 'eng_Latn' },
      { bundle: 'en-indic', src: 'eng_Latn', tgt: tag(target) },
    ];
  }
  return null;
}

/** Which bundles would make source -> target possible (for "download X to translate offline" hints). */
export function bundlesNeeded(source, target) {
  if (!hasOnDevice(source) || !hasOnDevice(target) || source === target) return null;
  if (source === 'en') return ['en-indic'];
  if (target === 'en') return ['indic-en'];
  return ['indic-indic']; // or indic-en + en-indic
}

const SCRIPT_TO_LANG = [
  [/[\u0980-\u09ff]/g, 'bn'],
  [/[\u0a00-\u0a7f]/g, 'pa'],
  [/[\u0a80-\u0aff]/g, 'gu'],
  [/[\u0b00-\u0b7f]/g, 'or'],
  [/[\u0b80-\u0bff]/g, 'ta'],
  [/[\u0c00-\u0c7f]/g, 'te'],
  [/[\u0c80-\u0cff]/g, 'kn'],
  [/[\u0d00-\u0d7f]/g, 'ml'],
  [/[\u1c50-\u1c7f]/g, 'sat'],
  [/[\uabc0-\uabff]/g, 'mni'],
  [/[\u0900-\u097f]/g, 'hi'],
  [/[\u0600-\u06ff]/g, 'ur'],
];

/** Language from the dominant Indian script, or 'en' for Latin text, else null. Works fully offline. */
export function detectLanguage(text) {
  const sample = text.trim().slice(0, 800);
  if (sample.length < 2) return null;
  let best = null;
  let bestN = 0;
  for (const [re, code] of SCRIPT_TO_LANG) {
    const n = (sample.match(re) || []).length;
    if (n > bestN) {
      best = code;
      bestN = n;
    }
  }
  if (best) return best;
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  return latin >= 2 ? 'en' : null;
}
