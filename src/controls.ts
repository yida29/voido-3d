import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import type { Collider } from './collision';

const WALK_SPEED = 3.2;   // m/s
const RUN_SPEED  = 6.0;   // m/s (Shift)
const EYE_HEIGHT = 1.6;   // m

export interface Controls {
  object: THREE.Object3D;          // PointerLockControls.getObject()
  update(dt: number): void;
}

export function createControls(
  camera: THREE.PerspectiveCamera,
  overlay: HTMLElement,
  collider: Collider,
): Controls {
  const controls = new PointerLockControls(camera, document.body);
  // 初期位置: 玄関ドア前 (南壁東寄り) からスタート
  // 建物は南西角原点 (0,0,0) を中心 (-W/2, 0, -D/2) にずらしている。
  // 南壁は Z = -D/2 = -4.55、玄関は東寄り。建物外側=Z<-4.55 から見たい。
  controls.object.position.set(3.7, EYE_HEIGHT, -7.0);
  // 建物の方 (北) を見る
  camera.lookAt(0, EYE_HEIGHT, 0);

  overlay.addEventListener('click', () => controls.lock());
  controls.addEventListener('lock', () => { overlay.style.display = 'none'; });
  controls.addEventListener('unlock', () => { overlay.style.display = 'flex'; });

  const keys = { f: false, b: false, l: false, r: false, run: false, up: false, down: false };
  window.addEventListener('keydown', (e) => updateKeys(e, true));
  window.addEventListener('keyup',   (e) => updateKeys(e, false));

  function updateKeys(e: KeyboardEvent, pressed: boolean) {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp':    keys.f = pressed; break;
      case 'KeyS': case 'ArrowDown':  keys.b = pressed; break;
      case 'KeyA': case 'ArrowLeft':  keys.l = pressed; break;
      case 'KeyD': case 'ArrowRight': keys.r = pressed; break;
      case 'ShiftLeft': case 'ShiftRight': keys.run = pressed; break;
      case 'Space':    keys.up   = pressed; break;     // 念のため上下移動 (階段補助)
      case 'ControlLeft': case 'ControlRight': keys.down = pressed; break;
    }
  }

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const move = new THREE.Vector3();

  function update(dt: number) {
    if (!controls.isLocked) return;

    const speed = (keys.run ? RUN_SPEED : WALK_SPEED) * dt;

    // カメラの水平向きを取得 (Y 成分は無視して水平移動)
    camera.getWorldDirection(forward);
    forward.y = 0; forward.normalize();
    right.crossVectors(forward, camera.up).normalize();

    move.set(0, 0, 0);
    if (keys.f) move.add(forward);
    if (keys.b) move.sub(forward);
    if (keys.r) move.add(right);
    if (keys.l) move.sub(right);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);

    // 階段補助: 床上の物体に当たったら少し上に乗り上げる試行
    const cur = controls.object.position;
    const next = collider.resolve(cur, move);

    // 高さは EYE_HEIGHT 固定。階段上の高さ合わせは床の段差を踏むだけなので、
    // ここでは簡易に床を 0 と仮定し EYE_HEIGHT を維持する。
    next.y = EYE_HEIGHT;

    controls.object.position.copy(next);
  }

  return { object: controls.object, update };
}
