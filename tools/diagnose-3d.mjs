import { chromium } from 'playwright';
import * as fs from 'node:fs';

const URL = process.argv[2] || 'https://yida29.github.io/voido-3d/';
const OUT = 'tools/out';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
// オーバーレイを隠して撮影
await page.evaluate(() => {
  const o = document.getElementById('overlay'); if (o) o.style.display = 'none';
});
await page.screenshot({ path: `${OUT}/3d-no-overlay.png` });

// ロックを試みる (canvas クリック)
await page.click('#app').catch(() => {});
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/3d-clicked.png` });

// 上空からも撮ってみる
await page.evaluate(() => {
  // @ts-ignore
  const c = document.querySelector('#app');
  console.log('canvas size', c.clientWidth, c.clientHeight);
});

fs.writeFileSync(`${OUT}/3d-console.log`, logs.join('\n'));
console.log(`logs (${logs.length}) → ${OUT}/3d-console.log`);
console.log(`screenshots → ${OUT}/3d-no-overlay.png, 3d-clicked.png`);
await browser.close();
