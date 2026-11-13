// Which on-device packs a visitor should get on their first visit, and whether it is sensible to start
// downloading them automatically. Pure functions (no DOM access) so they can be unit tested.
import { BUNDLES } from '../offline/store.js';

/**
 * Regions that have an on-device pack. Only India has one today: the IndicTrans2 models cover the 22 Indian
 * languages and English. Adding a region (e.g. France) means adding its models to offline/store.js and an
 * entry here, nothing else.
 */
export const REGIONS = {
  IN: {
    id: 'in',
    name: 'India',
    languages: 'all 22 Indian languages and English',
    // en-indic + indic-en cover every pair (Indian <-> Indian pivots through English). The direct
    // indic-indic bundle (358 MB) is left as an optional extra to keep the first download small.
    bundles: ['en-indic', 'indic-en'],
  },
};

export const regionForCountry = (country) => REGIONS[String(country || '').toUpperCase()] || null;

/**
 * Best guess from the browser alone (used when the server cannot tell us the country).
 * The timezone decides when it is known: a person abroad with an "en-IN" language setting is not in India.
 * The language region is only used when no timezone is available.
 */
export function countryFromLocale({ timeZone, languages = [] } = {}) {
  if (timeZone) return timeZone === 'Asia/Kolkata' || timeZone === 'Asia/Calcutta' ? 'IN' : null;
  for (const tag of languages) {
    const region = String(tag).split('-')[1];
    if (region && region.toUpperCase() === 'IN') return 'IN';
  }
  return null;
}

export const bundleBytes = (ids) => ids.reduce((n, id) => n + (BUNDLES[id]?.size || 0), 0);

const size = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);

// Free space wanted for a download: 1.5 GB comfortable / 1.0 GB minimum for the full ~570 MB India packs.
// The thresholds scale down for a smaller download (e.g. a single 300 MB pack) so it is not over-warned.
const COMFORT_BYTES = 1.5e9;
const MINIMUM_BYTES = 1.0e9;
const COMFORT_RATIO = 2.75;
const MINIMUM_RATIO = 1.85;

/**
 * How much room is there for a download of `needBytes`?
 *   ok       - comfortable: enough for the download and for the engine to run
 *   low      - tight: it may work, but can be slow or fail
 *   critical - not enough: offline translation will not work
 *   unknown  - the browser did not report free space
 * `freeBytes` is the browser's quota minus usage, so it is an estimate (some browsers report a cap, not the disk).
 */
export function storageLevel(freeBytes, needBytes) {
  if (typeof freeBytes !== 'number' || !(needBytes > 0)) return { level: 'unknown', message: '' };
  const comfort = Math.min(COMFORT_BYTES, COMFORT_RATIO * needBytes);
  const minimum = Math.min(MINIMUM_BYTES, MINIMUM_RATIO * needBytes);
  if (freeBytes < minimum) {
    return {
      level: 'critical',
      message: `Only ${size(freeBytes)} of storage is free. Offline translation will not work on this device until you free up space (at least ${size(minimum)} is needed, ${size(comfort)} recommended).`,
    };
  }
  if (freeBytes < comfort) {
    return {
      level: 'low',
      message: `Storage is low: ${size(freeBytes)} free, and ${size(comfort)} is recommended for the ${size(needBytes)} download. Offline translation may be slow or fail on this device.`,
    };
  }
  return { level: 'ok', message: '' };
}

/**
 * Decide whether to start the download without asking.
 * @param {{saveData?:boolean, type?:string, effectiveType?:string, coarsePointer?:boolean,
 *          freeBytes?:number|null, needBytes:number}} env
 * @returns {{auto:boolean, blocked:boolean, level:string, reason:string}}
 *   auto    - safe to start right away
 *   blocked - not enough storage: do not start it and say offline translation will not work
 *   level   - storage level (ok | low | critical | unknown)
 *   reason  - shown to the user when auto is false
 */
export function downloadPolicy(env) {
  const { saveData, type, effectiveType, coarsePointer, freeBytes, needBytes } = env;
  const storage = storageLevel(freeBytes, needBytes);
  const base = { level: storage.level };
  if (storage.level === 'critical') return { ...base, auto: false, blocked: true, reason: storage.message };
  // Low storage: never automatic, the user decides with the warning in front of them.
  if (storage.level === 'low') return { ...base, auto: false, blocked: false, reason: storage.message };
  if (saveData) return { ...base, auto: false, blocked: false, reason: 'Data Saver is on, so the download was not started automatically.' };
  if (type === 'cellular') return { ...base, auto: false, blocked: false, reason: 'You are on mobile data, so the download was not started automatically.' };
  if (['slow-2g', '2g', '3g'].includes(effectiveType)) return { ...base, auto: false, blocked: false, reason: 'The connection is slow, so the download was not started automatically.' };
  // Phones and tablets: browsers other than Chrome on Android cannot tell Wi-Fi from mobile data, so ask first.
  if (coarsePointer && type !== 'wifi' && type !== 'ethernet') {
    return { ...base, auto: false, blocked: false, reason: 'We cannot tell whether you are on Wi-Fi, so please confirm before this large download.' };
  }
  return { ...base, auto: true, blocked: false, reason: '' };
}
