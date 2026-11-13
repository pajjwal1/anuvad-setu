// User data storage.
//
// Normal mode  -> localStorage   (survives closing the browser / app)
// Private mode -> sessionStorage (erased by the browser when the tab or app window is closed)
//
// In private mode nothing is ever written to localStorage, and leaving private mode wipes the session data.
// If sessionStorage is unavailable, private-mode writes are dropped; they never fall back to localStorage.

const area = (priv) => (priv ? sessionStorage : localStorage);

const read = (key, fallback, priv = false) => {
  try {
    const v = area(priv).getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
};
const write = (key, value, priv = false) => {
  try {
    area(priv).setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable */
  }
};

const SETTINGS = 'anuvadsetu.settings.v1';
const HISTORY = 'anuvadsetu.history.v1';
const PHRASES = 'anuvadsetu.phrasebook.v1'; // { saved: [{id,text}], cache: { "<lang>|<text>": "<translation>" } }
const PRIVATE_FLAG = 'anuvadsetu.private.v1';
const MAX_HISTORY = 50;

/* ---------- private session ---------- */

export const isPrivateSession = () => {
  try {
    return sessionStorage.getItem(PRIVATE_FLAG) === '1';
  } catch {
    return false;
  }
};

/** Turn the private session on or off. Turning it off erases everything kept for it. */
export function setPrivateSession(on) {
  try {
    if (on) sessionStorage.setItem(PRIVATE_FLAG, '1');
    else for (const k of [PRIVATE_FLAG, SETTINGS, HISTORY, PHRASES]) sessionStorage.removeItem(k);
  } catch {
    /* sessionStorage unavailable */
  }
}

/* ---------- settings ---------- */

export const loadSettings = (priv = isPrivateSession()) => {
  const normal = read(SETTINGS, read('lingua.settings.v1', {})); // second key: pre-rename fallback
  const saved = priv ? { ...normal, ...read(SETTINGS, {}, true) } : normal;
  return {
    source: 'auto',
    target: navigator.language?.split('-')[0] === 'hi' ? 'en' : 'hi',
    theme: 'system',
    recents: [],
    romanize: true,
    indianFormat: true,
    ...saved,
    privateMode: priv, // comes from the session flag, never from stored settings
  };
};
export const saveSettings = (s) => {
  const { privateMode, ...rest } = s;
  write(SETTINGS, rest, privateMode);
};

/* ---------- history ---------- */

export const loadHistory = (priv = isPrivateSession()) =>
  priv ? read(HISTORY, [], true) : read(HISTORY, read('lingua.history.v1', []));
export const saveHistory = (items, priv = false) => write(HISTORY, items.slice(0, MAX_HISTORY), priv);

/* ---------- phrasebook ---------- */

/**
 * Normal: saved phrases + translated-phrase cache from localStorage.
 * Private: its own (initially empty) saved list from sessionStorage. The normal cache of already translated
 * phrases is shown read-only so they still work; new translations are kept in the session only.
 */
export const loadPhrasebook = (priv = isPrivateSession()) => {
  const normal = { saved: [], cache: {}, ...read(PHRASES, read('lingua.phrasebook.v1', {})) };
  if (!priv) return normal;
  const session = read(PHRASES, {}, true);
  return { saved: session.saved || [], cache: { ...normal.cache, ...session.cache } };
};
export function savePhrasebook(p, priv = false) {
  if (!priv) return write(PHRASES, p);
  // Keep only what was added during this private session; the normal cache stays where it is.
  const normalCache = read(PHRASES, read('lingua.phrasebook.v1', {})).cache || {};
  const cache = {};
  for (const [k, v] of Object.entries(p.cache || {})) if (normalCache[k] !== v) cache[k] = v;
  return write(PHRASES, { saved: p.saved, cache }, true);
}

export function pushHistory(items, entry) {
  const rest = items.filter(
    (h) => !(h.text === entry.text && h.source === entry.source && h.target === entry.target),
  );
  return [{ ...entry, id: Date.now(), starred: false }, ...rest].slice(0, MAX_HISTORY);
}
