// Download-speed benchmark: how long do the two India packs (571 MB) take, with the CPU slowed down like a phone?
//   node speed.mjs [cpuSlowdown=1] [pointer=fine|coarse]
// Needs the server running with MODELS_DIR pointing at the model files (so the network is not the limit).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_ = process.env.APP_URL || 'http://localhost:3055';
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const slowdown = Number(process.argv[2] || 1);
const pointer = process.argv[3] || 'fine';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'anuvad-speed-'));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: profile,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage();
  if (pointer === 'coarse') {
    // phone-like: coarse pointer + touch viewport (the app then asks before downloading)
    await page.emulate({ viewport: { width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' });
  }
  await page.emulateTimezone('Asia/Kolkata');
  const hosts = {};
  const prep = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    hosts[u.host] = (hosts[u.host] || 0) + 1;
    if (u.pathname.startsWith('/api/models')) prep.push(`${r.method()} ${u.pathname}`);
  });
  const cdp = await page.createCDPSession();
  if (slowdown > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: slowdown });
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="first-run"]', { timeout: 30000 });
  let phase = await page.$eval('[data-testid="first-run"]', (e) => e.dataset.phase);
  if (phase === 'offer') {
    await page.evaluate(() => [...document.querySelectorAll('[data-testid="first-run"] button')].find((b) => /Download/.test(b.textContent)).click());
  }
  const t0 = Date.now();
  let renders = 0;
  for (let i = 0; i < 1200; i++) {
    await sleep(500);
    phase = await page.$eval('[data-testid="first-run"]', (e) => e.dataset.phase).catch(() => 'gone');
    if (phase === 'done' || phase === 'error') break;
  }
  const secs = (Date.now() - t0) / 1000;
  console.log('hosts contacted by the browser:', JSON.stringify(hosts));
  console.log('server-prepare calls:', prep.length, [...new Set(prep)].join(' | '));
  console.log(`cpu x${slowdown} pointer=${pointer}: phase=${phase} in ${secs.toFixed(1)}s -> ${(571 / secs).toFixed(1)} MB/s`);
} finally {
  await browser.close().catch(() => {});
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
