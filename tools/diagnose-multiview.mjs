// 複数視点から自動撮影してまとめて確認する。
// 座標は URL パラメータで指定 (controls.ts の readState/writeState と互換)
import { chromium } from 'playwright';
import * as fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:5173/';
const OUT = 'tools/out/views';
fs.mkdirSync(OUT, { recursive: true });

// 視点リスト: [name, posX, posY, posZ, rotX (pitch), rotY (yaw)]
// PointerLockControls の yaw object は Three.js Object3D。デフォルトforward = -Z。
// Y軸回転は右手系 (上から見て反時計回り):
//   rotY = 0     → -Z (北) を見る
//   rotY = π/2   → -X (西) を見る
//   rotY = π     → +Z (南) を見る
//   rotY = -π/2  → +X (東) を見る
// 建物の外に立って建物中心を見る:
const VIEWS = [
  { name: '01_overview_south',  pos: [0, 25, 18],   rot: [-0.9, 0] },              // 南上空 → 北
  { name: '02_overview_east',   pos: [18, 25, 0],   rot: [-0.9, Math.PI / 2] },    // 東上空 → 西
  { name: '03_overview_top',    pos: [0, 30, 0.1],  rot: [-Math.PI / 2 + 0.05, 0] },
  { name: '04_ground_south',    pos: [0, 1.6, 12],  rot: [0, 0] },                 // 南→北
  { name: '05_ground_east',     pos: [12, 1.6, 0],  rot: [0, Math.PI / 2] },       // 東→西
  { name: '06_ground_north',    pos: [0, 1.6, -12], rot: [0, Math.PI] },           // 北→南
  { name: '07_ground_west',     pos: [-12, 1.6, 0], rot: [0, -Math.PI / 2] },      // 西→東
  { name: '08_entry_approach',  pos: [4, 1.6, 8],   rot: [-0.1, -0.3] },           // 南東→北西
  { name: '09_1f_inside_center', pos: [0, 1.6, 0],  rot: [0, 0] },
  { name: '10_2f_west_room',    pos: [-2, 5.6, 2],  rot: [0, 0] },
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
