import { loadVoidoIFC, type IFCMeshInfo, type VoidoBuilding } from './building';

/**
 * ラウンドトリップ検証ページ:
 *   IFC を読み込み、各メッシュの頂点を XZ 平面に射影 → Canvas 2D に間取り図として描画。
 *   1F (左) と 2F (右) を別々に描く。
 *   PDF (マイホームクラウドの原本) と並べて目視比較する。
 */

const stats = document.getElementById('stats') as HTMLSpanElement;
const downloadBtn = document.getElementById('download') as HTMLButtonElement;

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
const YEXPECT: Record<'1F' | '2F', Partial<Record<string, YRange>>> = {
  '1F': {
    IFCSLAB:             { min: 0,    max: 0.20 },
    IFCWALLSTANDARDCASE: { min: 0,    max: 3.95 },
    IFCDOOR:             { min: 0,    max: 2.10 },
  },
  '2F': {
    IFCSLAB:             { min: 4.04, max: 4.20 },
    IFCWALLSTANDARDCASE: { min: 4.04, max: 6.50 },
    IFCDOOR:             { min: 4.04, max: 6.10 },
  },
};
const violations: string[] = [];
for (const m of building.meshes) {
  if (m.storey === 'unknown') continue;
  const expect = YEXPECT[m.storey][m.type];
  if (!expect) continue;
  const tol = expect.tolerance ?? 0.05;
  if (m.localMinY < expect.min - tol || m.localMaxY > expect.max + tol) {
    violations.push(`${m.storey} ${m.type} y=[${m.localMinY.toFixed(2)}, ${m.localMaxY.toFixed(2)}] expected within [${expect.min}, ${expect.max}]`);
  }
}
const yCheck = violations.length === 0
  ? `<span style="color:#6f6">Y✓</span>`
  : `<span style="color:#f66">Y✗ ${violations.length}件</span>`;

stats.innerHTML = `<b>1F:</b> ${c1} parts &nbsp; <b>2F:</b> ${c2} parts &nbsp; outline ${(building.outlineMm.width/1000).toFixed(2)}m × ${(building.outlineMm.depth/1000).toFixed(2)}m &nbsp; ${yCheck} &nbsp; load+draw ${dt.toFixed(0)}ms`;
if (violations.length > 0) {
  console.error('[Y-CHECK] violations:\n' + violations.join('\n'));
}


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
