// スクショに「明るい連続領域の中の細い暗い水平帯」がないか検出する。
// アルゴリズム:
//   1. 画像中央の鉛直走査ライン (column) のピクセル輝度プロファイルを取得
//   2. 上下の周囲が明るく、現ピクセルだけ暗い帯を検出
//   3. 帯の幅 (px) と暗さ (周囲との差) が閾値超なら NG
//
// 使い方: node tools/check-dark-bands.mjs <dir>

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const dir = process.argv[2] || 'tools/out/views';
const files = readdirSync(dir).filter((f) => f.endsWith('.png'));

let totalNG = 0;

for (const f of files) {
  const png = PNG.sync.read(readFileSync(join(dir, f)));
  const w = png.width, h = png.height;

  // 走査列を画像中央 (建物の中心付近)
  const cols = [Math.floor(w * 0.35), Math.floor(w * 0.5), Math.floor(w * 0.65)];
  const allBands = [];
  for (const col of cols) {
    const lum = new Array(h);
    for (let y = 0; y < h; y++) {
      const i = (y * w + col) * 4;
      const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
      lum[y] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    const margin = 25;
    const maxBandH = 25;   // 30px以内の暗帯
    const lumDropThresh = 70;  // 周囲との差
    const surroundMin = 80;    // 周囲輝度の下限 (空・地面ノイズ除外)

    let inBand = false;
    let bandStart = -1;
    let bandSurround = 0;
    for (let y = margin; y < h - margin; y++) {
      const above = mean(lum, y - margin, y - 5);
      const below = mean(lum, y + 5, y + margin);
      const surround = (above + below) / 2;
      const drop = surround - lum[y];
      if (above >= surroundMin && below >= surroundMin && drop >= lumDropThresh) {
        if (!inBand) { inBand = true; bandStart = y; bandSurround = surround; }
      } else if (inBand) {
        const bandH = y - bandStart;
        if (bandH >= 3 && bandH <= maxBandH) {
          const bandLum = mean(lum, bandStart, y);
          allBands.push({ col, yStart: bandStart, yEnd: y, bandLum, surroundLum: bandSurround, gap: bandSurround - bandLum });
        }
        inBand = false;
      }
    }
  }

  if (allBands.length === 0) {
    console.log(`✓ ${f}`);
  } else {
    console.log(`✗ ${f} — ${allBands.length}本の暗い帯`);
    for (const b of allBands) {
      console.log(`    col=${b.col} y=${b.yStart}-${b.yEnd} (高さ${b.yEnd - b.yStart}px), 周囲=${b.surroundLum.toFixed(0)}, 帯=${b.bandLum.toFixed(0)}, gap=${b.gap.toFixed(0)}`);
    }
    totalNG++;
  }
}

console.log(`\n${files.length} files checked, ${totalNG} NG`);
process.exit(totalNG > 0 ? 1 : 0);

function mean(arr, a, b) {
  let s = 0, n = 0;
  for (let i = Math.max(0, a); i < Math.min(arr.length, b); i++) { s += arr[i]; n++; }
  return n > 0 ? s / n : 0;
}
