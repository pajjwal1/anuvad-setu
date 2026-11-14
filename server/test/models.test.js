import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/index.js';
import { LruCache } from '../src/cache.js';
import { BUNDLES, createModelStore, downloadTo, hfUrl } from '../src/models.js';
import { BUNDLES as CLIENT_BUNDLES } from '../../client/src/offline/store.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'anuvad-models-'));
const wait = async (cond, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
};

/** A tiny pack so tests do not move hundreds of MB. Contents of each file = its name repeated to the size. */
const MINI = {
  mini: { repo: 'x/mini', sha: 'abc', files: { 'a.bin': 1000, 'b.json': 20 } },
  other: { repo: 'x/other', sha: 'def', files: { 'c.bin': 50 } },
};
const body = (name, size) => Buffer.from(name.repeat(size).slice(0, size));
const fakeHf = (log = []) => async (url) => {
  log.push(url);
  const m = /^https:\/\/huggingface\.co\/(.+)\/resolve\/(.+)\/(.+)$/.exec(url);
  const pack = Object.values(MINI).find((b) => b.repo === m?.[1] && b.sha === m?.[2]);
  const size = pack?.files[m?.[3]];
  if (!size) return new Response('nope', { status: 404 });
  return new Response(body(m[3], size), { status: 200 });
};

test('server and client list exactly the same packs, files, sizes and revisions', () => {
  // World-language packs (hfOnly) are downloaded from Hugging Face and are deliberately not on this server.
  const mirrored = Object.keys(CLIENT_BUNDLES).filter((id) => !CLIENT_BUNDLES[id].hfOnly);
  assert.deepEqual(Object.keys(BUNDLES).sort(), mirrored.sort());
  for (const [id, b] of Object.entries(BUNDLES)) {
    const c = CLIENT_BUNDLES[id];
    assert.equal(b.repo, c.repo, id);
    assert.equal(b.sha, c.sha, id);
    assert.deepEqual(
      Object.entries(b.files).sort(),
      c.files.map((f) => [f.name, f.size]).sort(),
      `${id} files`,
    );
  }
});

test('downloadTo writes the file only when the size is exact and leaves no partial file behind', async () => {
  const dir = tmp();
  const dest = path.join(dir, 'f.bin');
  await downloadTo('https://x/f', dest, 5, { fetchImpl: async () => new Response('12345') });
  assert.equal(fs.readFileSync(dest, 'utf8'), '12345');
  const bad = path.join(dir, 'g.bin');
  await assert.rejects(downloadTo('https://x/g', bad, 9, { fetchImpl: async () => new Response('12345') }), /size mismatch/);
  assert.equal(fs.existsSync(bad), false);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['f.bin']); // no *.part left
  await assert.rejects(downloadTo('https://x/h', path.join(dir, 'h.bin'), 1, { fetchImpl: async () => new Response('', { status: 404 }) }), /HTTP 404/);
});

test('model store: unknown ids are rejected, a missing pack is fetched once and then reported ready', async () => {
  const dir = tmp();
  const calls = [];
  const store = createModelStore({ dir, bundles: MINI, fetchImpl: fakeHf(calls), retryDelayMs: 1, log: {} });
  assert.equal(store.status('nope'), null);
  assert.equal(store.status('../etc'), null);
  assert.equal(store.status('__proto__'), null);
  assert.equal(store.prepare('constructor'), null);
  assert.equal(store.status('mini').state, 'idle');

  const first = store.prepare('mini');
  assert.equal(first.state, 'running');
  // asking again while it runs must not start a second download
  assert.equal(store.prepare('mini').state, 'running');
  await wait(() => store.status('mini').ready);
  assert.equal(store.status('mini').state, 'ready');
  assert.equal(store.status('mini').doneBytes, 1020);
  assert.equal(calls.length, 2, 'each file fetched exactly once');
  assert.equal(fs.readFileSync(path.join(dir, 'mini', 'b.json'), 'utf8').length, 20);

  // already on disk: nothing is fetched again
  assert.equal(store.prepare('mini').state, 'ready');
  assert.equal(calls.length, 2);
  // the other pack is untouched
  assert.equal(store.status('other').state, 'idle');
});

test('model store: files already on disk are kept, only the missing ones are fetched', async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'mini'));
  fs.writeFileSync(path.join(dir, 'mini', 'a.bin'), body('a.bin', 1000));
  const calls = [];
  const store = createModelStore({ dir, bundles: MINI, fetchImpl: fakeHf(calls), retryDelayMs: 1, log: {} });
  assert.equal(store.status('mini').ready, false);
  store.prepare('mini');
  await wait(() => store.status('mini').ready);
  assert.deepEqual(calls, [hfUrl(MINI.mini, 'b.json')]);
});

test('model store: a wrong-size file on disk is replaced, and a failing source reports an error (then can be retried)', async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'mini'));
  fs.writeFileSync(path.join(dir, 'mini', 'a.bin'), 'truncated');
  let fail = true;
  const good = fakeHf();
  const store = createModelStore({
    dir,
    bundles: MINI,
    fetchImpl: async (u) => (fail ? new Response('', { status: 503 }) : good(u)),
    retries: 2,
    retryDelayMs: 1,
    log: {},
  });
  store.prepare('mini');
  await wait(() => store.status('mini').state === 'error');
  assert.match(store.status('mini').error, /HTTP 503/);
  fail = false;
  store.prepare('mini'); // a later visitor triggers a fresh attempt
  await wait(() => store.status('mini').ready);
  assert.equal(fs.statSync(path.join(dir, 'mini', 'a.bin')).size, 1000);
});

async function withApp(models, fn) {
  const server = createApp({ providers: [], cache: new LruCache(), models }).listen(0);
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

test('GET /api/models/:id and POST /api/models/:id/prepare', async () => {
  const dir = tmp();
  const store = createModelStore({ dir, bundles: MINI, fetchImpl: fakeHf(), retryDelayMs: 1, log: {} });
  await withApp(store, async (base) => {
    let r = await fetch(`${base}/api/models/mini`);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal((await r.json()).state, 'idle');
    r = await fetch(`${base}/api/models/mini/prepare`, { method: 'POST' });
    assert.equal(r.status, 200);
    assert.ok(['running', 'ready'].includes((await r.json()).state));
    await wait(() => store.status('mini').ready);
    const s = await (await fetch(`${base}/api/models/mini`)).json();
    assert.equal(s.ready, true);
    assert.equal(s.totalBytes, 1020);
    // unknown / hostile ids
    for (const id of ['nope', '..%2F..%2Fetc', '__proto__', 'constructor']) {
      assert.equal((await fetch(`${base}/api/models/${id}`)).status, 404, id);
      assert.equal((await fetch(`${base}/api/models/${id}/prepare`, { method: 'POST' })).status, 404, id);
    }
    // GET must never start a download
    assert.equal((await (await fetch(`${base}/api/models/other`)).json()).state, 'idle');
  });
});

test('/models serves a prepared pack with Range support', async () => {
  const prev = process.env.MODELS_DIR;
  const dir = tmp();
  process.env.MODELS_DIR = dir;
  try {
    const store = createModelStore({ dir, bundles: MINI, fetchImpl: fakeHf(), retryDelayMs: 1, log: {} });
    await withApp(store, async (base) => {
      store.prepare('mini');
      await wait(() => store.status('mini').ready);
      const r = await fetch(`${base}/models/mini/a.bin`, { headers: { Range: 'bytes=0-9' } });
      assert.equal(r.status, 206);
      assert.equal((await r.text()).length, 10);
    });
  } finally {
    if (prev === undefined) delete process.env.MODELS_DIR;
    else process.env.MODELS_DIR = prev;
  }
});
