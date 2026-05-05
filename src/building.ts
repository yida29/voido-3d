import * as THREE from 'three';
import * as WebIFC from 'web-ifc';

// public/voido.ifc を Three.js シーンに読み込む。
// IFC は IFC4 標準形式 (STEP)。tools/build-ifc.ts で生成される。
//
// 座標系:
//   IFC ファイル内は mm 単位、原点 = 建物南西角、+X=東、+Y=上、+Z=北
//   Three.js シーンも 1 unit = 1 m に揃えるため 0.001 倍する。
//   建物中心が原点になるよう更にオフセットする (操作系に合わせる)。

export interface IFCMeshInfo {
  mesh: THREE.Mesh;
  type: string;            // 'IFCWALLSTANDARDCASE' など
  expressID: number;
  storey: '1F' | '2F' | 'unknown';
  // ローカル座標の minY/maxY (m, root.position 適用前)。階判定に使用
  localMinY: number;
  localMaxY: number;
}

export interface VoidoBuilding {
  root: THREE.Group;
  walls: THREE.Mesh[];
  meshes: IFCMeshInfo[];   // 全メッシュ (Spaces 含む)
  bbox: THREE.Box3;        // m 単位 (Three.js スケール)
  outlineMm: { width: number; depth: number };
  rootOffsetM: { x: number; z: number }; // root.position の x, z (m)
}

const TYPE_NAME: Record<number, string> = {};
const IFC = WebIFC as unknown as Record<string, unknown>;
for (const [k, val] of Object.entries(IFC)) {
  if (typeof val === 'number' && k.startsWith('IFC')) TYPE_NAME[val] = k;
}

// voido の Google Maps 写真をもとに色味を設定:
//   - 外壁: ネイビーブルー (#2e3f55 程度)
//   - 屋根: 濃いグレー (#3a3a3a)
//   - 玄関階段・デッキ: 木目 (暖色 #8b5a3c)
//   - 基礎: 白いコンクリート (#d8d3cb)
//   - 内壁: 明るいグレージュ (室内側)
const COLORS: Record<string, number> = {
  IFCWALL: 0x3d5575,            // 外壁ネイビー (太陽光下で映える明るめ)
  IFCWALLSTANDARDCASE: 0x3d5575,
  IFCSLAB: 0xd8d3cb,            // 基礎・床版は白コンクリート
  IFCDOOR: 0x222222,
  IFCWINDOW: 0xaad8ff,          // ガラス: 薄い空色
  IFCSPACE: 0x000000,
  IFCSTAIR: 0xa07050,
  IFCROOF: 0x4d4d4d,            // 屋根 濃グレー (もう少し明るく)
};

// IfcSlab/IfcWall の Name から色を上書き
function colorByName(name: string | undefined, typeName: string): number | undefined {
  if (!name) return undefined;
  if (name === 'foundation') return 0xd8d3cb;
  if (name === 'roof') return 0x3a3a3a;
  if (name === 'entry_balcony') return 0x8b5a3c;
  if (name.startsWith('entry_step')) return 0x8b5a3c;
  if (name === 'window') return 0xaad8ff;
  if (name === 'window_frame') return 0x8b5a3c;  // 窓枠: 茶色木枠 (entry deck と同じ色)
  if (name === 'door_frame') return 0x1a1a1a;    // 玄関ドアの枠: 黒
  if (name === 'door_glass') return 0xc8e0f0;    // 玄関ドアのガラス: 明るい光通し
  if (name === 'cantilever_box') return 0x222222; // 玄関上の Cantilever 箱: 黒
  if (name === 'horizontal_trim') return 0x8b5a3c; // 1F⇔2F 境目の水平トリム: 茶色木製
  if (name === 'railing') return 0x6b4a30;       // 吹抜の手すり: ダーク木目
  // 外壁を方角ごとに塗り分け (Google Maps 写真より):
  //   写真の voido は ティール寄りの濃いネイビー (やや青緑)
  if (name === 'wall_S' || name === 'wall_N') return 0x365064;
  if (name === 'wall_E' || name === 'wall_W') return 0x456075;
  // 室内をウッド質感に統一 (家の中はナチュラルウッドの内装)
  // 内壁: 明るめのウッド (オーク系、サイディングの板張り)
  if (name === 'wall_inner') return 0xc99565;
  // 室内床/天井 (= 各階の slab): やや暗めのウッド (フローリング)
  if (name.endsWith('_slab') || name.includes('_slab_')) return 0xa6724a;
  void typeName;
  return undefined;
}

export async function loadVoidoIFC(url: string): Promise<VoidoBuilding> {
  const ifc = new WebIFC.IfcAPI();
  // Vite では public/ 配下のファイルは / で配信される。
  // GitHub Pages では /voido-3d/ 配下なので import.meta.env.BASE_URL を使う。
  const wasmBase = (import.meta.env.BASE_URL || '/');
  ifc.SetWasmPath(wasmBase, true);
  await ifc.Init();

  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const modelID = ifc.OpenModel(buf);

  // expressID → storey 名/elevation(mm) のマップを spatial structure から構築
  interface StoreyInfo { name: '1F' | '2F'; elevationMm: number }
  const storeyMap = new Map<number, StoreyInfo>();
  try {
    const tree = await ifc.properties.getSpatialStructure(modelID, true);
    walkStorey(tree, null);
    function walkStorey(node: any, current: StoreyInfo | null) {
      let next = current;
      const typeRaw = node.type;
      const typeStr = typeof typeRaw === 'number'
        ? (TYPE_NAME[typeRaw] || '')
        : String(typeRaw || '').toUpperCase();
      if (typeStr === 'IFCBUILDINGSTOREY') {
        const elevation = node.Elevation?.value ?? 0;
        const sName: '1F' | '2F' = elevation < 100 ? '1F' : '2F';
        next = { name: sName, elevationMm: elevation };
      }
      if (typeof node.expressID === 'number' && next) {
        storeyMap.set(node.expressID, next);
      }
      if (Array.isArray(node.children)) {
        for (const c of node.children) walkStorey(c, next);
      }
    }
  } catch (e) {
    console.warn('storey map failed:', e);
  }

  const root = new THREE.Group();
  const walls: THREE.Mesh[] = [];
  const meshes: IFCMeshInfo[] = [];

  // メッシュをすべて取得して Three.js Mesh に変換
  ifc.StreamAllMeshes(modelID, (flatMesh) => {
    const expressID = flatMesh.expressID;
    let typeName = 'IFC';
    try {
      const props = ifc.GetLine(modelID, expressID, false);
      const t = (props as any)?.type as number | undefined;
      if (t && TYPE_NAME[t]) typeName = TYPE_NAME[t];
    } catch { /* ignore */ }

    const isSpace = typeName === 'IFCSPACE';
    // Name 属性を取得 (色決定に使用)
    let entName: string | undefined = undefined;
    try {
      const props = ifc.GetLine(modelID, expressID, false) as any;
      entName = props?.Name?.value ?? undefined;
    } catch { /* ignore */ }

    const placedGeoms = flatMesh.geometries;
    for (let i = 0; i < placedGeoms.size(); i++) {
      const placed = placedGeoms.get(i);
      const geom = ifc.GetGeometry(modelID, placed.geometryExpressID);
      const verts = ifc.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
      const idx   = ifc.GetIndexArray(geom.GetIndexData(),  geom.GetIndexDataSize());

      // verts は [x, y, z, nx, ny, nz, ...] のインターリーブ
      const positions = new Float32Array(verts.length / 2);
      const normals   = new Float32Array(verts.length / 2);
      for (let v = 0; v < verts.length / 6; v++) {
        positions[v * 3 + 0] = verts[v * 6 + 0];
        positions[v * 3 + 1] = verts[v * 6 + 1];
        positions[v * 3 + 2] = verts[v * 6 + 2];
        normals[v * 3 + 0]   = verts[v * 6 + 3];
        normals[v * 3 + 1]   = verts[v * 6 + 4];
        normals[v * 3 + 2]   = verts[v * 6 + 5];
      }

      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      bg.setAttribute('normal',   new THREE.BufferAttribute(normals, 3));
      bg.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));

      // 配置行列。web-ifc の flatTransformation は列優先 (THREE.Matrix4 と同じ)
      const arr = placed.flatTransformation as unknown as number[];
      bg.applyMatrix4(new THREE.Matrix4().fromArray(arr));

      // web-ifc は IfcBuildingStorey の Elevation を flatTransformation に
      // 反映してくれない (確認済み) ので、ここで手動で Y 方向にずらす。
      const storeyInfo = storeyMap.get(expressID);
      if (storeyInfo && storeyInfo.elevationMm !== 0) {
        bg.translate(0, storeyInfo.elevationMm, 0);
      }

      // mm → m
      bg.scale(0.001, 0.001, 0.001);

      const color = colorByName(entName, typeName) ?? COLORS[typeName] ?? 0xc0c0c0;
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.0 });
      const mesh = new THREE.Mesh(bg, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.ifcType = typeName;
      mesh.userData.expressID = expressID;

      // Spaces はシーンに add するが非表示にして、データだけ保持 (間取り図用)
      if (isSpace) mesh.visible = false;
      root.add(mesh);

      if (typeName === 'IFCWALL' || typeName === 'IFCWALLSTANDARDCASE') {
        walls.push(mesh);
      }

      // 階判定: spatial structure の階層情報を優先
      bg.computeBoundingBox();
      const bb = bg.boundingBox!;
      const storey: '1F' | '2F' | 'unknown' = storeyMap.get(expressID)?.name ?? 'unknown';

      meshes.push({ mesh, type: typeName, expressID, storey, localMinY: bb.min.y, localMaxY: bb.max.y });
    }
  });

  ifc.CloseModel(modelID);

  // バウンディングボックスを取って建物中心を原点に (XZ のみ。Yはそのまま)
  const bbox = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  root.position.set(-center.x, -bbox.min.y, -center.z);
  const finalBbox = new THREE.Box3().setFromObject(root);

  return {
    root,
    walls,
    meshes,
    bbox: finalBbox,
    // 実際の世界 bbox から外形を逆算 (m → mm)
    outlineMm: {
      width: Math.round((finalBbox.max.x - finalBbox.min.x) * 1000),
      depth: Math.round((finalBbox.max.z - finalBbox.min.z) * 1000),
    },
    rootOffsetM: { x: root.position.x, z: root.position.z },
  };
}
