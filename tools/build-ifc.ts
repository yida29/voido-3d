/**
 * voido 間取り (src/floorplan.json) から IFC4 ファイルを生成して
 * public/voido.ifc に書き出す。
 *
 * 実行: npx tsx tools/build-ifc.ts
 *
 * 生成方針:
 *   - 単位は mm (IfcSIUnit METRE + .MILLI.)
 *   - 各部屋は IfcSpace (押し出し)
 *   - 隣接 Space の境界を集約して IfcWallStandardCase を生成 (重複辺は1本にまとめる)
 *   - 床は IfcSlab (Space の輪郭の和集合 → 簡易に各 Space 輪郭ごと)
 *   - ドアは IfcOpeningElement (壁を IfcRelVoidsElement で穴あけ) + IfcDoor
 *   - 階段は IfcStair (フットプリントを単純な矩形ボックスで)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as WebIFC from 'web-ifc';
const IFC = WebIFC as unknown as Record<string, number>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

interface FloorplanRoom {
  name: string;
  label?: string;
  polygon: [number, number][]; // [x, z] in mm
  isVoid?: boolean;
}
interface FloorplanDoor {
  wall: string;
  centerX?: number;
  centerZ?: number;
  width: number;
  height: number;
  external?: boolean;
  kind?: 'swing' | 'sliding';   // swing=開き戸 (省略時), sliding=引き戸
}
interface FloorplanLevel {
  name: string;
  floorY: number;
  ceilingHeight: number;
  rooms: FloorplanRoom[];
  doors: FloorplanDoor[];
}
interface Floorplan {
  name: string;
  units: 'mm';
  outline: { width: number; depth: number };
  levels: FloorplanLevel[];
}

const WALL_T = 120; // 内壁厚 mm
const OUT_T = 180;  // 外壁厚 mm

async function main() {
  const planPath = path.join(ROOT, 'src/floorplan.json');
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8')) as Floorplan;

  const ifc = new WebIFC.IfcAPI();
  await ifc.Init();
  const modelID = ifc.CreateModel({
    schema: 'IFC4',
    name: `${plan.name}.ifc`,
    description: ['voido floorplan generated from floorplan.json'],
    authors: ['voido-3d build-ifc.ts'],
    organizations: ['voido'],
    authorization: 'none',
  });

  const t = (type: number, args: any[]) => {
    const e = ifc.CreateIfcEntity(modelID, type, ...args);
    ifc.WriteLine(modelID, e);
    return e;
  };
  // Wrap a JS value as a typed IFC primitive (IfcLabel / IfcReal / IfcText / etc.)
  const v = (type: number, val: any) => ifc.CreateIfcType(modelID, type, val);

  const guid = () => ifc.CreateIFCGloballyUniqueId(modelID);

  // === Header / Owner ===
  const person = t(IFC.IFCPERSON, [
    null, null, v(IFC.IFCLABEL, 'voido'), null, null, null, null, null,
  ]);
  const org = t(IFC.IFCORGANIZATION, [
    null, v(IFC.IFCLABEL, 'voido'), null, null, null,
  ]);
  const personOrg = t(IFC.IFCPERSONANDORGANIZATION, [person, org, null]);
  const app = t(IFC.IFCAPPLICATION, [
    org,
    v(IFC.IFCLABEL, '0.1.0'),
    v(IFC.IFCLABEL, 'voido-3d build-ifc'),
    v(IFC.IFCIDENTIFIER, 'voido-3d'),
  ]);
  const owner = t(IFC.IFCOWNERHISTORY, [
    personOrg, app, null, 'NOTDEFINED', null, personOrg, app,
    Math.floor(Date.now() / 1000),
  ]);

  // === Units (mm) ===
  const lenUnit = t(IFC.IFCSIUNIT, [null, 'LENGTHUNIT', 'MILLI', 'METRE']);
  const areaUnit = t(IFC.IFCSIUNIT, [null, 'AREAUNIT', null, 'SQUARE_METRE']);
  const volUnit  = t(IFC.IFCSIUNIT, [null, 'VOLUMEUNIT', null, 'CUBIC_METRE']);
  const angUnit  = t(IFC.IFCSIUNIT, [null, 'PLANEANGLEUNIT', null, 'RADIAN']);
  const unitAssn = t(IFC.IFCUNITASSIGNMENT, [[lenUnit, areaUnit, volUnit, angUnit]]);

  // === Geometric context ===
  const origin = t(IFC.IFCCARTESIANPOINT, [[0, 0, 0]]);
  const zDir   = t(IFC.IFCDIRECTION, [[0, 0, 1]]);
  const xDir   = t(IFC.IFCDIRECTION, [[1, 0, 0]]);
  const placeWorld = t(IFC.IFCAXIS2PLACEMENT3D, [origin, zDir, xDir]);
  const ctx = t(IFC.IFCGEOMETRICREPRESENTATIONCONTEXT, [
    null, v(IFC.IFCLABEL, 'Model'), 3, 1e-5, placeWorld, null,
  ]);

  // === Project / Site / Building ===
  const project = t(IFC.IFCPROJECT, [
    guid(), owner, v(IFC.IFCLABEL, plan.name), null, null, null, null,
    [ctx], unitAssn,
  ]);

  const localPlace = (parentPlacement: any | null, x = 0, y = 0, z = 0) => {
    const p = t(IFC.IFCCARTESIANPOINT, [[x, y, z]]);
    const a = t(IFC.IFCAXIS2PLACEMENT3D, [p, zDir, xDir]);
    return t(IFC.IFCLOCALPLACEMENT, [parentPlacement, a]);
  };

  const sitePlace = localPlace(null);
  const site = t(IFC.IFCSITE, [
    guid(), owner, v(IFC.IFCLABEL, 'Site'), null, null, sitePlace, null, null,
    'ELEMENT', null, null, null, null, null,
  ]);
  const buildingPlace = localPlace(sitePlace);
  const building = t(IFC.IFCBUILDING, [
    guid(), owner, v(IFC.IFCLABEL, plan.name), null, null, buildingPlace, null, null,
    'ELEMENT', null, null, null,
  ]);

  // Aggregates: project -> site -> building -> storeys
  t(IFC.IFCRELAGGREGATES, [guid(), owner, null, null, project, [site]]);
  t(IFC.IFCRELAGGREGATES, [guid(), owner, null, null, site,    [building]]);

  // === per-level ===
  const storeyEntities: any[] = [];
  for (let levelIdx = 0; levelIdx < plan.levels.length; levelIdx++) {
    const level = plan.levels[levelIdx];
    const nextLevel = plan.levels[levelIdx + 1]; // undefined なら最上階
    const SLAB_T = 100; // mm 床版厚
    // 壁の有効高さ:
    //  - 中間階: 次階の床下面 (= nextLevel.floorY - SLAB_T) - 当階floorY
    //  - 最上階: ceilingHeight (天井までで止める)
    // どちらにしても floorplan.json の ceilingHeight をベースに、
    // 床版分を吸収して階間の隙間ができないようにする
    const wallHeight = nextLevel
      ? (nextLevel.floorY - SLAB_T) - level.floorY
      : level.ceilingHeight;
    // storey の placement は Y=0 (= 建物 placement と同じ)。
    // 階高 (Elevation) は IfcBuildingStorey の属性で表現する。
    // これにより web-ifc 側は中身ジオメトリの Y を変えず、
    // ローダー (src/building.ts) で Elevation を加算するだけで正しい階に置ける。
    const storeyPlace = localPlace(buildingPlace, 0, 0, 0);
    const storey = t(IFC.IFCBUILDINGSTOREY, [
      guid(), owner, v(IFC.IFCLABEL, level.name), null, null, storeyPlace, null, null,
      'ELEMENT', level.floorY,
    ]);
    storeyEntities.push(storey);

    const containedProducts: any[] = [];

    // ----- Spaces -----
    for (const room of level.rooms) {
      if (room.isVoid) continue; // 吹抜は空間として作らない

      // Space placement = storey 直下の原点
      const spacePlace = localPlace(storeyPlace);
      const profile = makePolygonProfile(t, room.polygon);
      const place2d = t(IFC.IFCAXIS2PLACEMENT3D, [origin, zDir, xDir]);
      // Space (内部空間) は ceilingHeight (床から天井まで) で押し出す
      const solid = t(IFC.IFCEXTRUDEDAREASOLID, [profile, place2d, zDir, level.ceilingHeight]);
      const shapeRep = t(IFC.IFCSHAPEREPRESENTATION, [
        ctx, v(IFC.IFCLABEL, 'Body'), v(IFC.IFCLABEL, 'SweptSolid'), [solid],
      ]);
      const shape = t(IFC.IFCPRODUCTDEFINITIONSHAPE, [null, null, [shapeRep]]);
      const space = t(IFC.IFCSPACE, [
        guid(), owner,
        v(IFC.IFCLABEL, room.name),
        room.label ? v(IFC.IFCTEXT, room.label) : null,
        null, spacePlace, shape, null, 'ELEMENT', 'INTERNAL', null,
      ]);
      containedProducts.push(space);
    }

    // ----- Slab (簡易: 階の外形を一枚) -----
    const outlinePoly: [number, number][] = [
      [0, 0], [plan.outline.width, 0],
      [plan.outline.width, plan.outline.depth], [0, plan.outline.depth],
    ];
    const slabProfile = makePolygonProfile(t, outlinePoly);
    const slabPlace = localPlace(storeyPlace, 0, -100, 0); // 床版を 100mm 下げて配置 (上面 = floorY)
    const slabPlace2d = t(IFC.IFCAXIS2PLACEMENT3D, [origin, zDir, xDir]);
    const slabSolid = t(IFC.IFCEXTRUDEDAREASOLID, [slabProfile, slabPlace2d, zDir, 100]);
    const slabRep = t(IFC.IFCSHAPEREPRESENTATION, [
      ctx, v(IFC.IFCLABEL, 'Body'), v(IFC.IFCLABEL, 'SweptSolid'), [slabSolid],
    ]);
    const slabShape = t(IFC.IFCPRODUCTDEFINITIONSHAPE, [null, null, [slabRep]]);
    const slab = t(IFC.IFCSLAB, [
      guid(), owner, v(IFC.IFCLABEL, `${level.name}_slab`), null, null,
      slabPlace, slabShape, null, 'FLOOR',
    ]);
    containedProducts.push(slab);

    // ----- Walls + Door 開口 -----
    // 1. 各 Space 輪郭の辺を集める
    interface Edge { a: [number, number]; b: [number, number]; count: number }
    const edges: Edge[] = [];
    const edgeIndex = new Map<string, number>();
    for (const room of level.rooms) {
      if (room.isVoid) continue;
      const poly = room.polygon;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const key = edgeKey(a, b);
        const idx = edgeIndex.get(key);
        if (idx != null) edges[idx].count += 1;
        else { edgeIndex.set(key, edges.length); edges.push({ a, b, count: 1 }); }
      }
    }

    // 2. 各ドアについて「乗っている辺」を見つけ、その辺を分割記録
    // 結果: 各辺 → [そのまま] or [ドア両側の 2 セグメント]
    interface Segment { a: [number, number]; b: [number, number] }
    interface SlidingPanel { a: [number, number]; b: [number, number]; thickness: number; height: number }
    const wallSegs: { e: Edge; segs: Segment[]; lintels: { center: [number, number]; w: number; bottomY: number; topY: number }[] }[] =
      edges.map((e) => ({ e, segs: [{ a: e.a, b: e.b }], lintels: [] }));
    const slidingPanels: SlidingPanel[] = [];

    for (const door of level.doors) {
      const cx = door.centerX ?? null;
      const cz = door.centerZ ?? null;
      // ドアが壁面上にある中心点を決める (片方欠けてる場合はそこを推定)
      // 実装簡略: 辺ごとに「ドア中心がその辺の線分上にあるか」をテスト
      let bestIdx = -1;
      let bestT = 0; // 0..1
      let bestDist = Infinity;
      for (let i = 0; i < wallSegs.length; i++) {
        const e = wallSegs[i].e;
        const x = cx ?? (e.a[0] + e.b[0]) / 2;
        const z = cz ?? (e.a[1] + e.b[1]) / 2;
        const dx = e.b[0] - e.a[0], dz = e.b[1] - e.a[1];
        const len2 = dx * dx + dz * dz;
        if (len2 === 0) continue;
        const t = ((x - e.a[0]) * dx + (z - e.a[1]) * dz) / len2;
        if (t < 0 || t > 1) continue;
        const projX = e.a[0] + t * dx;
        const projZ = e.a[1] + t * dz;
        const d2 = (x - projX) ** 2 + (z - projZ) ** 2;
        if (d2 < bestDist) { bestDist = d2; bestIdx = i; bestT = t; }
      }
      if (bestIdx < 0 || bestDist > 1.0) {
        console.warn(`[door] not on any wall edge:`, door);
        continue;
      }
      // 辺を分割: 元の segs[0] を「a → ドア左端」「ドア右端 → b」に置き換え
      const ws = wallSegs[bestIdx];
      const e = ws.e;
      const dx = e.b[0] - e.a[0], dz = e.b[1] - e.a[1];
      const len = Math.hypot(dx, dz);
      const ux = dx / len, uz = dz / len;
      const halfW = door.width / 2;
      const cxOnEdge = e.a[0] + bestT * dx;
      const czOnEdge = e.a[1] + bestT * dz;
      const leftX  = cxOnEdge - ux * halfW, leftZ  = czOnEdge - uz * halfW;
      const rightX = cxOnEdge + ux * halfW, rightZ = czOnEdge + uz * halfW;
      // 既存の segs から、この辺と一致するセグメントを差し替え (ドアが2個並ぶケースは未対応)
      ws.segs = [
        { a: e.a, b: [leftX, leftZ] },
        { a: [rightX, rightZ], b: e.b },
      ];
      // ドア上のリンテル (要らなくする: 開けっぱなしなので頭上もフリーに)
      // 引き戸は壁の脇に薄板 (見た目のため) を1枚追加
      if (door.kind === 'sliding') {
        // 開いた状態を表現: 引き戸が "壁にスライドして収納された" 状態。
        // 開口の右側に、ドア幅分の薄板を残す
        const px = rightX, pz = rightZ;
        const px2 = rightX + ux * door.width, pz2 = rightZ + uz * door.width;
        slidingPanels.push({ a: [px, pz], b: [px2, pz2], thickness: 30, height: door.height });
      }
    }

    // 3. wallSegs の各セグメントを makeWall で IFC 壁に変換
    for (const ws of wallSegs) {
      const isExternal = ws.e.count === 1;
      const thickness = isExternal ? OUT_T : WALL_T;
      for (const seg of ws.segs) {
        // 長さが極小なら出さない
        const segLen = Math.hypot(seg.b[0] - seg.a[0], seg.b[1] - seg.a[1]);
        if (segLen < 50) continue;
        makeWall(t, v, ctx, owner, storeyPlace, origin, zDir, xDir, seg.a, seg.b, thickness, wallHeight, isExternal)
          .forEach((w) => containedProducts.push(w));
      }
    }

    // 4. 引き戸パネル
    for (const p of slidingPanels) {
      makeWall(t, v, ctx, owner, storeyPlace, origin, zDir, xDir, p.a, p.b, p.thickness, p.height, false)
        .forEach((w) => containedProducts.push(w));
    }

    // 5. 1F のときだけ、external_features (玄関アプローチなど) を生成
    if (level.name === '1F' && Array.isArray((plan as any).external_features)) {
      for (const f of (plan as any).external_features as any[]) {
        if (f.type === 'entry_porch') {
          // バルコニー (デッキ): 矩形スラブ
          if (f.balcony) {
            const b = f.balcony;
            const x0 = b.centerX - b.width / 2;
            const z0 = b.z;
            const slabPolyB: [number, number][] = [
              [x0, z0], [x0 + b.width, z0],
              [x0 + b.width, z0 + b.depth], [x0, z0 + b.depth],
            ];
            const profB = makePolygonProfile(t, slabPolyB);
            const placeB = localPlace(storeyPlace, 0, 0, b.topY - b.thickness);
            const place2dB = t(IFC.IFCAXIS2PLACEMENT3D, [origin, zDir, xDir]);
            const solidB = t(IFC.IFCEXTRUDEDAREASOLID, [profB, place2dB, zDir, b.thickness]);
            const repB = t(IFC.IFCSHAPEREPRESENTATION, [
              ctx, v(IFC.IFCLABEL, 'Body'), v(IFC.IFCLABEL, 'SweptSolid'), [solidB],
            ]);
            const shapeB = t(IFC.IFCPRODUCTDEFINITIONSHAPE, [null, null, [repB]]);
            const slabB = t(IFC.IFCSLAB, [
              guid(), owner, v(IFC.IFCLABEL, 'entry_balcony'), null, null,
              placeB, shapeB, null, 'BASESLAB',
            ]);
            containedProducts.push(slabB);
          }
          // 階段: 各段を順に Slab で
          if (f.stairs) {
            const s = f.stairs;
            const stepRise = s.totalRise / s.steps;
            const stepDepth = s.depth / s.steps;
            for (let i = 0; i < s.steps; i++) {
              const x0 = s.centerX - s.width / 2;
              // i 段目の z 位置 (北に進む)
              const zStart = s.z + i * stepDepth;
              const zEnd = zStart + (s.depth - i * stepDepth);
              const stepPoly: [number, number][] = [
                [x0, zStart], [x0 + s.width, zStart],
                [x0 + s.width, zEnd], [x0, zEnd],
              ];
              const profS = makePolygonProfile(t, stepPoly);
              const stepBottomY = -s.totalRise + i * stepRise;
              const placeS = localPlace(storeyPlace, 0, 0, stepBottomY);
              const place2dS = t(IFC.IFCAXIS2PLACEMENT3D, [origin, zDir, xDir]);
              const solidS = t(IFC.IFCEXTRUDEDAREASOLID, [profS, place2dS, zDir, stepRise]);
              const repS = t(IFC.IFCSHAPEREPRESENTATION, [
                ctx, v(IFC.IFCLABEL, 'Body'), v(IFC.IFCLABEL, 'SweptSolid'), [solidS],
              ]);
              const shapeS = t(IFC.IFCPRODUCTDEFINITIONSHAPE, [null, null, [repS]]);
              const slabS = t(IFC.IFCSLAB, [
                guid(), owner, v(IFC.IFCLABEL, `entry_step_${i}`), null, null,
                placeS, shapeS, null, 'BASESLAB',
              ]);
              containedProducts.push(slabS);
            }
          }
        }
      }
    }

    // 階 → コンテンツ
    if (containedProducts.length > 0) {
      t(IFC.IFCRELCONTAINEDINSPATIALSTRUCTURE, [
        guid(), owner, null, null, containedProducts, storey,
      ]);
    }
  }

  t(IFC.IFCRELAGGREGATES, [guid(), owner, null, null, building, storeyEntities]);

  // === Save ===
  const data = ifc.SaveModel(modelID);
  ifc.CloseModel(modelID);

  const outPath = path.join(ROOT, 'public/voido.ifc');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(data));
  console.log(`✓ wrote ${outPath} (${data.byteLength} bytes)`);
}

// ---- helpers ----

function edgeKey(a: [number, number], b: [number, number]): string {
  // 向き不問の正規化キー (小さい方を先に)
  const k1 = `${a[0]},${a[1]}`;
  const k2 = `${b[0]},${b[1]}`;
  return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
}

function makePolygonProfile(t: (type: number, args: any[]) => any, poly: [number, number][]) {
  const points = poly.map(([x, y]) => t(IFC.IFCCARTESIANPOINT, [[x, y]]));
  // 閉じる: ポリラインは最後に最初の点を再度
  points.push(points[0]);
  const polyline = t(IFC.IFCPOLYLINE, [points]);
  return t(IFC.IFCARBITRARYCLOSEDPROFILEDEF, [
    'AREA', null, polyline,
  ]);
}

function makeWall(
  t: (type: number, args: any[]) => any,
  v: (type: number, val: any) => any,
  ctx: any, owner: any, storeyPlace: any,
  origin: any, zDir: any, xDir: any,
  a: [number, number], b: [number, number],
  thickness: number, height: number, _external: boolean,
) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  if (len < 1) return [];

  // 壁ポリゴンを a→b 方向に厚み thickness で押し出すため、
  // a-b 線分を中心線として、左右に thickness/2 ずつ広がる長方形を作る。
  // 法線 (左) = (-dz, dx)/len
  const nx = -dz / len;
  const nz =  dx / len;
  const half = thickness / 2;
  const p1: [number, number] = [a[0] + nx * half, a[1] + nz * half];
  const p2: [number, number] = [b[0] + nx * half, b[1] + nz * half];
  const p3: [number, number] = [b[0] - nx * half, b[1] - nz * half];
  const p4: [number, number] = [a[0] - nx * half, a[1] - nz * half];
  const points = [p1, p2, p3, p4, p1].map(([x, y]) => t(IFC.IFCCARTESIANPOINT, [[x, y]]));
  const polyline = t(IFC.IFCPOLYLINE, [points]);
  const profile = t(IFC.IFCARBITRARYCLOSEDPROFILEDEF, ['AREA', null, polyline]);
  const place2d = t(IFC.IFCAXIS2PLACEMENT3D, [origin, zDir, xDir]);
  const solid = t(IFC.IFCEXTRUDEDAREASOLID, [profile, place2d, zDir, height]);
  const rep = t(IFC.IFCSHAPEREPRESENTATION, [
    ctx, v(IFC.IFCLABEL, 'Body'), v(IFC.IFCLABEL, 'SweptSolid'), [solid],
  ]);
  const shape = t(IFC.IFCPRODUCTDEFINITIONSHAPE, [null, null, [rep]]);
  const place = t(IFC.IFCLOCALPLACEMENT, [
    storeyPlace, t(IFC.IFCAXIS2PLACEMENT3D, [origin, zDir, xDir]),
  ]);
  const wall = t(IFC.IFCWALLSTANDARDCASE, [
    null, owner, v(IFC.IFCLABEL, 'Wall'), null, null, place, shape, null, 'STANDARD',
  ]);
  // GlobalId は NewIfcEntity の最初に入る
  // (上では null にしているが web-ifc は自動で振らないので明示的に置き直す)
  // → CreateIFCGloballyUniqueId で置換
  return [wall];
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
