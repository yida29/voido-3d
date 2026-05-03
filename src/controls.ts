import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import type { Collider } from './collision';
import { readState, writeState } from './url-state';

const WALK_SPEED = 3.2;   // m/s
const RUN_SPEED  = 6.0;   // m/s (Shift)
const EYE_HEIGHT = 1.6;   // m

const FLOOR_Y_1F = 0;
const FLOOR_Y_2F = 4.04;

export interface Controls {
  object: THREE.Object3D;
  update(dt: number): void;
}

export function createControls(
  camera: THREE.PerspectiveCamera,
  collider: Collider,
  worldBbox?: THREE.Box3,
): Controls {
  const controls = new PointerLockControls(camera, document.body);

  // 初期位置: URL → 既定値の順に決定
  const url = readState();
  let startX: number, startY: number, startZ: number;
  if (url.posX != null && url.posY != null && url.posZ != null) {
    startX = url.posX; startY = url.posY; startZ = url.posZ;
  } else if (worldBbox) {
    const c = new THREE.Vector3();
    worldBbox.getCenter(c);
    // 建物の南端から少し離れた位置 (建物全体が見える距離)
    startX = c.x + 2.0;
    startY = EYE_HEIGHT;
    startZ = worldBbox.max.z + 8.0;
  } else {
    startX = 0; startY = EYE_HEIGHT; startZ = 8;
  }
  controls.object.position.set(startX, startY, startZ);

  // 向き
  if (url.rotY != null) controls.object.rotation.y = url.rotY;
  else if (worldBbox) {
    const c = new THREE.Vector3(); worldBbox.getCenter(c);
    camera.lookAt(c.x, EYE_HEIGHT, c.z);
  }
  if (url.rotX != null) {
    // PointerLockControls の pitch は内部で camera.rotation.x を直接動かしている
    camera.rotation.x = url.rotX;
  }

  // 現在階を Y 値から推測
  let currentFloor: '1F' | '2F' = startY > (FLOOR_Y_1F + FLOOR_Y_2F) / 2 + EYE_HEIGHT * 0.5 ? '2F' : '1F';

  // 自動でロックを取る (キャンバス内のクリックで)
  const canvas = document.getElementById('app') as HTMLElement;
  canvas?.addEventListener('click', () => {
    if (!controls.isLocked) controls.lock();
  });

  const keys = { f: false, b: false, l: false, r: false, run: false };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Digit1') {
      currentFloor = '1F';
      controls.object.position.y = FLOOR_Y_1F + EYE_HEIGHT;
      writeNow();
      return;
    }
    if (e.code === 'Digit2') {
      currentFloor = '2F';
      controls.object.position.y = FLOOR_Y_2F + EYE_HEIGHT;
      writeNow();
      return;
    }
    updateKeys(e, true);
  });
  window.addEventListener('keyup', (e) => updateKeys(e, false));

  function updateKeys(e: KeyboardEvent, pressed: boolean) {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp':    keys.f = pressed; break;
      case 'KeyS': case 'ArrowDown':  keys.b = pressed; break;
      case 'KeyA': case 'ArrowLeft':  keys.l = pressed; break;
      case 'KeyD': case 'ArrowRight': keys.r = pressed; break;
      case 'ShiftLeft': case 'ShiftRight': keys.run = pressed; break;
    }
  }

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const move = new THREE.Vector3();

  function writeNow() {
    const p = controls.object.position;
    writeState({
      posX: p.x, posY: p.y, posZ: p.z,
      rotX: camera.rotation.x,
      rotY: controls.object.rotation.y,
    });
  }

  function update(dt: number) {
    const speed = (keys.run ? RUN_SPEED : WALK_SPEED) * dt;

    if (controls.isLocked) {
      camera.getWorldDirection(forward);
      forward.y = 0; forward.normalize();
      right.crossVectors(forward, camera.up).normalize();

      move.set(0, 0, 0);
      if (keys.f) move.add(forward);
      if (keys.b) move.sub(forward);
      if (keys.r) move.add(right);
      if (keys.l) move.sub(right);
      if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);

      const cur = controls.object.position;
      const next = collider.resolve(cur, move);
      const floorY = currentFloor === '1F' ? FLOOR_Y_1F : FLOOR_Y_2F;
      next.y = floorY + EYE_HEIGHT;
      controls.object.position.copy(next);

      // URL に同期 (内部で 250ms throttle)
      writeNow();
    }
  }

  return { object: controls.object, update };
}
