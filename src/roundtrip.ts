import * as THREE from 'three';
import { loadVoidoIFC } from './building';

/**
 * IFC を Three.js に読み込み、真上から正射投影 (OrthographicCamera) でレンダリング。
 * PDF と並べて目視比較するためのページ。
 *
 * - 1F のみ可視化 (2F の床・壁が真上から見ると重なるので、Y > floor2 のメッシュは隠す)
 * - レンダ解像度は PDF と同じ 1754x1240。アスペクトを建物外形に合わせる。
 * - 縮尺・配置は floorplan.json (mm) の outline と完全一致するように合わせる。
 */

const canvas = document.getElementById('topview') as HTMLCanvasElement;
const captureBtn = document.getElementById('capture') as HTMLButtonElement;
const downloadBtn = document.getElementById('download') as HTMLButtonElement;
const stats = document.getElementById('stats') as HTMLSpanElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(canvas.width, canvas.height, false);
renderer.setClearColor(0xffffff, 1);
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const ambient = new THREE.AmbientLight(0xffffff, 1.0);
scene.add(ambient);
const dir = new THREE.DirectionalLight(0xffffff, 0.4);
dir.position.set(0, 30, 0);
scene.add(dir);

stats.textContent = 'IFC を読み込み中...';

const t0 = performance.now();
const ifcUrl = `${import.meta.env.BASE_URL}voido.ifc`;
const building = await loadVoidoIFC(ifcUrl);

// 1F のみ表示: 2F より上のメッシュ (床高 4.04m 以上) は隠す
// IFC の生成順番では Storey の floorY が反映されているはず
const F2_FLOOR_Y = 4.04;
building.root.traverse((obj) => {
  if (!(obj as THREE.Mesh).isMesh) return;
  const m = obj as THREE.Mesh;
  m.geometry.computeBoundingBox();
  const bbox = m.geometry.boundingBox!;
  // mesh は applyMatrix4 で世界座標に焼き込み済み (building.ts 参照)
  // ただし root.position で建物中心オフセットが入る → world で判定
  const world = new THREE.Box3().copy(bbox).applyMatrix4(m.matrixWorld);
  if (world.min.y >= F2_FLOOR_Y - 0.1) {
    m.visible = false;
  }
});

scene.add(building.root);

// 建物の外形 (m単位)
const W_M = building.outlineMm.width / 1000;
const D_M = building.outlineMm.depth / 1000;
// 余白 5%
const margin = 0.05;
const halfW = W_M * (1 + margin) / 2;
const halfD = D_M * (1 + margin) / 2;

// Canvas のアスペクト比に合わせて拡張
const canvasAspect = canvas.width / canvas.height;
let camHalfW = halfW;
let camHalfD = halfD;
if (camHalfW / camHalfD < canvasAspect) {
  camHalfW = camHalfD * canvasAspect;
} else {
  camHalfD = camHalfW / canvasAspect;
}

const camera = new THREE.OrthographicCamera(
  -camHalfW, camHalfW,
   camHalfD, -camHalfD,
  0.01, 100,
);
// 真上から見下ろす。+Z が画面上 (北が上) になるように。
camera.position.set(0, 50, 0);
camera.up.set(0, 0, -1); // 北 (+Z) を画面上に
camera.lookAt(0, 0, 0);

renderer.render(scene, camera);
const dt = performance.now() - t0;
stats.innerHTML = `<b>${building.walls.length}</b> walls, <b>${W_M.toFixed(2)}m × ${D_M.toFixed(2)}m</b>, IFC load + render: <b>${dt.toFixed(0)}ms</b>`;

captureBtn.addEventListener('click', () => {
  renderer.render(scene, camera);
});

downloadBtn.addEventListener('click', () => {
  renderer.render(scene, camera);
  const link = document.createElement('a');
  link.download = 'voido-topview.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});
