// Visitor country, in this order:
//   1. headers that CDNs / reverse proxies set (free, exact, but only present behind such a proxy)
//   2. the request IP looked up in a local country database (geoip-country, MaxMind GeoLite2 data).
//      The lookup runs in this process: the IP is never sent to a third party and never stored.
// Only trust the headers when the app sits behind such a proxy; a direct client could send them itself, which
// is harmless here because the result only decides which optional download is offered.
import { createRequire } from 'node:module';

const geoip = createRequire(import.meta.url)('geoip-country');

const HEADERS = [
  'cf-ipcountry', // Cloudflare
  'cloudfront-viewer-country', // AWS CloudFront
  'x-vercel-ip-country', // Vercel
  'x-appengine-country', // Google App Engine
  'x-country-code',
  'x-geo-country',
];

/** ISO 3166-1 alpha-2 code in upper case, or null when absent / not a real country (Cloudflare's XX, T1). */
export function countryFromHeaders(headers) {
  for (const name of HEADERS) {
    const raw = headers[name];
    const v = (Array.isArray(raw) ? raw[0] : raw)?.trim().toUpperCase();
    if (v && /^[A-Z]{2}$/.test(v) && v !== 'XX' && v !== 'T1') return v;
  }
  return null;
}

/** ISO 3166-1 alpha-2 code for a public IPv4 / IPv6 address, or null (private, loopback, unknown, malformed). */
export function countryFromIp(ip) {
  if (typeof ip !== 'string' || !ip || ip.length > 64) return null;
  try {
    const country = geoip.lookup(ip)?.country;
    return /^[A-Z]{2}$/.test(country || '') ? country : null;
  } catch {
    return null;
  }
}

/** Country for a request: proxy header first, then the request IP. `null` means unknown. */
export const countryFromRequest = (req) => countryFromHeaders(req.headers) ?? countryFromIp(req.ip);
