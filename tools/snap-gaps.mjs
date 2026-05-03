// 隙間を疑う場所を接写
import { chromium } from 'playwright';
import * as fs from 'node:fs';
const BASE = process.argv[2] || 'http://localhost:5173/';
const OUT = 'tools/out/gaps';
fs.mkdirSync(OUT, { recursive: true });

const SHOTS = [
  // 全周の腰下〜2F壁あたりを近距離で撮る
  { name: 's-mid',  pos: [0, 2.5, 9],  rot: [-0.1, 0] },
  { name: 's-low',  pos: [0, 0.8, 9],  rot: [0.1, 0] },
  { name: 's-very-close', pos: [0, 1.5, 7], rot: [0, 0] },
  { name: 'e-mid',  pos: [9, 2.5, 0],  rot: [-0.1, -Math.PI/2] },
  { name: 'n-mid',  pos: [0, 2.5, -9], rot: [-0.1, Math.PI] },
  { name: 'w-mid',  pos: [-9, 2.5, 0], rot: [-0.1, Math.PI/2] },
  // 2F壁の根本に近づく
  { name: 's-2f-base', pos: [0, 4.2, 7], rot: [0, 0] },
  // 西端の下方 (西外壁と基礎)
  { name: 'sw-base',   pos: [-7, 0.5, 6], rot: [0, -0.5] },
  // 角の見え方
  { name: 'se-corner', pos: [7, 1.5, 7], rot: [-0.1, -0.5] },
];

const browser = await chromium.launch();
for (const s of SHOTS) {
  const url = `${BASE}?posX=${s.pos[0]}&posY=${s.pos[1]}&posZ=${s.pos[2]}&rotX=${s.rot[0]}&rotY=${s.rot[1]}&hideHud=1`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${s.name}.png` });
  await page.close();
  console.log(`saved ${s.name}.png`);
}
await browser.close();
