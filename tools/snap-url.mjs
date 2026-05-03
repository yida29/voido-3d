import { chromium } from 'playwright';
const URL = process.argv[2];
const OUT = process.argv[3] || 'tools/out/url-snap.png';
if (!URL) { console.error('usage: node snap-url.mjs <URL> [out.png]'); process.exit(1); }
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.evaluate(() => { const o = document.getElementById('hud'); if (o) o.style.display = 'none'; });
await page.screenshot({ path: OUT });
console.log('saved', OUT);
await browser.close();
