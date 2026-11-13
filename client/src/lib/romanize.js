// Romanization: show Indian-language text in Latin letters so it can be read and spoken.
// Uses a readable scheme (long vowels "aa/ee/oo", "sh/chh/kh"), not strict ISO 15919.
// Brahmic Unicode blocks are laid out in parallel, so every script is mapped through one
// Devanagari-indexed table. Perso-Arabic scripts (Urdu, Kashmiri, Sindhi) are not supported:
// short vowels are not written, so a faithful romanization is impossible without a dictionary.

const BLOCK = { Deva: 0x0900, Beng: 0x0980, Guru: 0x0a00, Gujr: 0x0a80, Orya: 0x0b00, Taml: 0x0b80, Telu: 0x0c00, Knda: 0x0c80, Mlym: 0x0d00 };

/** Indo-Aryan languages drop the inherent "a" at word end and in unstressed syllables. */
const SCHWA_DELETING = new Set(['hi', 'mr', 'ne', 'bn', 'as', 'gu', 'pa', 'or', 'mai', 'doi', 'kok', 'brx']);
/** Word-final anusvara is "m" in these languages ("namaskaaram"), "n" elsewhere ("hain"). */
const FINAL_M = new Set(['te', 'kn', 'ml', 'sa', 'ta']);
/** Bengali / Assamese write anusvara as ং, pronounced "ng". */
const NG_NASAL = new Set(['bn', 'as']);

export const canRomanize = (script) => script in BLOCK;

// offset from the start of the script block -> Latin
const VOWELS = {
  0x05: 'a', 0x06: 'aa', 0x07: 'i', 0x08: 'ee', 0x09: 'u', 0x0a: 'oo', 0x0b: 'ri', 0x0c: 'lri',
  0x0d: 'e', 0x0e: 'e', 0x0f: 'e', 0x10: 'ai', 0x11: 'o', 0x12: 'o', 0x13: 'o', 0x14: 'au',
};
const MATRAS = {
  0x3e: 'aa', 0x3f: 'i', 0x40: 'ee', 0x41: 'u', 0x42: 'oo', 0x43: 'ri', 0x44: 'ree', 0x45: 'e', 0x46: 'e', 0x47: 'e',
  0x48: 'ai', 0x49: 'o', 0x4a: 'o', 0x4b: 'o', 0x4c: 'au', 0x57: 'au',
};
const CONSONANTS = {
  0x15: 'k', 0x16: 'kh', 0x17: 'g', 0x18: 'gh', 0x19: 'ng',
  0x1a: 'ch', 0x1b: 'chh', 0x1c: 'j', 0x1d: 'jh', 0x1e: 'ny',
  0x1f: 't', 0x20: 'th', 0x21: 'd', 0x22: 'dh', 0x23: 'n',
  0x24: 't', 0x25: 'th', 0x26: 'd', 0x27: 'dh', 0x28: 'n', 0x29: 'n',
  0x2a: 'p', 0x2b: 'ph', 0x2c: 'b', 0x2d: 'bh', 0x2e: 'm',
  0x2f: 'y', 0x30: 'r', 0x31: 'r', 0x32: 'l', 0x33: 'l', 0x34: 'zh', 0x35: 'v',
  0x36: 'sh', 0x37: 'sh', 0x38: 's', 0x39: 'h',
  // precomposed nukta letters (U+0958..U+095F in Devanagari and the matching offsets elsewhere)
  0x58: 'q', 0x59: 'kh', 0x5a: 'gh', 0x5b: 'z', 0x5c: 'r', 0x5d: 'rh', 0x5e: 'f', 0x5f: 'y',
};
const NUKTA = { k: 'q', g: 'gh', j: 'z', d: 'r', dh: 'rh', ph: 'f' };
const VIRAMA = 0x4d;
const NUKTA_CP = 0x3c;

// Script-specific letters that don't sit at the Devanagari offset: Malayalam chillus, Bengali khanda-ta.
const SPECIAL = {
  Mlym: { 0x7a: 'n', 0x7b: 'n', 0x7c: 'r', 0x7d: 'l', 0x7e: 'l', 0x7f: 'k' },
  Beng: { 0x4e: 't', 0x70: 'r', 0x71: 'w' },
};

function classify(script, off) {
  if (SPECIAL[script]?.[off] !== undefined) return { kind: 'bare', latin: SPECIAL[script][off] };
  if (off in CONSONANTS) return { kind: 'cons', latin: CONSONANTS[off] };
  if (off in VOWELS) return { kind: 'vowel', latin: VOWELS[off] };
  if (off in MATRAS) return { kind: 'matra', latin: MATRAS[off] };
  if (off === VIRAMA) return { kind: 'virama' };
  if (off === NUKTA_CP) return { kind: 'nukta' };
  if (off === 0x01 || off === 0x02) return { kind: 'nasal' }; // candrabindu, anusvara
  if (off === 0x03) return { kind: 'visarga' };
  if (script === 'Guru' && off === 0x70) return { kind: 'nasal' }; // tippi
  if (script === 'Guru' && off === 0x71) return { kind: 'addak' }; // doubles the next consonant
  if (off === 0x64 || off === 0x65) return { kind: 'danda' };
  if (off >= 0x66 && off <= 0x6f) return { kind: 'digit', latin: String(off - 0x66) };
  return null;
}

/**
 * A word is a list of units: { cons, matra, virama } | { vowel } | { nasal } | { rest }.
 * `matra === null` means the consonant carries the inherent "a".
 */
function renderWord(units, deleteSchwa, lang, atWordEnd) {
  const inherent = (u) => u.cons !== undefined && u.matra === null && !u.virama;
  const deleted = units.map(() => false);
  const sounded = (j) => {
    const u = units[j];
    if (!u) return false;
    if (u.vowel !== undefined) return true;
    if (u.cons === undefined) return false;
    return !!u.matra || (inherent(u) && !deleted[j]);
  };

  if (deleteSchwa) {
    for (let i = units.length - 1; i >= 0; i--) {
      if (!inherent(units[i])) continue;
      const last = i === units.length - 1 || units.slice(i + 1).every((u) => u.cons === undefined && u.vowel === undefined);
      if (last && units.length > 1) {
        deleted[i] = true;
      } else if (i > 0 && sounded(i - 1) && sounded(i + 1)) {
        deleted[i] = true;
      }
    }
  }

  let out = '';
  units.forEach((u, i) => {
    if (u.cons !== undefined) {
      out += u.cons;
      if (u.matra) out += u.matra;
      else if (inherent(u) && !deleted[i]) out += 'a';
    } else if (u.vowel !== undefined) {
      out += u.vowel;
    } else if (u.nasal) {
      const next = units[i + 1];
      const labial = next?.cons !== undefined && /^(p|ph|b|bh|m)$/.test(next.cons);
      const wordFinal = !units.slice(i + 1).some((x) => x.cons !== undefined || x.vowel !== undefined);
      if (NG_NASAL.has(lang)) out += 'ng';
      else if (labial || (wordFinal && atWordEnd && FINAL_M.has(lang))) out += 'm';
      else out += 'n';
    } else if (u.rest) {
      out += u.rest;
    }
  });
  return out;
}

export function romanize(text, script, lang) {
  const base = BLOCK[script];
  if (base === undefined) return null;
  const deleteSchwa = SCHWA_DELETING.has(lang);

  const chars = [...text];
  const offsetOf = (ch) => (ch === undefined ? NaN : ch.codePointAt(0) - base);
  let result = '';
  let units = [];
  let doubleNext = false;

  const flush = (atWordEnd = true) => {
    if (units.length) result += renderWord(units, deleteSchwa, lang, atWordEnd);
    units = [];
  };

  for (let idx = 0; idx < chars.length; idx++) {
    const off = offsetOf(chars[idx]);
    const c = off >= 0 && off < 0x80 ? classify(script, off) : null;
    if (!c) {
      flush();
      result += chars[idx];
      continue;
    }
    const last = units[units.length - 1];
    switch (c.kind) {
      case 'cons':
        units.push({ cons: doubleNext ? c.latin + c.latin : c.latin, matra: null, virama: false });
        doubleNext = false;
        break;
      case 'bare':
        units.push({ cons: c.latin, matra: '', virama: false }); // consonant that never takes a vowel
        break;
      case 'nukta':
        if (last?.cons !== undefined) last.cons = NUKTA[last.cons] ?? last.cons;
        break;
      case 'virama':
        if (last?.cons !== undefined) last.virama = true;
        break;
      case 'matra':
        if (last?.cons !== undefined && last.matra === null && !last.virama) last.matra = c.latin;
        else units.push({ vowel: c.latin });
        break;
      case 'vowel':
        units.push({ vowel: c.latin });
        break;
      case 'nasal':
        units.push({ nasal: true });
        break;
      case 'visarga':
        units.push({ rest: 'h' });
        break;
      case 'addak':
        doubleNext = true;
        break;
      case 'danda':
        flush();
        result += '.';
        break;
      case 'digit':
        flush();
        result += c.latin;
        break;
      default:
        break;
    }
  }
  flush();

  // ज्ञ is pronounced "gya" in Hindi/Marathi; keep "jnya" elsewhere (Sanskrit, South Indian usage).
  return lang === 'hi' || lang === 'mr' ? result.replace(/jny/g, 'gy') : result;
}
