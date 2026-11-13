// IndicTrans2 text pre/post-processing (a JS port of the essential parts of IndicTransToolkit's IndicProcessor).
//  - normalise punctuation and digits
//  - protect numbers / URLs / e-mails with placeholders (the model was trained with them)
//  - split punctuation from words (what the model's training data looks like)
//  - map every Brahmic script into Devanagari (the model's shared script) and back
// Pure functions only: no DOM, no network.

const BLOCK = {
  Deva: 0x0900,
  Beng: 0x0980,
  Guru: 0x0a00,
  Gujr: 0x0a80,
  Orya: 0x0b00,
  Taml: 0x0b80,
  Telu: 0x0c00,
  Knda: 0x0c80,
  Mlym: 0x0d00,
};

/** Scripts the model sees transliterated into Devanagari. Arabic, Ol Chiki, Meitei Mayek and Latin pass through. */
export const needsTransliteration = (script) => script in BLOCK && script !== 'Deva';

function tamilFix(offset) {
  if (offset >= 0x15 && offset <= 0x28 && offset !== 0x1c) {
    const rem = (offset - 0x15) % 5;
    if (rem !== 0 && rem !== 4) offset = 0x15 + 5 * Math.floor((offset - 0x15) / 5);
  }
  if (offset === 0x2b || offset === 0x2c || offset === 0x2d) offset = 0x2a;
  if (offset === 0x36) offset = 0x37;
  return offset;
}

/** Brahmic script -> Devanagari (Unicode blocks are laid out in parallel, so this is an offset shift). */
export function toDevanagari(text, script) {
  const from = BLOCK[script];
  if (from === undefined || script === 'Deva') return text;
  let out = '';
  for (const ch of text) {
    const off = ch.codePointAt(0) - from;
    out += off >= 0 && off <= 0x6f ? String.fromCodePoint(BLOCK.Deva + off) : ch;
  }
  return out;
}

/** Devanagari -> target Brahmic script. Danda marks (U+0964/5) are shared and left alone. */
export function fromDevanagari(text, script) {
  const to = BLOCK[script];
  if (to === undefined || script === 'Deva') return text;
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    let off = cp - BLOCK.Deva;
    if (off >= 0 && off <= 0x6f && cp !== 0x964 && cp !== 0x965) {
      if (script === 'Taml') off = tamilFix(off);
      out += String.fromCodePoint(to + off);
    } else out += ch;
  }
  return out;
}

/* ---------------- digits ---------------- */

const DIGIT_BASES = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x1c50, 0xabf0];
const DIGIT_MAP = new Map();
for (const base of DIGIT_BASES) for (let d = 0; d < 10; d++) DIGIT_MAP.set(String.fromCodePoint(base + d), String(d));

export const asciiDigits = (s) => s.replace(/[\u0660-\u0669\u06f0-\u06f9\u0966-\u096f\u09e6-\u09ef\u0a66-\u0a6f\u0ae6-\u0aef\u0b66-\u0b6f\u0be6-\u0bef\u0c66-\u0c6f\u0ce6-\u0cef\u0d66-\u0d6f\u1c50-\u1c59\uabf0-\uabf9]/gu, (c) => DIGIT_MAP.get(c) ?? c);

/* ---------------- placeholders ---------------- */

const PROTECT = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // e-mail
  /\b(?:https?:\/\/|www\.)[^\s]+/g, // URL
  /~?\d+[-/.,:']\d+(?:[-/.,:'+]\d+)*(?:\.\d+)?%?|~?\d+%/g, // 10:30, 3.5, 12/05/2024, 50%
];

export function protectEntities(text) {
  const map = new Map();
  let n = 1;
  for (const re of PROTECT) {
    const found = new Set(text.match(re) ?? []);
    for (const m of found) {
      if (m.replace(/[ .:]/g, '').length < 4) continue; // very short matches are just ordinary text
      const key = `<ID${n}>`;
      map.set(n, m);
      text = text.split(m).join(key);
      n += 1;
    }
  }
  return { text: text.replace(/\s+/g, ' '), map };
}

// How models mangle "<ID1>": spacing, brackets, case, and (in Indic output) a phonetic spelling of "ID".
const ID_WORD = '(?:[Ii][Dd]|आई\\s*\\.?\\s*डी\\s*\\.?|आय\\s*\\.?\\s*डी\\s*\\.?|आइ\\s*\\.?\\s*डी\\s*\\.?|आयडी|आईडी|आइडि|ऐडि|ऐटि)';
const PLACEHOLDER = new RegExp(`[<[]\\s*${ID_WORD}\\s*(\\d+)(?:\\s*[>\\]])?`, 'g');

export function restoreEntities(text, map) {
  if (!map || map.size === 0) return text;
  return text.replace(PLACEHOLDER, (whole, num) => map.get(Number(num)) ?? whole);
}

/* ---------------- punctuation ---------------- */

export function normalizePunct(text) {
  return text
    .replace(/\r/g, '')
    .replace(/[`´‘‚’]/g, "'")
    .replace(/[„“”«»]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const SPLIT_PUNCT = /([!"#$%&()*+,/:;<=>?@[\\\]^_`{|}~।॥؟،؛۔])/g;

/** Separate punctuation from words ("Hello, world?" -> "Hello , world ?"), keeping 3.5 / 10:30 / <ID1> intact. */
export function tokenizePunct(text, { english = false } = {}) {
  let t = text
    // a '.' or '-' inside a number or between letters stays attached
    .replace(SPLIT_PUNCT, ' $1 ')
    .replace(/(^|\s)([.'-])(?=\s|$)/g, ' $2 ')
    .replace(/([^\s\d.])\.(?=\s|$)/g, '$1 .')
    .replace(/(\d)\.(?=\s|$)/g, '$1 .')
    .replace(/(^|\s)'/g, "$1' ")
    .replace(/(\S)'(?=\s|$)/g, "$1 '");
  if (english) t = t.replace(/([A-Za-z])'([A-Za-z])/g, "$1 '$2").replace(/n 't\b/g, "n't");
  return t.replace(/\s+/g, ' ').trim();
}

export function detokenize(text, { english = false } = {}) {
  let t = text
    .replace(/\s+([,.!?;:%)\]}।॥؟،؛۔])/g, '$1')
    .replace(/([([{])\s+/g, '$1')
    .replace(/\s+'(s|t|re|ve|ll|d|m)\b/gi, "'$1")
    .replace(/(\d)\s+([.,:])\s*(?=\d)/g, '$1$2')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (english) t = t.replace(/\s+n't\b/g, "n't");
  return t;
}

/* ---------------- public API ---------------- */

const scriptOf = (flores) => flores.split('_')[1];

/**
 * Prepare one chunk of text for the model.
 * Returns { text, entities } where `entities` must be passed back to postprocess().
 */
export function preprocess(chunk, srcFlores) {
  const script = scriptOf(srcFlores);
  let t = normalizePunct(asciiDigits(chunk));
  const { text: protectedText, map } = protectEntities(t);
  t = tokenizePunct(protectedText, { english: script === 'Latn' });
  if (needsTransliteration(script)) t = toDevanagari(t, script);
  return { text: t, entities: map };
}

/** Turn the model's raw (Devanagari-space) output into proper text in the target script. */
export function postprocess(raw, tgtFlores, entities) {
  const script = scriptOf(tgtFlores);
  if (script === 'Latn') return restoreEntities(detokenize(raw, { english: true }), entities);

  // Restore while the text is still in the model's own (Devanagari) space, where the phonetic "ID" spellings live.
  let t = restoreEntities(raw, entities);
  if (script === 'Arab') t = t.replace(/ ؟/g, '؟').replace(/ ۔/g, '۔').replace(/ ،/g, '،');
  if (needsTransliteration(script)) t = fromDevanagari(t, script);
  if (tgtFlores.startsWith('ory')) t = t.replace(/ଯ଼/g, 'ୟ');
  if (script === 'Mtei') t = t.replace(/\s*\uabed\s*/g, '\uabed');
  t = detokenize(t);
  // "10:30 - ൽ" -> "10:30-ൽ": the model detaches case suffixes with a hyphen
  return t.replace(/(\d)\s+-\s+(?=[\u0900-\u0dff])/g, '$1-');
}