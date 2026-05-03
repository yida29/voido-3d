import { loadVoidoIFC, type IFCMeshInfo, type VoidoBuilding } from './building';

/**
 * ラウンドトリップ検証ページ:
 *   IFC を読み込み、各メッシュの頂点を XZ 平面に射影 → Canvas 2D に間取り図として描画。
 *   1F (左) と 2F (右) を別々に描く。
 *   PDF (マイホームクラウドの原本) と並べて目視比較する。
 */

const stats = document.getElementById('stats') as HTMLSpanElement;
const downloadBtn = document.getElementById('download') as HTMLButtonElement;
const integrityList = document.getElementById('integrity') as HTMLUListElement;
const galleryEl = document.getElementById('gallery') as HTMLDivElement;
const regressionsEl = document.getElementById('regressions') as HTMLDivElement;

const canvas1 = document.getElementById('top-1f') as HTMLCanvasElement;
const canvas2 = document.getElementById('top-2f') as HTMLCanvasElement;

stats.textContent = 'IFC を読み込み中...';
const t0 = performance.now();
const building = await loadVoidoIFC(`${import.meta.env.BASE_URL}voido.ifc`);
const dt = performance.now() - t0;

drawFloor(canvas1, building, '1F');
drawFloor(canvas2, building, '2F');

const c1 = building.meshes.filter((m) => m.storey === '1F').length;
const c2 = building.meshes.filter((m) => m.storey === '2F').length;

// === Y 軸検証 ===
// XZ 投影だけでは「壁が地面に重なって立ってる」のような Y 異常を見逃す。
// 階別に各メッシュの Y 範囲が期待値内に収まっているか検査する。
interface YRange { min: number; max: number; tolerance?: number }
// 1F壁は 2F床下面 (3940mm) まで延ばして階間の隙間を消している
// 1F SLAB は屋外階段 (Y=-0.56 〜 0) も含むので min を地面 -0.6 まで許容
// (IfcDoor は now 描画しないので期待値からも除外)
// 階別、タイプ別に許容される複数の Y範囲。いずれかに収まれば OK。
// 例: 2F SLAB は通常床 [4.04, 4.20] か屋根 [6.40, 6.70]
const YEXPECT: Record<'1F' | '2F', Partial<Record<string, YRange[]>>> = {
  '1F': {
    IFCSLAB:             [{ min: -0.6, max: 0.20 }], // 床/階段/基礎含む
    // 1F壁: 内壁 [0, 3.94]、外壁 [-0.10, 4.04] (基礎上面〜2F床上面)
    IFCWALLSTANDARDCASE: [{ min: 0, max: 3.95 }, { min: -0.15, max: 4.10 }],
  },
  '2F': {
    IFCSLAB:             [
      { min: 4.04, max: 4.20 }, // 2F 床
      { min: 6.80, max: 7.20 }, // 屋根 (2F天井 2900 + floor 4040)
    ],
    IFCWALLSTANDARDCASE: [{ min: 4.04, max: 7.00 }],
  },
};
const violations: string[] = [];
for (const m of building.meshes) {
  if (m.storey === 'unknown') continue;
  const ranges = YEXPECT[m.storey][m.type];
  if (!ranges || ranges.length === 0) continue;
  const fits = ranges.some((r) => {
    const tol = r.tolerance ?? 0.05;
    return m.localMinY >= r.min - tol && m.localMaxY <= r.max + tol;
  });
  if (!fits) {
    const desc = ranges.map(r => `[${r.min}, ${r.max}]`).join(' or ');
    violations.push(`${m.storey} ${m.type} y=[${m.localMinY.toFixed(2)}, ${m.localMaxY.toFixed(2)}] not within ${desc}`);
  }
}
const yCheck = violations.length === 0
  ? `<span style="color:#6f6">Y✓</span>`
  : `<span style="color:#f66">Y✗ ${violations.length}件</span>`;

stats.innerHTML = `<b>1F:</b> ${c1} parts &nbsp; <b>2F:</b> ${c2} parts &nbsp; outline ${(building.outlineMm.width/1000).toFixed(2)}m × ${(building.outlineMm.depth/1000).toFixed(2)}m &nbsp; ${yCheck} &nbsp; load+draw ${dt.toFixed(0)}ms`;
if (violations.length > 0) {
  console.error('[Y-CHECK] violations:\n' + violations.join('\n'));
}

// === ① 構造完全性チェック (Structural Integrity) ===
runIntegrityChecks(building, violations);

// === ② 多角度プレビュー ===
buildGallery();

// === ③ 回帰チェック ===
await buildRegressions();


downloadBtn.addEventListener('click', () => {
  download(canvas1, 'voido-1f.png');
  download(canvas2, 'voido-2f.png');
});

function download(canvas: HTMLCanvasElement, name: string) {
  const a = document.createElement('a');
  a.download = name;
  a.href = canvas.toDataURL('image/png');
  a.click();
}

// === Drawing ===

function drawFloor(canvas: HTMLCanvasElement, b: VoidoBuilding, storey: '1F' | '2F') {
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;

  // 白背景
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // 該当階のメッシュから世界座標 (Three.js m) の x/z 範囲を計算 (root.position 込み)
  let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  const root = b.root;
  for (const m of b.meshes) {
    if (m.storey !== storey) continue;
    const pos = m.mesh.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + root.position.x;
      const z = pos.getZ(i) + root.position.z;
      if (x < xMin) xMin = x; if (x > xMax) xMax = x;
      if (z < zMin) zMin = z; if (z > zMax) zMax = z;
    }
  }
  if (!isFinite(xMin)) { xMin = -5; xMax = 5; zMin = -5; zMax = 5; }

  // 建物外形 (m) → Canvas px の変換 (世界 bbox にフィット)
  const margin = 40;
  const wM = xMax - xMin;
  const dM = zMax - zMin;
  const sx = (W - 2 * margin) / wM;
  const sz = (H - 2 * margin) / dM;
  const scale = Math.min(sx, sz);
  const renderedW = wM * scale;
  const renderedD = dM * scale;
  const offX = (W - renderedW) / 2;
  const offY = (H - renderedD) / 2;

  // 座標変換: 世界 m → Canvas px
  // PDF は北が画面上。
  // 私の build-ifc.ts で IFC原座標は (+X東, +Y北, +Z上)。
  // web-ifc の Y up 変換後は Three (+x東, +y上, +z=元IFC -y=南)。
  // 北を画面上に: Canvas y は 「z が大きい (=南)」ほど大きい (画面下) → そのままでいい。
  // ただし z 範囲が負からの場合は zMin を引いて 0 起点にする。
  const toPx = (xM: number, zM: number): [number, number] => [
    offX + (xM - xMin) * scale,
    offY + (zM - zMin) * scale,
  ];


  // 1) 部屋 (Spaces) を薄いグレーで塗る
  ctx.fillStyle = '#f3f0ea';
  for (const m of b.meshes.filter((m) => m.storey === storey && m.type === 'IFCSPACE')) {
    drawTopFootprint(ctx, m, toPx, 'fill');
  }

  // 2) 床スラブの輪郭を細い線で
  ctx.strokeStyle = '#bbbbbb';
  ctx.lineWidth = 1;
  for (const m of b.meshes.filter((m) => m.storey === storey && m.type === 'IFCSLAB')) {
    drawTopFootprint(ctx, m, toPx, 'stroke');
  }

  // 3) 壁を黒で塗る (上から見た輪郭)
  ctx.fillStyle = '#222222';
  for (const m of b.meshes.filter((m) => m.storey === storey && (m.type === 'IFCWALL' || m.type === 'IFCWALLSTANDARDCASE'))) {
    drawTopFootprint(ctx, m, toPx, 'fill');
  }

  // 4) ドアを赤い四角で
  ctx.fillStyle = '#d23';
  ctx.strokeStyle = '#d23';
  for (const m of b.meshes.filter((m) => m.storey === storey && m.type === 'IFCDOOR')) {
    drawTopFootprint(ctx, m, toPx, 'fill');
  }

  // 5) 外形の枠 (デバッグ用)
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 1;
  ctx.strokeRect(offX, offY, renderedW, renderedD);

  // 方位記号
  drawCompass(ctx, W - 50, 30);

  // タイトル
  ctx.fillStyle = '#222';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${storey}平面図`, 16, 28);
  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#666';
  ctx.fillText(`間口 ${wM.toFixed(2)}m × 奥行 ${dM.toFixed(2)}m`, 16, 44);
}

function drawCompass(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#444';
  ctx.fillStyle = '#444';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(0, 16); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(12, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(-4, -10); ctx.lineTo(4, -10); ctx.closePath(); ctx.fill();
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', 0, -20);
  ctx.restore();
}

/**
 * メッシュの全頂点を XZ 平面に射影し、その convex hull を描く。
 * 壁・床・部屋・ドアはみな矩形ベースの押し出しなので convex hull で十分。
 */
function drawTopFootprint(
  ctx: CanvasRenderingContext2D,
  m: IFCMeshInfo,
  toPx: (xMm: number, zMm: number) => [number, number],
  mode: 'fill' | 'stroke',
) {
  const pos = m.mesh.geometry.attributes.position as THREE.BufferAttribute;
  if (!pos) return;

  // 頂点を XZ 平面に射影 (Three.js 世界 m)
  const root = m.mesh.parent as THREE.Object3D;
  const ox = root.position.x;
  const oz = root.position.z;
  const points2d: [number, number][] = [];
  for (let i = 0; i < pos.count; i++) {
    points2d.push([pos.getX(i) + ox, pos.getZ(i) + oz]);
  }
  const hull = convexHull(points2d);
  if (hull.length < 3) return;

  ctx.beginPath();
  for (let i = 0; i < hull.length; i++) {
    const [px, py] = toPx(hull[i][0], hull[i][1]);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  if (mode === 'fill') ctx.fill();
  else ctx.stroke();
}

// Andrew's monotone chain — 2D convex hull. O(n log n)
function convexHull(pts: [number, number][]): [number, number][] {
  const points = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const n = points.length;
  if (n < 2) return points;
  const lower: [number, number][] = [];
  for (const p of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = n - 1; i >= 0; i--) {
    const p = points[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}
function cross(o: [number, number], a: [number, number], b: [number, number]): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

// import for type
import * as THREE from 'three';

// === Integrity check helpers ===
interface CheckResult { name: string; ok: boolean; detail?: string }
function runIntegrityChecks(b: VoidoBuilding, yViolations: string[]) {
  const checks: CheckResult[] = [];
  const meshes = b.meshes;
  const wallsByStorey = (st: '1F' | '2F') => meshes.filter(m => m.storey === st && (m.type === 'IFCWALL' || m.type === 'IFCWALLSTANDARDCASE'));
  const slabsByStorey = (st: '1F' | '2F') => meshes.filter(m => m.storey === st && m.type === 'IFCSLAB');

  // 必須エンティティ存在チェック
  checks.push({ name: '1F に床スラブがある', ok: slabsByStorey('1F').length > 0, detail: `${slabsByStorey('1F').length}枚` });
  checks.push({ name: '2F に床スラブがある', ok: slabsByStorey('2F').filter(m => m.localMinY < 5).length > 0, detail: `${slabsByStorey('2F').filter(m => m.localMinY < 5).length}枚` });
  checks.push({ name: '1F に壁が十分ある (≥4)', ok: wallsByStorey('1F').length >= 4, detail: `${wallsByStorey('1F').length}本` });
  checks.push({ name: '2F に壁が十分ある (≥4)', ok: wallsByStorey('2F').length >= 4, detail: `${wallsByStorey('2F').length}本` });
  // 部屋数は壁の数から推定 (Space 自体はジオメトリ生成されないため)
  // 各階に最低限の壁本数があるか
  const wallCount1F = wallsByStorey('1F').length;
  const wallCount2F = wallsByStorey('2F').length;
  checks.push({
    name: '壁本数が十分 (1F≥10, 2F≥6)',
    ok: wallCount1F >= 10 && wallCount2F >= 6,
    detail: `1F=${wallCount1F}, 2F=${wallCount2F}`,
  });

  // 屋根 (= 最上階に上面を覆うスラブ) があるか
  // ここでは「2F の SLAB のうち、Y bbox が壁の上端 (≒6.46m) 以上にあるもの」を屋根とみなす
  const roofCandidates = slabsByStorey('2F').filter(m => m.localMinY >= 6.0);
  checks.push({
    name: '屋根がある (2F壁上端より上のスラブ)',
    ok: roofCandidates.length > 0,
    detail: `候補=${roofCandidates.length}枚`,
  });

  // 屋根の XZ 投影面積 ≧ 建物外形面積 (= 雨を凌げる)
  if (roofCandidates.length > 0) {
    const ground = bbox2D(roofCandidates);
    const expectedArea = (b.outlineMm.width / 1000) * (b.outlineMm.depth / 1000);
    const roofArea = ground.area;
    const ratio = roofArea / expectedArea;
    checks.push({
      name: `屋根面積 ≧ 建物外形 (実 ${roofArea.toFixed(1)}㎡ / 想定 ${expectedArea.toFixed(1)}㎡)`,
      ok: ratio >= 0.95,
      detail: `比率 ${(ratio * 100).toFixed(0)}%`,
    });
  }

  // 1F壁の上端 ≦ 2F床の下端 (隙間なし、ただし床版厚 100mm は許容)
  const wallTop1F = Math.max(0, ...wallsByStorey('1F').map(m => m.localMaxY));
  // 2F の SLAB のうち、2F床高の近く (屋根を除く)
  const slabs2FFloor = slabsByStorey('2F').filter(m => m.localMinY < 5);
  const slabBottom2F = slabs2FFloor.length > 0 ? Math.min(...slabs2FFloor.map(m => m.localMinY)) : Infinity;
  const gap = slabBottom2F - wallTop1F;
  // gap が負 = 床版が1F壁の上端を覆う (Z-fight回避のため意図的)
  // gap が正 = 隙間
  checks.push({
    name: '1F壁と2F床に隙間なし (オーバーラップ可)',
    ok: gap <= 0.15,
    detail: `gap=${(gap * 1000).toFixed(0)}mm`,
  });

  // 2F壁の上端 ≦ 屋根の下端
  if (roofCandidates.length > 0) {
    const wallTop2F = Math.max(0, ...wallsByStorey('2F').map(m => m.localMaxY));
    const roofBottom = Math.min(Infinity, ...roofCandidates.map(m => m.localMinY));
    const gap2 = roofBottom - wallTop2F;
    checks.push({
      name: '2F壁と屋根の間に隙間なし',
      ok: Math.abs(gap2) < 0.15,
      detail: `gap=${(gap2 * 1000).toFixed(0)}mm`,
    });
  }

  // 4方向すべてに外壁があるか (簡易: 建物外形の各辺に近い壁メッシュがあるか)
  const wbb = new THREE.Box3();
  wallsByStorey('1F').forEach(m => wbb.expandByObject(m.mesh));
  const margin = 0.5;
  const sides = { N: false, S: false, E: false, W: false };
  for (const m of wallsByStorey('1F')) {
    const bb = new THREE.Box3().setFromObject(m.mesh);
    if (bb.min.z <= wbb.min.z + margin) sides.N = true;
    if (bb.max.z >= wbb.max.z - margin) sides.S = true;
    if (bb.min.x <= wbb.min.x + margin) sides.W = true;
    if (bb.max.x >= wbb.max.x - margin) sides.E = true;
  }
  for (const [k, ok] of Object.entries(sides)) {
    checks.push({ name: `1F外壁: ${k} 面に壁がある`, ok });
  }

  // Y軸 expectation
  checks.push({
    name: `Y軸範囲チェック (各タイプの想定高さ)`,
    ok: yViolations.length === 0,
    detail: yViolations.length > 0 ? yViolations.join(' / ') : 'all within bounds',
  });

  // レンダリング
  integrityList.innerHTML = '';
  let allOk = true;
  for (const c of checks) {
    const li = document.createElement('li');
    li.className = c.ok ? 'ok' : 'bad';
    li.innerHTML = `${c.name}` + (c.detail ? ` <span class="detail">— ${c.detail}</span>` : '');
    integrityList.appendChild(li);
    if (!c.ok) allOk = false;
  }
  const summary = document.createElement('li');
  summary.className = allOk ? 'ok' : 'bad';
  summary.style.borderTop = '1px solid #444';
  summary.style.marginTop = '8px';
  summary.style.paddingTop = '8px';
  summary.innerHTML = `<b>結果: ${checks.filter(c => c.ok).length} / ${checks.length} pass</b>`;
  integrityList.appendChild(summary);
}

function bbox2D(meshes: IFCMeshInfo[]): { area: number } {
  let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  for (const m of meshes) {
    const bb = new THREE.Box3().setFromObject(m.mesh);
    if (bb.min.x < xMin) xMin = bb.min.x;
    if (bb.max.x > xMax) xMax = bb.max.x;
    if (bb.min.z < zMin) zMin = bb.min.z;
    if (bb.max.z > zMax) zMax = bb.max.z;
  }
  return { area: (xMax - xMin) * (zMax - zMin) };
}

// === Gallery: 多角度から index.html を iframe で開いて見る ===
async function buildRegressions() {
  const base = import.meta.env.BASE_URL;
  let data: { viewpoints: { id: string; label: string; issue?: string; reportedAt?: string; url: string }[] };
  try {
    data = await (await fetch(`${base}regressions.json`)).json();
  } catch {
    regressionsEl.innerHTML = `<p style="color:#888">regressions.json なし</p>`;
    return;
  }
  regressionsEl.innerHTML = '';
  for (const v of data.viewpoints) {
    const fig = document.createElement('figure');
    const cap = document.createElement('figcaption');
    cap.innerHTML = `<span><b>${v.label}</b><br><span style="opacity:0.7">${v.issue ?? ''} (${v.reportedAt ?? ''})</span></span>`;
    cap.style.fontSize = '10px';
    const iframe = document.createElement('iframe');
    const sep = v.url.includes('?') ? '&' : '?';
    iframe.src = `${base}${v.url}${sep}hideHud=1`;
    iframe.loading = 'lazy';
    fig.appendChild(cap);
    fig.appendChild(iframe);
    regressionsEl.appendChild(fig);
  }
}

function buildGallery() {
  const base = import.meta.env.BASE_URL;
  const VIEWS = [
    { name: '上空 南側',     pos: [0, 25, 18],  rot: [-0.9, 0] },
    { name: '上空 真上',     pos: [0, 30, 0.1], rot: [-Math.PI/2 + 0.05, 0] },
    { name: '上空 東側',     pos: [18, 25, 0],  rot: [-0.9, -Math.PI/2] },
    { name: '地表 南面',     pos: [0, 1.6, 12], rot: [0, 0] },
    { name: '地表 北面',     pos: [0, 1.6, -12], rot: [0, Math.PI] },
    { name: '地表 東面',     pos: [12, 1.6, 0], rot: [0, -Math.PI/2] },
    { name: '玄関アプローチ', pos: [4, 1.6, 8], rot: [-0.1, -0.3] },
    { name: '1F 室内中央',   pos: [0, 1.6, 0], rot: [0, 0] },
    { name: '2F 西大洋室',   pos: [-2, 5.6, 2], rot: [0, 0] },
  ];
  galleryEl.innerHTML = '';
  for (const v of VIEWS) {
    const fig = document.createElement('figure');
    const cap = document.createElement('figcaption');
    cap.innerHTML = `<span>${v.name}</span><span>(${v.pos.map(n => n.toFixed(1)).join(', ')})</span>`;
    const iframe = document.createElement('iframe');
    iframe.src = `${base}?posX=${v.pos[0]}&posY=${v.pos[1]}&posZ=${v.pos[2]}&rotX=${v.rot[0]}&rotY=${v.rot[1]}&hideHud=1`;
    iframe.loading = 'lazy';
    fig.appendChild(cap);
    fig.appendChild(iframe);
    galleryEl.appendChild(fig);
  }
}
