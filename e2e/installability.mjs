// Asks a real Chrome whether the served app is installable (same data as DevTools > Application > Manifest).
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://localhost:3055/';
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
});
const page = await browser.newPage();
page.on('console', (m) => console.log('console:', m.type(), m.text()));
page.on('response', (r) => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url()); });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(url, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 4000));
const cdp = await page.createCDPSession();
const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
console.log('installabilityErrors:', JSON.stringify(installabilityErrors, null, 2));
const sw = await page.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  return regs.map((r) => ({ scope: r.scope, active: r.active?.state }));
});
console.log('serviceWorkers:', JSON.stringify(sw));
const { url: murl, errors } = await cdp.send('Page.getAppManifest');
console.log('manifest:', murl, 'errors:', JSON.stringify(errors));
await browser.close();

