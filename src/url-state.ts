/**
 * カメラ位置と向きを URL パラメータと同期する。
 *
 * 形式 (kuniwakさんのサイトと互換):
 *   ?posX=...&posY=...&posZ=...&rotX=...&rotY=...
 *
 * - 素の URLSearchParams + History API。React/Next依存なし。
 * - 書き込みは throttle 付きで rAF と相性が良いように。
 * - history.replaceState を使うので戻る/進むが汚れない。
 */

export interface CameraState {
  posX: number;
  posY: number;
  posZ: number;
  rotX: number; // pitch (rad)
  rotY: number; // yaw   (rad)
}

const KEYS: (keyof CameraState)[] = ['posX', 'posY', 'posZ', 'rotX', 'rotY'];

export function readState(): Partial<CameraState> {
  const params = new URLSearchParams(window.location.search);
  const out: Partial<CameraState> = {};
  for (const k of KEYS) {
    const v = params.get(k);
    if (v != null && v !== '') {
      const n = parseFloat(v);
      if (Number.isFinite(n)) out[k] = n;
    }
  }
  return out;
}

let pending: CameraState | null = null;
let scheduled = false;

export function writeState(s: CameraState) {
  pending = s;
  if (scheduled) return;
  scheduled = true;
  // 250ms 間隔でまとめて書き込む。常時フレーム書き込みすると history が汚れる
  setTimeout(flush, 250);
}

function flush() {
  scheduled = false;
  if (!pending) return;
  const s = pending; pending = null;
  const params = new URLSearchParams(window.location.search);
  params.set('posX', s.posX.toFixed(3));
  params.set('posY', s.posY.toFixed(3));
  params.set('posZ', s.posZ.toFixed(3));
  params.set('rotX', s.rotX.toFixed(3));
  params.set('rotY', s.rotY.toFixed(3));
  const url = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
  window.history.replaceState(null, '', url);
}
