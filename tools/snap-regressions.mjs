// regressions.json の各視点をスクショに撮る
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:5173/';
const OUT = 'tools/out/regressions';
mkdirSync(OUT, { recursive: true });

const data = JSON.parse(readFileSync('public/regressions.json', 'utf8'));
const browser = await chromium.launch();
for (const v of data.viewpoints) {
  const sep = v.url.includes('?') ? '&' : '?';
  const url = `${BASE}${v.url}${sep}hideHud=1`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${v.id}.png` });
  await page.close();
  console.log(`saved ${v.id}.png`);
}
await browser.close();
