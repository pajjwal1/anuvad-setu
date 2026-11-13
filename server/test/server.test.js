import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkLine, segmentText, assemble, utf8Bytes } from '../src/chunk.js';
import { createApp } from '../src/index.js';
import { LruCache } from '../src/cache.js';
import { detectIndicScript, SARVAM_CODES } from '../src/indic.js';
import { sarvamProvider, myMemoryProvider, buildProviders } from '../src/providers.js';

/* ---------------- chunking ---------------- */

test('chunkLine keeps short lines intact and splits long ones under the limit', () => {
  assert.deepEqual(chunkLine('Hello world.'), ['Hello world.']);
  const long = Array.from({ length: 80 }, (_, i) => `Sentence number ${i}.`).join(' ');
  const chunks = chunkLine(long, 100);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.length <= 100));
  assert.equal(chunks.join(' '), long);
});

test('chunkLine splits on the Devanagari danda', () => {
  const text = 'यह पहला वाक्य है। यह दूसरा वाक्य है। यह तीसरा वाक्य है।';
  const chunks = chunkLine(text, 30);
  assert.ok(chunks.length >= 2);
  assert.equal(chunks.join(' '), text);
});

test('byte-aware chunking keeps Indic text under a UTF-8 byte limit', () => {
  const word = 'नमस्ते';
  const text = Array.from({ length: 100 }, () => word).join(' ');
  const chunks = chunkLine(text, 450, utf8Bytes);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => utf8Bytes(c) <= 450), 'every chunk must fit in 450 bytes');
  assert.equal(chunks.join(' '), text);
});

test('a single huge unbroken word is hard-split without breaking characters', () => {
  const chunks = chunkLine('अ'.repeat(500), 90, utf8Bytes);
  assert.ok(chunks.every((c) => utf8Bytes(c) <= 90));
  assert.equal(chunks.join(''), 'अ'.repeat(500));
});

test('segmentText + assemble preserves paragraphs', () => {
  const text = 'Hello.\n\nHow are you?';
  const segs = segmentText(text);
  const out = assemble(segs, segs.filter((s) => 'chunk' in s).map((s) => s.chunk.toUpperCase()));
  assert.equal(out, 'HELLO.\n\nHOW ARE YOU?');
});

test('LruCache evicts oldest', () => {
  const c = new LruCache(2);
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3);
  assert.equal(c.get('a'), undefined);
  assert.equal(c.get('c'), 3);
});

/* ---------------- Indic helpers ---------------- */

test('detectIndicScript identifies Indian scripts', () => {
  assert.equal(detectIndicScript('नमस्ते आप कैसे हैं'), 'hi');
  assert.equal(detectIndicScript('வணக்கம் எப்படி இருக்கிறீர்கள்'), 'ta');
  assert.equal(detectIndicScript('నమస్కారం మీరు ఎలా ఉన్నారు'), 'te');
  assert.equal(detectIndicScript('ನಮಸ್ಕಾರ ಹೇಗಿದ್ದೀರಿ'), 'kn');
  assert.equal(detectIndicScript('നമസ്കാരം സുഖമാണോ'), 'ml');
  assert.equal(detectIndicScript('નમસ્તે કેમ છો'), 'gu');
  assert.equal(detectIndicScript('ਸਤ ਸ੍ਰੀ ਅਕਾਲ ਕਿਵੇਂ ਹੋ'), 'pa');
  assert.equal(detectIndicScript('নমস্কার আপনি কেমন আছেন'), 'bn');
  assert.equal(detectIndicScript('ନମସ୍କାର ଆପଣ କେମିତି ଅଛନ୍ତି'), 'or');
  assert.equal(detectIndicScript('Hello there'), null);
});

test('every Sarvam language has a -IN code', () => {
  assert.equal(Object.keys(SARVAM_CODES).length, 23); // 22 scheduled languages + English
  assert.ok(Object.values(SARVAM_CODES).every((c) => c.endsWith('-IN')));
});

/* ---------------- providers ---------------- */

test('sarvam provider only supports Indian pairs with an explicit source', () => {
  const p = sarvamProvider({ apiKey: 'k' });
  assert.equal(p.supports('hi', 'ta'), true);
  assert.equal(p.supports('en', 'or'), true);
  assert.equal(p.supports('auto', 'hi'), false);
  assert.equal(p.supports('fr', 'hi'), false);
  assert.equal(p.supports('hi', 'hi'), false);
});

test('sarvam provider sends the documented request and reads translated_text', async () => {
  let seen;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    seen = { url, opts, body: JSON.parse(opts.body) };
    return new Response(JSON.stringify({ translated_text: 'नमस्ते', request_id: 'x' }), { status: 200 });
  };
  try {
    const out = await sarvamProvider({ apiKey: 'secret' }).translate('Hello', 'en', 'or');
    assert.equal(out.text, 'नमस्ते');
    assert.equal(seen.url, 'https://api.sarvam.ai/translate');
    assert.equal(seen.opts.headers['api-subscription-key'], 'secret');
    assert.deepEqual(seen.body, {
      input: 'Hello',
      source_language_code: 'en-IN',
      target_language_code: 'od-IN',
      model: 'sarvam-translate:v1',
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('buildProviders orders Sarvam first and MyMemory last', () => {
  const names = buildProviders({ SARVAM_API_KEY: 'a', GOOGLE_TRANSLATE_API_KEY: 'b', LIBRETRANSLATE_URL: 'http://x' }).map((p) => p.name);
  assert.deepEqual(names, ['sarvam', 'libretranslate', 'google', 'mymemory']);
  assert.deepEqual(buildProviders({}).map((p) => p.name), ['mymemory']);
});

test('myMemory uses a byte limit', () => {
  const p = myMemoryProvider();
  assert.equal(p.size('अ'), 3);
});

/* ---------------- HTTP API ---------------- */

async function withServer(providers, fn) {
  const app = createApp({ providers, cache: new LruCache() });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}
const post = (base, body) =>
  fetch(`${base}/api/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const fake = (name, { supports = () => true, fail = false, detected = null, maxChars = 450 } = {}) => ({
  name,
  maxChars,
  supports,
  calls: [],
  async translate(chunk, s, t) {
    this.calls.push({ chunk, s, t });
    if (fail) throw new Error('down');
    return { text: `[${name}:${s}>${t}] ${chunk}`, detected };
  },
});

test('API falls back across providers and validates input', async () => {
  const bad = fake('bad', { fail: true });
  const good = fake('good', { detected: 'fr' });
  await withServer([bad, good], async (base) => {
    const ok = await (await post(base, { text: 'bonjour', source: 'auto', target: 'en' })).json();
    assert.match(ok.text, /^\[good:fr>en\]/, 'after detection the text is re-translated with the detected source');
    assert.equal(ok.detected, 'fr');
    assert.equal(ok.provider, 'good');
    assert.equal((await post(base, { text: '', target: 'en' })).status, 400);
    assert.equal((await post(base, { text: 'x', target: '!!' })).status, 400);
    assert.equal((await post(base, { text: 'x'.repeat(5001), target: 'en' })).status, 413);
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
  });
});

test('API returns 502 when all providers fail', async () => {
  await withServer([fake('bad', { fail: true })], async (base) => {
    assert.equal((await post(base, { text: 'hi', target: 'es' })).status, 502);
  });
});

test('Indian pairs are routed to the India-specialised provider first', async () => {
  const indian = fake('sarvam', { supports: (s, t) => s !== 'auto' && ['hi', 'ta', 'en'].includes(s) && ['hi', 'ta', 'en'].includes(t) });
  const generic = fake('generic');
  await withServer([indian, generic], async (base) => {
    const r = await (await post(base, { text: 'नमस्ते', source: 'hi', target: 'ta' })).json();
    assert.equal(r.provider, 'sarvam');
    assert.equal(generic.calls.length, 0);
    const fr = await (await post(base, { text: 'bonjour', source: 'fr', target: 'ta' })).json();
    assert.equal(fr.provider, 'generic');
  });
});

test('auto-detect: Indian script is detected locally and routed to the Indian provider', async () => {
  const indian = fake('sarvam', { supports: (s) => s !== 'auto' });
  const generic = fake('generic', { supports: () => true });
  await withServer([indian, generic], async (base) => {
    const r = await (await post(base, { text: 'வணக்கம் நண்பா', source: 'auto', target: 'en' })).json();
    assert.equal(r.source, 'ta');
    assert.equal(r.detected, 'ta');
    assert.equal(r.provider, 'sarvam');
    assert.equal(indian.calls[0].s, 'ta');
  });
});

test('auto-detect: Latin text is detected by the engine, then re-routed to the Indian provider', async () => {
  const indian = fake('sarvam', { supports: (s, t) => s !== 'auto' && ['en', 'hi'].includes(s) && ['en', 'hi'].includes(t) });
  const generic = fake('generic', { detected: 'en' });
  await withServer([indian, generic], async (base) => {
    const r = await (await post(base, { text: 'Where is the station?', source: 'auto', target: 'hi' })).json();
    assert.equal(r.detected, 'en');
    assert.equal(r.provider, 'sarvam', 'second pass should use the better engine');
    assert.equal(indian.calls[0].s, 'en');
  });
});

test('auto-detect: text already in the target language is returned unchanged', async () => {
  const generic = fake('generic');
  await withServer([generic], async (base) => {
    const r = await (await post(base, { text: 'नमस्ते', source: 'auto', target: 'hi' })).json();
    assert.equal(r.text, 'नमस्ते');
    assert.equal(generic.calls.length, 0);
  });
});

test('long text is chunked to the provider limit and reassembled', async () => {
  const p = fake('p', { maxChars: 60 });
  await withServer([p], async (base) => {
    const text = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    const r = await (await post(base, { text, source: 'en', target: 'hi' })).json();
    assert.ok(p.calls.length > 1);
    assert.ok(p.calls.every((c) => c.chunk.length <= 60));
    assert.equal(r.provider, 'p');
  });
});

import { countryFromHeaders } from '../src/region.js';

test('countryFromHeaders reads CDN country headers and ignores junk', () => {
  assert.equal(countryFromHeaders({ 'cf-ipcountry': 'IN' }), 'IN');
  assert.equal(countryFromHeaders({ 'cloudfront-viewer-country': 'fr' }), 'FR');
  assert.equal(countryFromHeaders({ 'cf-ipcountry': 'XX' }), null);
  assert.equal(countryFromHeaders({ 'cf-ipcountry': 'T1' }), null);
  assert.equal(countryFromHeaders({ 'x-country-code': 'India' }), null);
  assert.equal(countryFromHeaders({}), null);
});

test('GET /api/region returns the country or null and is never cached', async () => {
  await withServer([], async (base) => {
    let r = await fetch(`${base}/api/region`, { headers: { 'cf-ipcountry': 'IN' } });
    assert.deepEqual(await r.json(), { country: 'IN' });
    assert.equal(r.headers.get('cache-control'), 'no-store');
    r = await fetch(`${base}/api/region`);
    assert.deepEqual(await r.json(), { country: null });
  });
});

import { countryFromIp, countryFromRequest } from '../src/region.js';

test('countryFromIp maps public IPv4 / IPv6 to a country and returns null for everything else', () => {
  assert.equal(countryFromIp('49.36.0.1'), 'IN');
  assert.equal(countryFromIp('::ffff:49.36.0.1'), 'IN'); // IPv4-mapped IPv6, as Node reports it
  assert.equal(countryFromIp('2401:4900::1'), 'IN');
  assert.equal(countryFromIp('8.8.8.8'), 'US');
  for (const bad of ['127.0.0.1', '::1', '10.0.0.5', '192.168.1.10', 'not-an-ip', '', undefined, null, 42, 'x'.repeat(100)]) {
    assert.equal(countryFromIp(bad), null, String(bad));
  }
});

test('countryFromRequest prefers the proxy header, then the IP, then null', () => {
  assert.equal(countryFromRequest({ headers: { 'cf-ipcountry': 'FR' }, ip: '49.36.0.1' }), 'FR');
  assert.equal(countryFromRequest({ headers: { 'cf-ipcountry': 'XX' }, ip: '49.36.0.1' }), 'IN');
  assert.equal(countryFromRequest({ headers: {}, ip: '49.36.0.1' }), 'IN');
  assert.equal(countryFromRequest({ headers: {}, ip: '127.0.0.1' }), null);
});

test('GET /api/region falls back to the client IP (X-Forwarded-For behind a proxy)', async () => {
  await withServer([], async (base) => {
    let r = await fetch(`${base}/api/region`, { headers: { 'x-forwarded-for': '49.36.0.1' } });
    assert.deepEqual(await r.json(), { country: 'IN' });
    r = await fetch(`${base}/api/region`, { headers: { 'x-forwarded-for': '8.8.8.8' } });
    assert.deepEqual(await r.json(), { country: 'US' });
    r = await fetch(`${base}/api/region`, { headers: { 'x-forwarded-for': '8.8.8.8', 'cf-ipcountry': 'IN' } });
    assert.deepEqual(await r.json(), { country: 'IN' }); // header wins over the IP
    r = await fetch(`${base}/api/region`, { headers: { 'x-forwarded-for': 'garbage' } });
    assert.deepEqual(await r.json(), { country: null });
  });
});
