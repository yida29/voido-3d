// Google Maps の場所から、ストリートビュー / ユーザー投稿写真の URL を抽出
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const URL = process.argv[2] || 'https://www.google.com/maps/place/%E6%97%A5%E6%9C%AC%E3%80%81%E3%80%92299-1861+%E5%8D%83%E8%91%89%E7%9C%8C%E5%AF%8C%E6%B4%A5%E5%B8%82%E9%87%91%E8%B0%B7%EF%BC%92%EF%BC%92%EF%BC%92%EF%BC%91%E2%88%92%EF%BC%93/@35.1667864,139.8232234,17z';
const OUT = 'tools/out/maps';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);

// ページ内の全 img と背景画像 URL を抽出
const imgs = await page.evaluate(() => {
  const set = new Set();
  for (const img of document.querySelectorAll('img')) {
    const src = img.currentSrc || img.src;
    if (src && src.includes('googleusercontent')) set.add(src);
  }
  // 背景画像
  for (const el of document.querySelectorAll('*')) {
    const bg = getComputedStyle(el).backgroundImage;
    const m = /url\(["']?(https?:\/\/[^"')]+)/.exec(bg);
    if (m && m[1].includes('googleusercontent')) set.add(m[1]);
  }
  return Array.from(set);
});

console.log(`found ${imgs.length} images`);
for (const u of imgs) console.log(u);

await page.screenshot({ path: `${OUT}/full-page.png`, fullPage: false });
writeFileSync(`${OUT}/urls.txt`, imgs.join('\n'));
await browser.close();
