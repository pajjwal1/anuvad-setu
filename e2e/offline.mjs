// Real-browser test of the offline flow against a running server (default http://localhost:3001):
// first visit in India -> auto download of the packs -> go offline -> reload -> translate on the device.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const URL_ = process.env.APP_URL || 'http://localhost:3001';
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SHOTS = new URL('./shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.emulateTimezone('Asia/Kolkata');
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
const apiCalls = [];
page.on('request', (r) => r.url().includes('/api/translate') && apiCalls.push(r.url()));

const text = async (sel) => page.$eval(sel, (e) => e.textContent).catch(() => null);
const shot = (n) => page.screenshot({ path: `${SHOTS}${n}.png` }).catch(() => {});

try {
  // ---- 1. first visit ----
  await page.goto(URL_, { waitUntil: 'networkidle2' });
  check('page title is Anuvad Setu', (await page.title()).includes('Anuvad Setu'), await page.title());
  check('top bar shows the new name', (await text('h1')) === 'Anuvad Setu');

  await page.waitForSelector('[data-testid="first-run"]', { timeout: 15000 }).catch(() => {});
  const phase = await page.$eval('[data-testid="first-run"]', (e) => e.dataset.phase).catch(() => null);
  check('first-run banner appears for an India timezone', !!phase, `phase=${phase}`);
  check('desktop starts the download automatically', phase === 'downloading' || phase === 'done', `phase=${phase}`);
  await shot('1-downloading');

  // ---- 2. download completes ----
  log('waiting for the ~545 MB download');
  let finalPhase = phase;
  for (let i = 0; i < 200 && finalPhase !== 'done' && finalPhase !== 'error'; i++) {
    await sleep(1500);
    finalPhase = await page.$eval('[data-testid="first-run"]', (e) => e.dataset.phase).catch(() => finalPhase);
    if (i % 10 === 0) log(`phase=${finalPhase} ${(await text('[data-testid="first-run"]'))?.slice(0, 80)}`);
  }
  check('download finished', finalPhase === 'done', `phase=${finalPhase} ${finalPhase === 'error' ? await text('[data-testid="first-run"]') : ''}`);
  await shot('2-done');

  const cached = await page.evaluate(async () => {
    const c = await caches.open('lingua-models-v1');
    const keys = await c.keys();
    const bundles = new Set(keys.map((k) => new URL(k.url).pathname.split('/')[2]));
    return { files: keys.length, bundles: [...bundles], persisted: await navigator.storage.persisted() };
  });
  check('18 model files in the Cache API (2 bundles x 9)', cached.files === 18, JSON.stringify(cached));

  // service worker must control the page before we go offline
  const swReady = await page.evaluate(async () => !!(await navigator.serviceWorker?.ready));
  check('service worker is active', swReady);
  await page.evaluate(async () => { await fetch('/ort/ort-wasm-simd-threaded.wasm').then((r) => r.arrayBuffer()); });

  // ---- 3. go offline and reload ----
  await page.setOfflineMode(true);
  log('offline: reloading');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea', { timeout: 15000 }).catch(() => {});
  check('app shell opens while offline', !!(await page.$('textarea')));
  check('offline banner/pill shown', (await page.$('.pill')) !== null);
  await shot('3-offline');

  // ---- 4. translate on the device ----
  apiCalls.length = 0;
  const selects = await page.$$('select.lang-select');
  await selects[0].select('en');
  await selects[1].select('hi');
  await page.type('textarea', 'Where is the railway station? My train leaves at 10:30.');
  const start = Date.now();
  let out = '';
  for (let i = 0; i < 120; i++) {
    await sleep(1000);
    out = (await text('.result')) || '';
    if (/[\u0900-\u097F]/.test(out)) break;
    if (i % 10 === 5) log(`still waiting... "${out.slice(0, 60)}" status=${await text('.output .muted.small.pad')}`);
  }
  const secs = ((Date.now() - start) / 1000).toFixed(1);
  check('offline English -> Hindi produced Devanagari text', /[\u0900-\u097F]/.test(out), `${secs}s "${out}"`);
  check('"10:30" survived translation', out.includes('10:30'), out);
  check('result labelled "Translated on this device"', ((await text('.output .pane-foot')) || '').includes('on this device'));
  check('no /api/translate request while offline', apiCalls.length === 0);
  const roman = await text('[data-testid="roman-out"]');
  check('romanization line shown under Hindi output', !!roman && /[a-z]/i.test(roman), roman);
  await shot('4-translated');

  // second sentence timing (model is warm now)
  await page.click('textarea', { clickCount: 3 });
  await page.type('textarea', 'Please help me.');
  const s2 = Date.now();
  let out2 = out;
  for (let i = 0; i < 60 && out2 === out; i++) { await sleep(500); out2 = (await text('.result')) || ''; }
  check('second (warm) translation works', out2 !== out && /[\u0900-\u097F]/.test(out2), `${((Date.now() - s2) / 1000).toFixed(1)}s "${out2}"`);

  // ---- 5. Indian -> English offline, uses the other bundle ----
  await selects[0].select('hi');
  await selects[1].select('en');
  await page.click('textarea', { clickCount: 3 });
  await page.type('textarea', 'मुझे पानी चाहिए');
  let en = '';
  for (let i = 0; i < 120; i++) { await sleep(1000); en = (await text('.result')) || ''; if (/[A-Za-z]{3,}/.test(en) && !/Translat/.test(en)) break; }
  check('offline Hindi -> English works', /water/i.test(en), en);

  // ---- 6. private mode ----
  apiCalls.length = 0;
  await page.setOfflineMode(false);
  await page.evaluate(() => localStorage.removeItem('anuvadsetu.history.v1'));
  const privBtn = await page.$('button[aria-pressed]');
  const btns = await page.$$('button');
  for (const b of btns) if ((await b.evaluate((e) => e.textContent)).includes('Private')) { await b.click(); break; }
  await page.waitForSelector('[data-testid="private-badge"]', { timeout: 5000 }).catch(() => {});
  check('private badge visible', !!(await page.$('[data-testid="private-badge"]')));
  await selects[0].select('en');
  await selects[1].select('ta');
  await page.click('textarea', { clickCount: 3 });
  await page.type('textarea', 'Good morning');
  let ta = '';
  for (let i = 0; i < 90; i++) { await sleep(1000); ta = (await text('.result')) || ''; if (/[\u0B80-\u0BFF]/.test(ta)) break; }
  check('private mode translates English -> Tamil on the device', /[\u0B80-\u0BFF]/.test(ta), ta);
  check('private mode made NO /api/translate request even while online', apiCalls.length === 0, `${apiCalls.length} calls`);
  const where = await page.evaluate(() => ({
    local: JSON.stringify(Object.entries(localStorage)),
    session: JSON.stringify(Object.entries(sessionStorage)),
  }));
  check('private history is in sessionStorage', where.session.includes('Good morning'));
  check('private text is NOT in localStorage', !where.local.includes('Good morning'));
  await page.$eval('button[aria-label="Save phrase"]', (b) => b.click());
  const after = await page.evaluate(() => ({
    local: JSON.stringify(Object.entries(localStorage)),
    session: sessionStorage.getItem('anuvadsetu.phrasebook.v1') || '',
  }));
  check('private saved phrase goes to sessionStorage only', after.session.includes('Good morning') && !after.local.includes('Good morning'));
  await shot('6-private');

  // closing the tab erases the private session: open the same app in a NEW tab of the same browser
  const tab2 = await browser.newPage();
  await tab2.goto(URL_, { waitUntil: 'domcontentloaded' });
  const t2 = await tab2.evaluate(() => ({
    flag: sessionStorage.getItem('anuvadsetu.private.v1'),
    hist: sessionStorage.getItem('anuvadsetu.history.v1'),
    local: JSON.stringify(Object.entries(localStorage)),
  }));
  check('a new tab starts with no private session', !t2.flag && !t2.hist);
  check('nothing private reached localStorage (seen from the new tab)', !t2.local.includes('Good morning'));
  await tab2.close();

  // leaving private mode wipes the session data
  for (const b of await page.$$('button')) if ((await b.evaluate((e) => e.textContent)).includes('Private')) { await b.click(); break; }
  await sleep(500);
  const wiped = await page.evaluate(() => sessionStorage.length);
  check('turning private mode off erases the session data', wiped === 0, `sessionStorage items=${wiped}`);
} catch (err) {
  check('test run completed without crashing', false, err.stack || String(err));
  await shot('crash');
} finally {
  const bad = consoleErrors.filter((e) => !/Failed to load resource|net::ERR/.test(e));
  console.log(`\nconsole/page errors: ${bad.length}`);
  bad.slice(0, 8).forEach((e) => console.log('  ' + e.slice(0, 300)));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}
