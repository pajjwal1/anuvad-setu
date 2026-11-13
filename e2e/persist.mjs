// Does the offline pack download happen only once? Uses a persistent browser profile and restarts the browser.
//   node persist.mjs full         first visit -> finish download -> close browser -> reopen -> expect NO /models requests
//   node persist.mjs interrupted  first visit -> kill the browser mid-download -> reopen -> count re-downloaded bytes
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_ = process.env.APP_URL || 'http://localhost:3055';
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const mode = process.argv[2] || 'full';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'anuvad-profile-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function visit(label, { killAtPct } = {}) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    userDataDir: profile,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.emulateTimezone('Asia/Kolkata');
  const reqs = [];
  const bytes = { n: 0 };
  page.on('response', async (r) => {
    if (!r.url().includes('/models/')) return;
    reqs.push(new URL(r.url()).pathname.replace('/models/', ''));
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  cdp.on('Network.dataReceived', (e) => (bytes.n += e.dataLength));

  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await sleep(5000);
  const banner = () =>
    page.$eval('[data-testid="first-run"]', (e) => ({ phase: e.dataset.phase, text: e.textContent.slice(0, 110) })).catch(() => null);

  let b = await banner();
  console.log(`[${label}] banner after load:`, JSON.stringify(b));
  if (killAtPct) {
    for (let i = 0; i < 400; i++) {
      await sleep(500);
      const pct = await page.$eval('[role=progressbar]', (e) => Number(e.getAttribute('aria-valuenow'))).catch(() => 0);
      if (pct >= killAtPct) break;
    }
    console.log(`[${label}] killing the browser at ${bytes.n} bytes received`);
    browser.process().kill('SIGKILL');
    return { reqs, bytes: bytes.n };
  }
  for (let i = 0; i < 400 && b && b.phase === 'downloading'; i++) {
    await sleep(500);
    b = await banner();
  }
  await sleep(2000);
  const state = await page.evaluate(async () => {
    const c = await caches.open('lingua-models-v1');
    return { files: (await c.keys()).length, persisted: await navigator.storage.persisted(), flag: localStorage.getItem('anuvadsetu.firstrun.v1'), bundles: localStorage.getItem('lingua.bundles.v2') };
  });
  console.log(`[${label}] final banner:`, JSON.stringify(await banner()), 'state:', JSON.stringify(state));
  console.log(`[${label}] /models responses: ${reqs.length}, bytes received: ${(bytes.n / 1e6).toFixed(0)} MB`);
  await browser.close();
  return { reqs, bytes: bytes.n };
}

try {
  if (mode === 'interrupted') {
    await visit('visit 1 (killed)', { killAtPct: 55 });
    await sleep(1500);
    const r = await visit('visit 2 (reopen)');
    console.log(`RESULT interrupted: second visit fetched ${(r.bytes / 1e6).toFixed(0)} MB (total packs 571 MB)`);
  } else {
    const a = await visit('visit 1');
    const b = await visit('visit 2 (reopen)');
    console.log(`RESULT full: visit 2 made ${b.reqs.length} /models requests, ${(b.bytes / 1e6).toFixed(0)} MB (first visit ${(a.bytes / 1e6).toFixed(0)} MB)`);
    console.log(b.reqs.length === 0 ? 'PASS: nothing re-downloaded' : 'FAIL: downloaded again');
  }
} catch (e) { console.log('ERROR', e.stack || e); } finally {
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}

