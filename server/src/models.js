// On-device model packs (IndicTrans2 int8 ONNX, MIT licence): the manifest, and a store that fetches a pack from
// Hugging Face into MODELS_DIR on request so that every visitor downloads it from THIS server (served at /models).
//
// Revisions and sizes must match client/src/offline/store.js (a test checks it).
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const BUNDLES = {
  'indic-en': {
    repo: 'hari31416/indictrans2-indic-en-dist-200M-ONNX-int8',
    sha: 'a7ecdc0ba73148c6e1d051ca372332471d8aff4f',
    files: {
      'encoder_model.onnx': 831436,
      'encoder_model.onnx.data': 120068096,
      'decoder_model.onnx': 1585382,
      'decoder_with_past_model.onnx': 1398395,
      'decoder_shared.onnx.data': 110052040,
      'tokenizer_src.json': 23876630,
      'tokenizer_tgt.json': 3899748,
      'tokenizer_meta.json': 70,
      'generation_config.json': 163,
    },
  },
  'en-indic': {
    repo: 'hari31416/indictrans2-en-indic-dist-200M-ONNX-int8',
    sha: '1eaa43a3fb76f382f1b22c76e56f6ab4926ad68b',
    files: {
      'encoder_model.onnx': 831399,
      'encoder_model.onnx.data': 73791488,
      'decoder_model.onnx': 2037502,
      'decoder_with_past_model.onnx': 1850479,
      'decoder_shared.onnx.data': 203048944,
      'tokenizer_src.json': 3906621,
      'tokenizer_tgt.json': 23869629,
      'tokenizer_meta.json': 70,
      'generation_config.json': 163,
    },
  },
  'indic-indic': {
    repo: 'hari31416/indictrans2-indic-indic-dist-320M-ONNX-int8',
    sha: 'b04956dee2f2a3e06e44bf09f8d654a6b81af99a',
    files: {
      'encoder_model.onnx': 831435,
      'encoder_model.onnx.data': 120068096,
      'decoder_model.onnx': 2037642,
      'decoder_with_past_model.onnx': 1850619,
      'decoder_shared.onnx.data': 203048944,
      'tokenizer_src.json': 23876630,
      'tokenizer_tgt.json': 23869629,
      'tokenizer_meta.json': 71,
      'generation_config.json': 168,
    },
  },
};

export const hfUrl = (b, name) => `https://huggingface.co/${b.repo}/resolve/${b.sha}/${name}`;

const sizeOf = (file) => {
  try {
    return fs.statSync(file).size;
  } catch {
    return -1;
  }
};

/**
 * Download `url` to `dest`. Written to a temporary file first and renamed only when the size is exactly `size`,
 * so a half-written file is never served. The temporary name contains the process id, so the background
 * fetch-models script and the running server cannot trample each other.
 */
export async function downloadTo(url, dest, size, { fetchImpl = globalThis.fetch, part = `${dest}.${process.pid}.part` } = {}) {
  try {
    const res = await fetchImpl(url);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(part));
    const got = sizeOf(part);
    if (got !== size) throw new Error(`size mismatch: got ${got}, expected ${size}`);
    fs.renameSync(part, dest);
  } catch (err) {
    fs.rmSync(part, { force: true });
    throw err;
  }
}

/**
 * Keeps packs in `dir` (<dir>/<pack>/<file>, served at /models). `prepare(id)` starts fetching a pack that is not
 * on disk yet (once, however many visitors ask) and `status(id)` reports progress. State is read from the disk, so
 * a restart or the background fetch-models script is picked up automatically.
 */
export function createModelStore({
  dir,
  bundles = BUNDLES,
  fetchImpl = globalThis.fetch,
  retries = 3,
  retryDelayMs = 1000,
  log = console,
} = {}) {
  const jobs = new Map(); // pack id -> { running, error }
  const known = (id) => typeof id === 'string' && Object.hasOwn(bundles, id);

  function status(id) {
    if (!known(id)) return null;
    const job = jobs.get(id);
    let doneBytes = 0;
    let totalBytes = 0;
    let ready = true;
    for (const [name, size] of Object.entries(bundles[id].files)) {
      const dest = path.join(dir, id, name);
      totalBytes += size;
      if (sizeOf(dest) === size) doneBytes += size;
      else {
        ready = false;
        if (job?.running) doneBytes += Math.min(Math.max(sizeOf(`${dest}.${process.pid}.part`), 0), size);
      }
    }
    const state = ready ? 'ready' : job?.running ? 'running' : job?.error ? 'error' : 'idle';
    return { id, ready, state, doneBytes, totalBytes, error: state === 'error' ? job.error : null };
  }

  async function withRetries(fn) {
    let last;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        last = err;
        if (attempt < retries - 1) await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
      }
    }
    throw last;
  }

  async function run(id, job) {
    const b = bundles[id];
    try {
      fs.mkdirSync(path.join(dir, id), { recursive: true });
      for (const [name, size] of Object.entries(b.files)) {
        const dest = path.join(dir, id, name);
        if (sizeOf(dest) === size) continue;
        log.log?.(`[models] fetching ${id}/${name}`);
        await withRetries(() => downloadTo(hfUrl(b, name), dest, size, { fetchImpl }));
      }
      log.log?.(`[models] ${id} ready`);
    } catch (err) {
      job.error = err.message || String(err);
      log.warn?.(`[models] ${id} failed: ${job.error}`);
    } finally {
      job.running = false;
    }
  }

  function prepare(id) {
    const s = status(id);
    if (!s || s.ready || s.state === 'running') return s;
    const job = { running: true, error: null };
    jobs.set(id, job);
    run(id, job);
    return status(id);
  }

  return { status, prepare };
}
