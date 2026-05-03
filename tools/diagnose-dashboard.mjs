import { chromium } from 'playwright';
const URL = process.argv[2] || 'http://localhost:5173/roundtrip.html';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 4000 } });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(5000); // gallery iframe を待つ
await page.screenshot({ path: 'tools/out/dashboard.png', fullPage: true });
const items = await page.$$eval('#integrity li', (lis) =>
  lis.map((li) => `${li.classList.contains('bad') ? '✗' : li.classList.contains('ok') ? '✓' : '?'} ${li.innerText}`));
console.log('=== integrity ===');
console.log(items.join('\n'));
await browser.close();
