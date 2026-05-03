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
  for (const level of plan.levels) {
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

    // ----- Walls -----
    // 各 Space 輪郭の各辺を集めて、重複辺 (= 内壁) と単独辺 (= 外壁) を分ける
    const edgeMap = new Map<string, { a: [number, number]; b: [number, number]; count: number; rooms: string[] }>();
    for (const room of level.rooms) {
      if (room.isVoid) continue;
      const poly = room.polygon;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const key = edgeKey(a, b);
        const e = edgeMap.get(key);
        if (e) { e.count += 1; e.rooms.push(room.name); }
        else edgeMap.set(key, { a, b, count: 1, rooms: [room.name] });
      }
    }

    for (const e of edgeMap.values()) {
      const isExternal = e.count === 1;
      const thickness = isExternal ? OUT_T : WALL_T;
      // 同じ辺が2つの Space 両方から登録されると count=2 になるが、
      // ここでは中心線方式で 1本だけ作る。
      makeWall(t, v, ctx, owner, storeyPlace, origin, zDir, xDir, e.a, e.b, thickness, level.ceilingHeight, isExternal)
        .forEach((w) => containedProducts.push(w));
    }

    // ----- Doors (簡易: 開口は作らず、壁のそばに IfcDoor を配置) -----
    // 完全な開口処理 (IfcOpeningElement + IfcRelVoidsElement) は後続イテレーションで。
    for (const door of level.doors) {
      const cx = door.centerX ?? 0;
      const cz = door.centerZ ?? 0;
      const w = door.width;
      const h = door.height;
      const profile = t(IFC.IFCRECTANGLEPROFILEDEF, [
        v(IFC.IFCLABEL, 'AREA'), null,
        t(IFC.IFCAXIS2PLACEMENT2D, [
          t(IFC.IFCCARTESIANPOINT, [[0, 0]]),
          t(IFC.IFCDIRECTION, [[1, 0]]),
        ]),
        w, 50,
      ]);
      const place2d = t(IFC.IFCAXIS2PLACEMENT3D, [origin, zDir, xDir]);
      const solid = t(IFC.IFCEXTRUDEDAREASOLID, [profile, place2d, zDir, h]);
      const rep = t(IFC.IFCSHAPEREPRESENTATION, [
        ctx, v(IFC.IFCLABEL, 'Body'), v(IFC.IFCLABEL, 'SweptSolid'), [solid],
      ]);
      const shape = t(IFC.IFCPRODUCTDEFINITIONSHAPE, [null, null, [rep]]);
      // IFC は (X東, Y北, Z上)。cz は北方向の座標なので Y に渡す。Z=0 (床面)
      const place = localPlace(storeyPlace, cx, cz, 0);
      const doorEnt = t(IFC.IFCDOOR, [
        guid(), owner, v(IFC.IFCLABEL, door.external ? 'Entry' : 'Door'),
        null, null, place, shape, null, h, w, 'DOOR', 'NOTDEFINED', null,
      ]);
      containedProducts.push(doorEnt);
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
