import * as THREE from 'three';

// 軸並行のシンプルな AABB 衝突判定。
// プレイヤー半径 PLAYER_R を持った円柱と、各 wall mesh の world-space AABB を比較。
// 壁と接触する軸方向の移動成分のみキャンセルする (X / Z 別解決) ので、壁沿いに滑れる。

const PLAYER_R = 0.28;

export class Collider {
  private boxes: THREE.Box3[];

  constructor(walls: THREE.Mesh[]) {
    this.boxes = walls.map((w) => {
      w.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(w);
    });
  }

  // 現在位置 from から delta だけ動こうとしたとき、壁を考慮した最終位置を返す。
  // y は固定 (天井・床は別管理)。
  resolve(from: THREE.Vector3, delta: THREE.Vector3): THREE.Vector3 {
    const out = from.clone();

    // X 軸を先に試す
    out.x += delta.x;
    if (this.intersects(out)) {
      out.x = from.x;
    }
    // 次に Z 軸
    out.z += delta.z;
    if (this.intersects(out)) {
      out.z = from.z;
    }
    // Y はそのまま (歩行中は一定高さの想定)
    out.y += delta.y;
    return out;
  }

  private intersects(pos: THREE.Vector3): boolean {
    // プレイヤーを軸並行 AABB として近似 (半径 PLAYER_R, 高さ 1.7m)
    const playerBox = new THREE.Box3(
      new THREE.Vector3(pos.x - PLAYER_R, pos.y - 1.55, pos.z - PLAYER_R),
      new THREE.Vector3(pos.x + PLAYER_R, pos.y + 0.15, pos.z + PLAYER_R),
    );
    for (const b of this.boxes) {
      if (b.intersectsBox(playerBox)) return true;
    }
    return false;
  }
}
