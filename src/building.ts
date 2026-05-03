import * as THREE from 'three';

// === voido (千葉県南房総のログハウス合宿施設) の見取り図 ===
// マイホームクラウドで作成した PDF (01_01_名称未設定.pdf) の寸法に厳密準拠。
//
// 座標系: 1 unit = 1 m。原点 (0,0,0) は建物の南西角・1F 床上面。
//   +X = 東 (East)
//   +Z = 北 (North)
//   +Y = 上 (Up)
//
// 外形:
//   間口 X (東西) = 10.92 m
//   奥行 Z (南北) =  9.10 m
//   1F 天井高 = 2.90 m
//   2F 床高   = 4.04 m  (1F天井 2.9 + 床/構造 1.14)
//   2F 天井高 = 2.425 m
//
// 1F グリッド (北側に水回り帯、南側に大洋室):
//   北壁の東西分割 (西→東, mm):  2048 | 1593 | 1365 | 2958 | 2958
//     階段(UP) | 収納 | トイレ | 洗面所 | 浴室
//   北側帯の奥行 (Z) = 2,503 mm
//   南側帯 (大洋室 約46.5帖, キッチンは西壁沿い L字)
//
// 2F グリッド:
//   南壁分割 (西→東, mm): 5460 | 1365 | 4095
//     西大洋室 / 吹抜 (どちらも西側ブロック内)、東に2部屋を上下分割
//   西大洋室: 6825 (X) × 6598 (Z), 約29.4帖
//   吹抜:    5460 (X) × 2503 (Z), 西大洋室の南
//   東洋室×2: 4095 (X) × 4550 (Z) ずつ, 約11.3帖

export interface VoidoBuilding {
  root: THREE.Group;
  walls: THREE.Mesh[];
}

// ---------- 全体寸法 (m) ----------
const W = 10.92;            // 東西 (X)
const D = 9.10;             // 南北 (Z)
const F1_CEIL = 2.90;       // 1F 天井高
const F2_FLOOR_Y = 4.04;    // 2F 床上面 Y
const F2_CEIL = 2.425;      // 2F 天井高
const ROOF_Y = F2_FLOOR_Y + F2_CEIL;

const WALL_T = 0.12;        // 内壁厚
const OUT_T = 0.18;         // 外壁厚

// 1F 北側帯 (水回り) の奥行
const NORTH_BAND_D = 2.503;
const NORTH_BAND_Z0 = D - NORTH_BAND_D;   // = 6.597 (帯の南端)

// 北壁の東西分割 (西からの累積位置, m)
const X_STAIR_E   = 2.048;                 // 階段 / 西端〜
const X_STORAGE_E = X_STAIR_E + 1.593;     // 収納
const X_TOILET_E  = X_STORAGE_E + 1.365;   // トイレ
const X_SINK_E    = X_TOILET_E + 2.958;    // 洗面所
// 浴室は X_SINK_E 〜 W

// 玄関 (南壁、東寄り。建具表より W=910mm の片開)
const ENTRY_W = 0.91;
const ENTRY_X_CENTER = W - 1.6;  // 南壁東寄り (~東端から1.6m内側)
const ENTRY_H = 1.10;            // 建具表より H=1100mm (低めの片開)

// ---------- マテリアル ----------
const MAT = {
  logWall:   new THREE.MeshStandardMaterial({ color: 0xc89972, roughness: 0.85 }),
  innerWall: new THREE.MeshStandardMaterial({ color: 0xead9c0, roughness: 0.95 }),
  floor1:    new THREE.MeshStandardMaterial({ color: 0x8b6543, roughness: 0.7 }),
  floor2:    new THREE.MeshStandardMaterial({ color: 0xa57a52, roughness: 0.75 }),
  roof:      new THREE.MeshStandardMaterial({ color: 0x553a2a, roughness: 0.9 }),
  glass:     new THREE.MeshStandardMaterial({ color: 0xaad8ff, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.35 }),
  table:     new THREE.MeshStandardMaterial({ color: 0x8a5a3b, roughness: 0.6 }),
  metal:     new THREE.MeshStandardMaterial({ color: 0xc0c4c8, roughness: 0.4, metalness: 0.7 }),
  wood:      new THREE.MeshStandardMaterial({ color: 0x6b4a30, roughness: 0.8 }),
  bath:      new THREE.MeshStandardMaterial({ color: 0xdde6ea, roughness: 0.4 }),
  bed:       new THREE.MeshStandardMaterial({ color: 0x4d6a8a, roughness: 0.9 }),
  pillow:    new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.95 }),
  storage:   new THREE.MeshStandardMaterial({ color: 0xd9b890, roughness: 0.9 }),
  sofa:      new THREE.MeshStandardMaterial({ color: 0x6e7a86, roughness: 0.95 }),
  ihTop:     new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.3 }),
  sink:      new THREE.MeshStandardMaterial({ color: 0xeaeef0, roughness: 0.3, metalness: 0.5 }),
};

export function buildVoido(): VoidoBuilding {
  const root = new THREE.Group();
  // 図面の南西角を原点に置きたいので、root を建物中心に合わせる必要はなし。
  // ただしカメラ初期位置などとの整合のため、root を建物中心が原点になるよう移動しても良い。
  // ここでは root をそのまま使い、外部 (controls) から座標で参照する。
  const walls: THREE.Mesh[] = [];

  // ---------- 床・天井 ----------
  // 1F 床 (Y=0 上面)
  addBoxXZ(root, 0, -0.05, 0, W, 0.10, D, MAT.floor1, false);
  // 2F 床: 西大洋室 + 東洋室×2 (吹抜は穴)
  //   西側ブロック (X: 0..6.825, Z: 0..D) のうち吹抜 (X: 0..5.46, Z: 0..2.503) を抜く
  //   東側ブロック (X: 6.825..W, Z: 0..D) は全面
  // 西大洋室の床 (吹抜より北の帯)
  addBoxXZ(root, 0, F2_FLOOR_Y - 0.09, 2.503, 6.825, 0.18, D - 2.503, MAT.floor2, false);
  // 西大洋室から階段降り部もここに含むので、階段ホール上は省略 (階段でカバー)
  // 東側ブロック床
  addBoxXZ(root, 6.825, F2_FLOOR_Y - 0.09, 0, W - 6.825, 0.18, D, MAT.floor2, false);

  // ---------- 外壁 (南西基準で配置) ----------
  // 北壁 (Z = D)
  walls.push(addWallSeg(root, 0, ROOF_Y / 2, D, W, ROOF_Y, OUT_T, MAT.logWall));
  // 南壁: 玄関で分割
  const sLeftW = ENTRY_X_CENTER - ENTRY_W / 2;       // 西側区間幅
  const sRightW = W - (ENTRY_X_CENTER + ENTRY_W / 2); // 東側区間幅
  walls.push(addWallSeg(root, 0,                          ROOF_Y / 2, 0, sLeftW,  ROOF_Y, OUT_T, MAT.logWall));
  walls.push(addWallSeg(root, ENTRY_X_CENTER + ENTRY_W/2, ROOF_Y / 2, 0, sRightW, ROOF_Y, OUT_T, MAT.logWall));
  // 玄関の上の小壁
  walls.push(addWallSeg(root, ENTRY_X_CENTER - ENTRY_W/2, (ENTRY_H + ROOF_Y) / 2, 0, ENTRY_W, ROOF_Y - ENTRY_H, OUT_T, MAT.logWall));

  // 西壁
  walls.push(addWallSeg(root, 0, ROOF_Y / 2, 0, OUT_T, ROOF_Y, D, MAT.logWall));
  // 東壁
  walls.push(addWallSeg(root, W - OUT_T, ROOF_Y / 2, 0, OUT_T, ROOF_Y, D, MAT.logWall));

  // ---------- 1F 内壁 ----------
  // 水回り帯と大洋室を分ける東西方向の壁 (Z = NORTH_BAND_Z0)
  // 開口: 大洋室から階段ホールへ (東側通路 約1.0m) と 洗面所への入口 (約0.9m)
  // 簡易的に、洗面所入口=洗面所中央、ホール開口=収納とトイレの間あたり
  const z0 = NORTH_BAND_Z0;
  // 区間1: 西端 〜 階段東 (壁なし: 階段ホール開口)
  // ※ 図面では階段下が一段上のホールに繋がっているが、ここは開放
  // 区間2: 階段東(2.048) 〜 洗面所入口手前
  walls.push(addWallSeg(root, X_STAIR_E,   F1_CEIL/2, z0, X_TOILET_E - X_STAIR_E, F1_CEIL, WALL_T, MAT.innerWall));
  // 区間3: 洗面所開口を作る (洗面所中央 1.0m を抜く)
  const sinkOpenC = (X_TOILET_E + X_SINK_E) / 2;
  const sinkOpenW = 1.0;
  walls.push(addWallSeg(root, X_TOILET_E, F1_CEIL/2, z0, sinkOpenC - sinkOpenW/2 - X_TOILET_E, F1_CEIL, WALL_T, MAT.innerWall));
  walls.push(addWallSeg(root, sinkOpenC + sinkOpenW/2, F1_CEIL/2, z0, X_SINK_E - (sinkOpenC + sinkOpenW/2), F1_CEIL, WALL_T, MAT.innerWall));
  // 区間4: 浴室前の壁 (浴室入口は洗面所内なので、洗面所〜浴室間に内壁)
  walls.push(addWallSeg(root, X_SINK_E, F1_CEIL/2, z0, W - X_SINK_E, F1_CEIL, WALL_T, MAT.innerWall));

  // 北側帯の南北方向の仕切り壁 (各部屋の境界)
  // 階段 と 収納 の境
  walls.push(addWallSeg(root, X_STAIR_E,   F1_CEIL/2, z0, WALL_T, F1_CEIL, NORTH_BAND_D, MAT.innerWall));
  // 収納 と トイレ の境
  walls.push(addWallSeg(root, X_STORAGE_E, F1_CEIL/2, z0, WALL_T, F1_CEIL, NORTH_BAND_D, MAT.innerWall));
  // トイレ と 洗面所 の境
  walls.push(addWallSeg(root, X_TOILET_E,  F1_CEIL/2, z0, WALL_T, F1_CEIL, NORTH_BAND_D, MAT.innerWall));
  // 洗面所 と 浴室 の境 (浴室入口 0.9m を空ける)
  const bathDoorZ = D - 0.9;  // 北寄りに開口
  walls.push(addWallSeg(root, X_SINK_E, F1_CEIL/2, z0,                      WALL_T, F1_CEIL, bathDoorZ - z0, MAT.innerWall));
  walls.push(addWallSeg(root, X_SINK_E, F1_CEIL/2, bathDoorZ + 0.9,         WALL_T, F1_CEIL, D - (bathDoorZ + 0.9), MAT.innerWall));

  // ---------- 2F 内壁 ----------
  // 西大洋室 と 東2部屋 の境 (X = 6.825)
  // 開口: 廊下/階段からの動線として 0.9m を北寄りに開ける
  const eDivX = 6.825;
  const eDoorZ = D - 1.5;
  walls.push(addWallSeg(root, eDivX - WALL_T/2, F2_FLOOR_Y + F2_CEIL/2, 0,             WALL_T, F2_CEIL, eDoorZ, MAT.innerWall));
  walls.push(addWallSeg(root, eDivX - WALL_T/2, F2_FLOOR_Y + F2_CEIL/2, eDoorZ + 0.9,  WALL_T, F2_CEIL, D - (eDoorZ + 0.9), MAT.innerWall));

  // 東2部屋を上下分割 (Z = 4.55)
  // 開口は片開ドア (W=0.9m) を中央に
  const sDivZ = 4.55;
  const eRoomDoorX = eDivX + (W - eDivX) / 2;
  walls.push(addWallSeg(root, eDivX,                       F2_FLOOR_Y + F2_CEIL/2, sDivZ, eRoomDoorX - 0.45 - eDivX,             F2_CEIL, WALL_T, MAT.innerWall));
  walls.push(addWallSeg(root, eRoomDoorX + 0.45,           F2_FLOOR_Y + F2_CEIL/2, sDivZ, W - (eRoomDoorX + 0.45),                F2_CEIL, WALL_T, MAT.innerWall));

  // 吹抜の柵 (落下防止) — 西大洋室の南端 Z=2.503 沿い
  const railH = 1.0;
  walls.push(addWallSeg(root, 0, F2_FLOOR_Y + railH/2, 2.503 - WALL_T/2, 5.46, railH, WALL_T, MAT.wood));
  // 吹抜の東側 (X=5.46) も柵
  walls.push(addWallSeg(root, 5.46 - WALL_T/2, F2_FLOOR_Y + railH/2, 0, WALL_T, railH, 2.503, MAT.wood));

  // ---------- 屋根 (簡易フラット) ----------
  addBoxXZ(root, -0.3, ROOF_Y, -0.3, W + 0.6, 0.3, D + 0.6, MAT.roof, true);

  // ---------- 1F 家具 ----------
  // 大洋室 (南側帯, Z: 0..6.597)
  const livX = (W - 6.825) / 2 + 6.825 - W/2; // 中心調整不要
  // 大テーブル × 2 (図面に2つの長方形テーブル)
  // テーブル1 (北寄り)
  addTable(root, 5.0, 0.0, 4.5, 2.4, 1.2);
  // テーブル2 (南寄り)
  addTable(root, 5.0, 0.0, 1.6, 2.4, 1.2);

  // キッチン (1F西壁沿い、L字; 西壁に沿って IH と シンク を縦に並べる)
  // カウンタ全長
  addBoxXZ(root, OUT_T, 0, 1.0, 0.65, 0.9, 4.0, MAT.metal, true);
  // IH コンロ (北寄り)
  addBoxXZ(root, OUT_T + 0.05, 0.92, 4.2, 0.55, 0.04, 0.55, MAT.ihTop, false);
  // シンク (南寄り)
  addBoxXZ(root, OUT_T + 0.05, 0.92, 2.0, 0.55, 0.04, 0.7, MAT.sink, false);
  // 冷蔵庫 (キッチン南端)
  addBoxXZ(root, OUT_T, 0, 0.2, 0.7, 1.8, 0.7, new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }), true);
  livX; // unused suppression

  // 収納 (北側帯, X: 2.048..3.641)
  addBoxXZ(root, X_STAIR_E + 0.1, 0, z0 + 0.1, 1.4, 1.8, 2.2, MAT.storage, true);

  // トイレ (X: 3.641..5.006) — 便器
  addBoxXZ(root, X_STORAGE_E + 0.45, 0, z0 + 0.4, 0.4, 0.5, 0.7, MAT.bath, true);
  addBoxXZ(root, X_STORAGE_E + 0.45, 0.5, z0 + 0.2, 0.4, 0.6, 0.15, MAT.bath, true);

  // 洗面所 (X: 5.006..7.964) — 洗面台 + 洗濯機
  addBoxXZ(root, X_TOILET_E + 0.2, 0, z0 + 0.2, 1.2, 0.85, 0.5, MAT.sink, true); // 洗面カウンタ
  addBoxXZ(root, X_TOILET_E + 1.6, 0, z0 + 0.2, 0.6, 0.95, 0.6, new THREE.MeshStandardMaterial({ color: 0xeaeaea, roughness: 0.5 }), true); // 洗濯機

  // 浴室 (X: 7.964..W) — 浴槽
  addBoxXZ(root, X_SINK_E + 0.5, 0, z0 + 0.6, 1.6, 0.55, 1.0, MAT.bath, true);

  // 階段 (1F→2F) — 西端 0..2.048。西壁から東に折り返さず直線で 2F (Y=4.04) へ
  // 13段で 4.04m / 13 ≒ 0.31m / 段、踏面 0.21m。直線では奥行が足りないので折り返し階段にする。
  // 簡略化: U字 (西壁沿いを北上 → 折り返し → 南下)
  buildStaircase(root, 0.1, X_STAIR_E - 0.1, NORTH_BAND_Z0 - 0.05, D - 0.1, F2_FLOOR_Y);

  // ---------- 2F 家具 ----------
  // 西大洋室: ソファ + テーブル
  addBoxXZ(root, 1.0, F2_FLOOR_Y, 6.0, 2.4, 0.7, 0.9, MAT.sofa, true);  // ソファ
  addBoxXZ(root, 1.5, F2_FLOOR_Y, 7.2, 1.6, 0.4, 0.8, MAT.table, true); // ローテーブル

  // 東上 (Z: 4.55..D) — ベッド
  addBunkBed(root, 8.5, F2_FLOOR_Y, 6.5, 0);
  // 東下 (Z: 0..4.55) — ベッド
  addBunkBed(root, 8.5, F2_FLOOR_Y, 1.8, 0);

  // ---------- 大窓 (装飾、衝突なし) ----------
  // 南壁、玄関の西側に大開口想定
  addBoxXZ(root, sLeftW * 0.5 - 1.5, 0.4, 0, 3.0, 1.8, 0.04, MAT.glass, false);

  // ----- 全 root を建物中心へ平行移動 (カメラ・操作系で扱いやすくするため) -----
  root.position.set(-W / 2, 0, -D / 2);

  return { root, walls };
}

// ===== ヘルパー =====

// (x, y, z) は最小コーナーではなく、メッシュの「最小コーナー」を指定する。
// 中で +s/2 して位置に変換。
function addBoxXZ(
  parent: THREE.Object3D,
  x: number, y: number, z: number,
  sx: number, sy: number, sz: number,
  mat: THREE.Material, cast: boolean,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(x + sx / 2, y + sy / 2, z + sz / 2);
  m.castShadow = cast;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// 壁: 最小コーナー指定で配置。ただし sy 中心は床 0..ceiling を意図して y=ceiling/2 を渡す前提を維持しつつ、
// 既存呼び出しに合わせて (x, yCenter, z, sx, sy, sz) を取る形にしてある。
function addWallSeg(
  parent: THREE.Object3D,
  x: number, yCenter: number, z: number,
  sx: number, sy: number, sz: number,
  mat: THREE.Material,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(x + sx / 2, yCenter, z + sz / 2);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function addTable(parent: THREE.Object3D, cx: number, baseY: number, cz: number, sx: number, sz: number) {
  const top = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.05, sz), MAT.table);
  top.position.set(cx, baseY + 0.75, cz);
  top.castShadow = true; top.receiveShadow = true;
  parent.add(top);
  for (const dx of [-sx/2 + 0.1, sx/2 - 0.1]) for (const dz of [-sz/2 + 0.1, sz/2 - 0.1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.75, 0.08), MAT.wood);
    leg.position.set(cx + dx, baseY + 0.375, cz + dz);
    leg.castShadow = true;
    parent.add(leg);
  }
}

function addBunkBed(parent: THREE.Object3D, cx: number, baseY: number, cz: number, rotY: number) {
  const grp = new THREE.Group();
  grp.position.set(cx, baseY, cz);
  grp.rotation.y = rotY;
  const m1 = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.18, 2.0), MAT.bed);
  m1.position.set(0, 0.45, 0); grp.add(m1);
  const m2 = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.18, 2.0), MAT.bed);
  m2.position.set(0, 1.55, 0); grp.add(m2);
  for (const dx of [-0.5, 0.5]) for (const dz of [-1.0, 1.0]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.9, 0.06), MAT.wood);
    post.position.set(dx, 1.05, dz);
    grp.add(post);
  }
  const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.4), MAT.pillow);
  p1.position.set(0, 0.58, -0.7); grp.add(p1);
  const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.4), MAT.pillow);
  p2.position.set(0, 1.68, -0.7); grp.add(p2);
  grp.traverse((o) => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).castShadow = true; (o as THREE.Mesh).receiveShadow = true; } });
  parent.add(grp);
}

// U字階段: x0..x1 の幅、z0..z1 の奥行 (実際には半分の奥行を上り、折り返して残り半分を上がる)
function buildStaircase(
  parent: THREE.Object3D,
  x0: number, x1: number, z0: number, z1: number, topY: number,
) {
  const widthX = x1 - x0;
  const halfWidth = widthX / 2;
  const depth = z1 - z0;
  const totalSteps = 14;
  const stepRise = topY / totalSteps;          // 1段の高さ
  const stepRun = depth / (totalSteps / 2);    // 1段の踏面 (片側 7段)

  // 西側上り: x0 .. x0+halfWidth, z0 → z1, 段 0..6
  for (let i = 0; i < totalSteps / 2; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(halfWidth, 0.04, stepRun), MAT.wood);
    step.position.set(x0 + halfWidth/2, (i + 1) * stepRise, z0 + stepRun * (i + 0.5));
    step.castShadow = true; step.receiveShadow = true;
    parent.add(step);
  }
  // 折り返し踊り場 (北端)
  const landing = new THREE.Mesh(new THREE.BoxGeometry(widthX, 0.04, stepRun), MAT.wood);
  landing.position.set(x0 + widthX/2, (totalSteps/2) * stepRise, z1 - stepRun/2);
  landing.castShadow = true; landing.receiveShadow = true;
  parent.add(landing);
  // 東側上り: x0+halfWidth .. x1, z1 → z0, 段 7..13
  for (let i = 0; i < totalSteps / 2; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(halfWidth, 0.04, stepRun), MAT.wood);
    const stepIdx = totalSteps/2 + i + 1;
    step.position.set(x0 + halfWidth + halfWidth/2, stepIdx * stepRise, z1 - stepRun * (i + 1.5));
    step.castShadow = true; step.receiveShadow = true;
    parent.add(step);
  }
}
