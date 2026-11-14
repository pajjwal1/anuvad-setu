// Real-browser test of the WORLD-language packs against a running server (default http://localhost:3001):
// open Offline panel -> download English->French and French->English straight from Hugging Face ->
// confirm nothing was requested from /models -> go offline -> reload -> translate both ways on the device.
import puppeteer from 'puppeteer-core';

const URL_ = process.env.APP_URL || 'http://localhost:3001';
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', `--unsafely-treat-insecure-origin-as-secure=${new URL(URL_).origin}`] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.emulateTimezone('America/New_York'); // not India: no automatic Indian download
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const modelRequests = [];
const hfRequests = [];
const apiTranslate = [];
page.on('request', (r) => {
  const u = r.url();
  if (new URL(u).origin === new URL(URL_).origin && u.includes('/models/')) modelRequests.push(u);
  if (u.startsWith('https://huggingface.co/')) hfRequests.push(u);
  if (u.includes('/api/translate')) apiTranslate.push(u);
});

const clickButton = async (label) => {
  const ok = await page.evaluate((l) => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || x.textContent).trim().startsWith(l));
    if (!b || b.disabled) return false;
    b.click();
    return true;
  }, label);
  return ok;
};
const selectLang = async (sel, code) => page.select(sel, code);

try {
  await page.goto(URL_, { waitUntil: 'networkidle2' });
  await page.evaluate(() => {
    try { localStorage.clear(); } catch {}
  });
  await page.reload({ waitUntil: 'networkidle2' });
  check('page loads', (await page.title()).includes('Anuvad Setu'));

  // ---- 1. language picker shows the world group ----
  const groups = await page.$$eval('select.lang-select:first-of-type optgroup', (g) => g.map((x) => x.label));
  check('picker has "World languages (offline with a download)"', groups.includes('World languages (offline with a download)'), groups.join(' | '));
  const frOpt = await page.$eval('select.lang-select option[value="fr"]', (o) => o.parentElement.label).catch(() => null);
  check('French is in the offline-capable group', frOpt === 'World languages (offline with a download)', String(frOpt));
  const roOpt = await page.$eval('select.lang-select option[value="pt"]', (o) => o.parentElement.label).catch(() => null);
  check('Portuguese (no pack) stays in the online-only group', /online only/.test(String(roOpt)), String(roOpt));

  // ---- 2. open the Offline panel and download both French directions ----
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Offline')?.click());
  await page.waitForSelector('[data-testid="world-fr"]', { timeout: 10000 });
  check('Offline panel lists French with two buttons', (await page.$$eval('[data-testid="world-fr"] button', (b) => b.length)) === 2);
  check('English → French button shows its size', await page.$eval('[data-testid="world-fr"]', (e) => /English → French · \d+ MB/.test(e.textContent)));

  await clickButton('Download English → French');
  await clickButton('Download French → English');
  log('downloading both French packs from Hugging Face (~226 MB)');
  let done = false;
  for (let i = 0; i < 240 && !done; i++) {
    await sleep(1500);
    const txt = await page.$eval('[data-testid="world-fr"]', (e) => e.textContent);
    done = /✓ English → French/.test(txt) && /✓ French → English/.test(txt);
    if (i % 10 === 0) log(txt.replace(/\s+/g, ' ').slice(0, 110));
  }
  check('both French packs finished downloading', done);

  const cached = await page.evaluate(async () => {
    const c = await caches.open('lingua-models-v1');
    const keys = (await c.keys()).map((k) => new URL(k.url).pathname);
    return keys;
  });
  check('10 files cached (2 packs x 5)', cached.length === 10, `${cached.length}`);
  check('cache keys are mt-en-fr and mt-fr-en', cached.every((k) => /\/mt-(en-fr|fr-en)\//.test(k)), cached.slice(0, 3).join(' '));
  check('NO request went to /models on our server', modelRequests.length === 0, modelRequests.slice(0, 2).join(' '));
  check('files came from huggingface.co', hfRequests.some((u) => u.includes('opus-mt-en-fr')) && hfRequests.some((u) => u.includes('opus-mt-fr-en')), `${hfRequests.length} requests`);

  // ---- 3. offline: reload and translate on the device ----
  await page.evaluate(async () => (await navigator.serviceWorker?.ready) && true).catch(() => {});
  await sleep(1500);
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea', { timeout: 15000 });
  const sels = await page.$$('select.lang-select');
  await sels[0].select('en');
  await sels[1].select('fr');
  const before = apiTranslate.length;
  await page.type('textarea', 'Where is the nearest train station?');
  let out = '';
  for (let i = 0; i < 90 && !out; i++) {
    await sleep(1000);
    out = (await page.$eval('.result', (e) => e.textContent).catch(() => '')).trim();
    if (/^(Translating|Loading|Reading|Starting)/i.test(out)) out = '';
  }
  log(`en->fr offline: "${out}"`);
  check('offline English -> French produced French', /gare|Où|proche/i.test(out), out);
  check('no /api/translate request while offline', apiTranslate.length === before);

  await sels[0].select('fr');
  await sels[1].select('en');
  await page.focus('textarea');
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await sleep(500);
  await page.type('textarea', "Je voudrais un café, s'il vous plaît.");
  let back = '';
  for (let i = 0; i < 90 && !back; i++) {
    await sleep(1000);
    back = (await page.$eval('.result', (e) => e.textContent).catch(() => '')).trim();
    if (/^(Translating|Loading|Reading|Starting)/i.test(back)) back = '';
  }
  log(`fr->en offline: "${back}"`);
  check('offline French -> English produced English', /coffee/i.test(back), back);

  // a language without a downloaded pack must say so instead of failing silently
  await sels[1].select('de');
  await sleep(2500);
  const msg = (await page.$eval('.error', (e) => e.textContent).catch(() => '')) || (await page.$eval('.result', (e) => e.textContent).catch(() => ''));
  check('French -> German without the German packs explains what to download', /Download|isn't available/i.test(msg), msg.slice(0, 120));
  check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (err) {
  check('test ran to the end', false, err.message);
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
