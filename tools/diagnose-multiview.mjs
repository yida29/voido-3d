// 複数視点から自動撮影してまとめて確認する。
// 座標は URL パラメータで指定 (controls.ts の readState/writeState と互換)
import { chromium } from 'playwright';
import * as fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:5173/';
const OUT = 'tools/out/views';
fs.mkdirSync(OUT, { recursive: true });

// 視点リスト: [name, posX, posY, posZ, rotX (pitch), rotY (yaw)]
// rotY: 0=南向き(+Z), -π/2=東向き(+X), π=北向き(-Z), π/2=西向き(-X)
const VIEWS = [
  // 上空からの俯瞰 (no-clip 必要)
  { name: '01_overview_south',  pos: [0, 25, 18],  rot: [-0.9, 0] },
  { name: '02_overview_east',   pos: [18, 25, 0],  rot: [-0.9, -Math.PI / 2] },
  { name: '03_overview_top',    pos: [0, 30, 0.1], rot: [-Math.PI / 2 + 0.05, 0] },
  // 地表 (人の目線) から各面
  { name: '04_ground_south',    pos: [0, 1.6, 12], rot: [0, 0] },
  { name: '05_ground_east',     pos: [12, 1.6, 0], rot: [0, -Math.PI / 2] },
  { name: '06_ground_north',    pos: [0, 1.6, -12], rot: [0, Math.PI] },
  { name: '07_ground_west',     pos: [-12, 1.6, 0], rot: [0, Math.PI / 2] },
  // 玄関アプローチ前 (建物南東付近)
  { name: '08_entry_approach',  pos: [4, 1.6, 8], rot: [-0.1, -0.3] },
  // 1F 室内中央
  { name: '09_1f_inside_center', pos: [0, 1.6, 0], rot: [0, 0] },
  // 2F 室内 (西大洋室)
  { name: '10_2f_west_room',    pos: [-2, 5.6, 2], rot: [0, 0] },
];

const browser = await chromium.launch();
const allErrors = [];

for (const v of VIEWS) {
  const url = `${BASE}?posX=${v.pos[0]}&posY=${v.pos[1]}&posZ=${v.pos[2]}&rotX=${v.rot[0]}&rotY=${v.rot[1]}`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (m) => { if (m.type() === 'error') allErrors.push(`[${v.name}] ${m.text()}`); });
  page.on('pageerror', (e) => allErrors.push(`[${v.name}] ${e.message}`));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  // overlay 削除
  await page.evaluate(() => {
    const o = document.getElementById('overlay'); if (o) o.style.display = 'none';
    // HUD は残す (デバッグ情報のため)
  });
  await page.screenshot({ path: `${OUT}/${v.name}.png` });
  await page.close();
  console.log(`saved ${v.name}.png`);
}

if (allErrors.length) {
  console.log('\n=== ERRORS ===');
  for (const e of allErrors) console.log(e);
}

await browser.close();
console.log(`\n${VIEWS.length} views → ${OUT}/`);
