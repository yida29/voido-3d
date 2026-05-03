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

const COLORS: Record<string, number> = {
  IFCWALL: 0xead9c0,
  IFCWALLSTANDARDCASE: 0xead9c0,
  IFCSLAB: 0x8b6543,
  IFCDOOR: 0x6b4a30,
  IFCWINDOW: 0xaad8ff,
  IFCSPACE: 0x000000, // hidden
  IFCSTAIR: 0x6b4a30,
  IFCROOF: 0x553a2a,
};

export async function loadVoidoIFC(url: string): Promise<VoidoBuilding> {
  const ifc = new WebIFC.IfcAPI();
  // Vite では public/ 配下のファイルは / で配信される。
  // GitHub Pages では /voido-3d/ 配下なので import.meta.env.BASE_URL を使う。
  const wasmBase = (import.meta.env.BASE_URL || '/');
  ifc.SetWasmPath(wasmBase, true);
  await ifc.Init();

  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const modelID = ifc.OpenModel(buf);

  // expressID → storey 名 のマップを spatial structure から構築
  const storeyMap = new Map<number, '1F' | '2F'>();
  try {
    const tree = await ifc.properties.getSpatialStructure(modelID, true);
    walkStorey(tree, null);
    function walkStorey(node: any, currentStorey: '1F' | '2F' | null) {
      let next = currentStorey;
      // type は数値か文字列、文字列は大文字混在
      const typeRaw = node.type;
      const typeStr = typeof typeRaw === 'number'
        ? (TYPE_NAME[typeRaw] || '')
        : String(typeRaw || '').toUpperCase();
      if (typeStr === 'IFCBUILDINGSTOREY') {
        const name = node.Name?.value ?? node.LongName?.value ?? '';
        const elevation = node.Elevation?.value ?? 0;
        // elevation で 1F/2F を確定 (建物名でも判定するが elevation がより安全)
        if (elevation < 100) next = '1F';
        else next = '2F';
        console.log(`[STOREY] expressID=${node.expressID}, name=${name}, elevation=${elevation} → ${next}`);
      }
      if (typeof node.expressID === 'number' && next) {
        storeyMap.set(node.expressID, next);
      }
      if (Array.isArray(node.children)) {
        for (const c of node.children) walkStorey(c, next);
      }
    }
    console.log('[STOREY MAP] size=', storeyMap.size);
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
      // 配置行列を適用 (web-ifc は中心化された頂点を返し、translation 成分で world 配置する)
      const arr = placed.flatTransformation as unknown as number[];
      bg.applyMatrix4(new THREE.Matrix4().fromArray(arr));

      // mm → m
      bg.scale(0.001, 0.001, 0.001);

      const color = COLORS[typeName] ?? 0xc0c0c0;
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
      const storey: '1F' | '2F' | 'unknown' = storeyMap.get(expressID) ?? 'unknown';

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
    outlineMm: { width: 10920, depth: 9100 }, // floorplan.json と同期
    rootOffsetM: { x: root.position.x, z: root.position.z },
  };
}
