// 実ブラウザで roundtrip.html を開き、コンソールログ・エラー・スクショを集める
import { chromium } from 'playwright';
import * as fs from 'node:fs';

const URL = process.argv[2] || 'https://yida29.github.io/voido-3d/roundtrip.html';
const OUT = 'tools/out';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1900, height: 1400 } });
const page = await ctx.newPage();

const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}\n${err.stack}`));
page.on('requestfailed', (req) => logs.push(`[requestfailed] ${req.url()} ${req.failure()?.errorText}`));
page.on('response', (resp) => {
  if (resp.status() >= 400) logs.push(`[HTTP ${resp.status()}] ${resp.url()}`);
});

console.log(`opening ${URL}`);
await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3000); // wait IFC parse + render
await page.screenshot({ path: `${OUT}/roundtrip.png`, fullPage: true });

const stats = await page.locator('#stats').textContent().catch(() => null);
console.log('stats:', stats);

fs.writeFileSync(`${OUT}/console.log`, logs.join('\n'));
console.log(`logs: ${logs.length} lines → ${OUT}/console.log`);
console.log(`screenshot → ${OUT}/roundtrip.png`);

// canvas pixel sample to detect blank-white
const canvasInfo = await page.evaluate(() => {
  const c = document.getElementById('topview');
  if (!c) return { error: 'no canvas' };
  const ctx = c.getContext('2d', { willReadFrequently: true });
  // ctxが取れないのは webgl コンテキスト中なので、toDataURL で見る
  const url = c.toDataURL('image/png').slice(0, 100);
  return { width: c.width, height: c.height, dataUrlPrefix: url };
});
console.log('canvas:', canvasInfo);

await browser.close();
