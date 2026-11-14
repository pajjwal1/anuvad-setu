// On-device model store: manifest of the IndicTrans2 bundles + download / verify / read / delete,
// backed by the Cache API (works in both the page and the worker).
//
// Indian-language bundles are fetched from our own server first (/models/<bundle>/<file>) and fall back to the
// pinned Hugging Face revision, so a deployment works with or without a model mirror.
// World-language packs (OPUS-MT / Marian, see world.manifest.js) are NEVER on our server: they come straight
// from their pinned Hugging Face revision.
import { WORLD_MANIFEST } from './world.manifest.js';

const f = (name, size) => ({ name, size });

export const BUNDLES = {
  'indic-en': {
    id: 'indic-en',
    label: 'Indian languages → English',
    repo: 'hari31416/indictrans2-indic-en-dist-200M-ONNX-int8',
    sha: 'a7ecdc0ba73148c6e1d051ca372332471d8aff4f',
    files: [
      f('encoder_model.onnx', 831436),
      f('encoder_model.onnx.data', 120068096),
      f('decoder_model.onnx', 1585382),
      f('decoder_with_past_model.onnx', 1398395),
      f('decoder_shared.onnx.data', 110052040),
      f('tokenizer_src.json', 23876630),
      f('tokenizer_tgt.json', 3899748),
      f('tokenizer_meta.json', 70),
      f('generation_config.json', 163),
    ],
  },
  'en-indic': {
    id: 'en-indic',
    label: 'English → Indian languages',
    repo: 'hari31416/indictrans2-en-indic-dist-200M-ONNX-int8',
    sha: '1eaa43a3fb76f382f1b22c76e56f6ab4926ad68b',
    files: [
      f('encoder_model.onnx', 831399),
      f('encoder_model.onnx.data', 73791488),
      f('decoder_model.onnx', 2037502),
      f('decoder_with_past_model.onnx', 1850479),
      f('decoder_shared.onnx.data', 203048944),
      f('tokenizer_src.json', 3906621),
      f('tokenizer_tgt.json', 23869629),
      f('tokenizer_meta.json', 70),
      f('generation_config.json', 163),
    ],
  },
  'indic-indic': {
    id: 'indic-indic',
    label: 'Indian ↔ Indian (direct)',
    repo: 'hari31416/indictrans2-indic-indic-dist-320M-ONNX-int8',
    sha: 'b04956dee2f2a3e06e44bf09f8d654a6b81af99a',
    files: [
      f('encoder_model.onnx', 831435),
      f('encoder_model.onnx.data', 120068096),
      f('decoder_model.onnx', 2037642),
      f('decoder_with_past_model.onnx', 1850619),
      f('decoder_shared.onnx.data', 203048944),
      f('tokenizer_src.json', 23876630),
      f('tokenizer_tgt.json', 23869629),
      f('tokenizer_meta.json', 71),
      f('generation_config.json', 168),
    ],
  },
};

// One bundle per world-language direction (e.g. 'mt-en-fr'). `kind: 'marian'` selects the Marian inference path;
// `hfOnly` means the files come from Hugging Face only, never from /models on our server.
for (const p of WORLD_MANIFEST) {
  BUNDLES[p.id] = {
    id: p.id,
    kind: 'marian',
    hfOnly: true,
    from: p.from,
    to: p.to,
    label: `${p.from} → ${p.to}`,
    repo: p.repo,
    sha: p.sha,
    files: p.files.map((x) => ({ ...x })),
  };
}

for (const b of Object.values(BUNDLES)) b.size = b.files.reduce((n, x) => n + x.size, 0);

const CACHE = 'lingua-models-v1';
const INSTALLED_KEY = 'lingua.bundles.v2';

// The cache key keeps the /models/<bundle>/<file> shape for every bundle, so isComplete / readFile / remove are shared.
const fileKey = (bundle, name) => `/models/${bundle}/${name}`;
const hfFile = (b, name) => b.files.find((x) => x.name === name)?.path ?? name; // world packs keep files in onnx/
const sources = (b, name) => [fileKey(b.id, name), `https://huggingface.co/${b.repo}/resolve/${b.sha}/${hfFile(b, name)}`];

/**
 * Where to fetch a file from, in order:
 *   'server'       our server only (phones and tablets, once the server has prepared the pack)
 *   'hf-first'     Hugging Face, then our server as backup (computers)
 *   'server-first' our server, then Hugging Face (phones when the server cannot prepare packs)
 */
export function sourceOrder(b, name, mode) {
  const [server, hf] = sources(b, name);
  if (b.hfOnly) return [hf]; // world packs: Hugging Face only, whatever the device
  if (mode === 'server') return [server];
  if (mode === 'hf-first') return [hf, server];
  return [server, hf];
}

/* ---------- installed bookkeeping (sync mirror in localStorage, truth in Cache API) ---------- */

export function getInstalledBundles() {
  try {
    return new Set(JSON.parse(localStorage.getItem(INSTALLED_KEY) || '[]').filter((id) => BUNDLES[id]));
  } catch {
    return new Set();
  }
}
const saveInstalled = (set) => {
  try {
    localStorage.setItem(INSTALLED_KEY, JSON.stringify([...set]));
  } catch {
    /* storage unavailable */
  }
};

async function isComplete(cache, b) {
  for (const file of b.files) {
    const res = await cache.match(fileKey(b.id, file.name));
    if (!res) return false;
    if (Number(res.headers.get('content-length')) !== file.size) return false;
  }
  return true;
}

/** Re-check what is really in the cache (the browser may evict storage) and update the mirror. */
export async function refreshInstalled() {
  if (!('caches' in self)) return new Set();
  const cache = await caches.open(CACHE);
  const set = new Set();
  for (const b of Object.values(BUNDLES)) if (await isComplete(cache, b)) set.add(b.id);
  saveInstalled(set);
  return set;
}

/* ---------- download ---------- */

async function downloadFile(cache, b, file, signal, onBytes, mode = 'server-first') {
  let lastErr;
  for (const url of sourceOrder(b, file.name, mode)) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let got = 0;
      try {
        const res = await fetch(url, { signal });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const counter = new TransformStream({
          transform(chunk, ctl) {
            got += chunk.byteLength;
            onBytes(chunk.byteLength);
            ctl.enqueue(chunk);
          },
          flush() {
            if (got !== file.size) throw new Error(`Unexpected size for ${file.name} (${got} bytes)`);
          },
        });
        await cache.put(
          fileKey(b.id, file.name),
          new Response(res.body.pipeThrough(counter), { headers: { 'content-length': String(file.size) } }),
        );
        return;
      } catch (err) {
        onBytes(-got); // roll back this attempt's progress
        if (signal?.aborted) throw err;
        // A full disk will not get better by retrying or by trying another server.
        if (err?.name === 'QuotaExceededError' || /quota/i.test(err?.message || '')) {
          throw new Error('Not enough free storage on this device. Offline translation will not work until you free up space.');
        }
        lastErr = err;
        if (/^HTTP 4\d\d/.test(err.message)) break; // not found here -> try the next source
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
  }
  throw new Error(`Couldn't download ${file.name}: ${lastErr?.message || 'network error'}`);
}

const CONCURRENCY = 3; // files fetched at the same time: one slow connection no longer holds up the rest

/** Phones and tablets (touch as the main input) get their packs from our own server only. */
const prefersServerOnly = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

const abortError = () => new DOMException('Aborted', 'AbortError');
const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(abortError())), { once: true });
  });

/**
 * Ask our server to fetch the pack from Hugging Face (once, for everyone) and wait until it has it, so the
 * device can then download it from /models on our server. Resolves true when the server has the pack, false
 * when this server cannot do that (older server, unreachable) so the caller keeps the normal behaviour.
 */
async function prepareOnServer(id, signal, onStatus) {
  const STALL_MS = 180_000; // give up when the server's own download makes no progress for 3 minutes
  let lastBytes = -1;
  let lastChange = Date.now();
  let started = false;
  for (;;) {
    let s = null;
    try {
      const res = await fetch(started ? `/api/models/${id}` : `/api/models/${id}/prepare`, {
        method: started ? 'GET' : 'POST',
        signal,
      });
      if (res.ok) s = await res.json();
    } catch (err) {
      if (signal?.aborted) throw err;
    }
    if (!s) {
      if (!started) return false; // endpoint missing or server unreachable: use the normal download path
      throw new Error('Lost contact with the server while it prepared the language pack. Please try again.');
    }
    started = true;
    if (s.ready) return true;
    if (s.state === 'error') throw new Error(`The server could not get this language pack: ${s.error || 'unknown error'}`);
    if (s.state === 'idle') {
      started = false; // the job ended without finishing (e.g. server restarted): start it again
    }
    if (s.doneBytes !== lastBytes) {
      lastBytes = s.doneBytes;
      lastChange = Date.now();
    } else if (Date.now() - lastChange > STALL_MS) {
      throw new Error('The server is taking too long to prepare this language pack. Please try again later.');
    }
    const pct = s.totalBytes ? Math.round((s.doneBytes / s.totalBytes) * 100) : 0;
    onStatus?.(`Preparing the language pack on our server (${pct}%), the first time only…`);
    await sleep(1500, signal);
  }
}

/**
 * Download every file of a bundle. Files that are already complete are skipped, so an interrupted
 * download resumes from the last finished file.
 * On phones and tablets the server is asked to prepare the pack first and the files then come from it only
 * (never straight from Hugging Face). Computers download from Hugging Face directly, with our server as backup,
 * so they put no load on the server. `onStatus(text)` reports the "preparing on the server" phase ('' when over).
 */
export async function downloadBundle(id, onProgress, signal, { onStatus } = {}) {
  const b = BUNDLES[id];
  if (!b) throw new Error('Unknown model bundle');
  if (!('caches' in self)) {
    throw new Error(
      self.isSecureContext === false
        ? 'Offline packs need a secure (HTTPS) connection. Open this app over https:// (or localhost) to download them.'
        : 'This browser cannot store offline models.',
    );
  }
  // The WASM runtime is cached by the service worker only when first used; fetch it now so the engine
  // still starts if the user goes offline before ever translating.
  await Promise.all(
    ['/ort/ort-wasm-simd-threaded.mjs', '/ort/ort-wasm-simd-threaded.wasm'].map((u) =>
      fetch(u).then((r) => r.arrayBuffer()),
    ),
  ).catch(() => {});
  const cache = await caches.open(CACHE);
  let mode = 'hf-first'; // computers
  if (prefersServerOnly() && !b.hfOnly) {
    mode = 'server-first'; // phones / tablets, unless the server confirms it has the pack below
    if (!(await isComplete(cache, b))) {
      try {
        if (await prepareOnServer(id, signal, onStatus)) mode = 'server';
      } finally {
        onStatus?.('');
      }
    }
  }
  let loaded = 0;
  let lastReport = 0;
  const bump = (n) => {
    loaded += n;
    // Report at most ~5 times a second: re-rendering the page on every network chunk slows phones down.
    const now = Date.now();
    if (now - lastReport < 200) return;
    lastReport = now;
    onProgress?.(Math.max(0, Math.min(loaded / b.size, 0.999)));
  };
  const todo = [];
  for (const file of b.files) {
    const have = await cache.match(fileKey(id, file.name));
    if (have && Number(have.headers.get('content-length')) === file.size) bump(file.size);
    else todo.push(file);
  }
  todo.sort((x, y) => y.size - x.size); // start the biggest files first so they are not left until the end

  // Phones dim the screen and then throttle or pause the page: ask to keep it awake while downloading.
  let wake = null;
  try {
    wake = (await navigator.wakeLock?.request('screen')) ?? null;
  } catch {
    /* not supported, or refused (e.g. battery saver) */
  }

  const inner = new AbortController(); // lets one failed file stop the others
  const stop = () => inner.abort();
  signal?.addEventListener('abort', stop, { once: true });
  const worker = async () => {
    while (todo.length && !inner.signal.aborted) await downloadFile(cache, b, todo.shift(), inner.signal, bump, mode);
  };
  try {
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, todo.length) }, () =>
        worker().catch((err) => {
          stop();
          throw err;
        }),
      ),
    );
  } finally {
    signal?.removeEventListener('abort', stop);
    wake?.release().catch(() => {});
  }
  const set = getInstalledBundles();
  set.add(id);
  saveInstalled(set);
  onProgress?.(1);
}

export async function removeBundle(id) {
  const b = BUNDLES[id];
  if (!b) return;
  if ('caches' in self) {
    const cache = await caches.open(CACHE);
    for (const file of b.files) await cache.delete(fileKey(id, file.name));
  }
  const set = getInstalledBundles();
  set.delete(id);
  saveInstalled(set);
}

/* ---------- read (used by the worker) ---------- */

export async function readFile(id, name, as = 'buffer') {
  const cache = await caches.open(CACHE);
  const res = await cache.match(fileKey(id, name));
  if (!res) throw new Error(`Model file missing: ${name}. Re-download the pack.`);
  return as === 'json' ? res.json() : new Uint8Array(await res.arrayBuffer());
}

export async function estimateStorage() {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}
