# voido 3D 見取り図 (WebGL)

千葉県南房総のログハウス合宿施設 [voido](https://voido.space/) の 3D 見取り図ビューワー。
[home.kuniwak.com](https://home.kuniwak.com/) に着想を得た、Three.js + Vite (TypeScript) によるFPS視点の建物ウォークスルー。

## セットアップ

```bash
npm install
npm run dev      # http://localhost:5173/
npm run build    # 本番ビルド (dist/)
npm run preview  # ビルド成果物のプレビュー
```

## 操作

- 画面クリック: マウスロック開始
- `WASD` / 矢印キー: 移動
- `Shift`: ダッシュ
- マウス: 視点回転
- `ESC`: マウスロック解除

## 構成

- `index.html` — エントリ。HUD とオーバーレイ。
- `src/main.ts` — レンダラ初期化と毎フレームループ。
- `src/scene.ts` — カメラ、ライト、地面、フォグ。
- `src/building.ts` — voido 1F/2F 間取りを `BoxGeometry` で構築。
- `src/controls.ts` — `PointerLockControls` + WASD。
- `src/collision.ts` — 壁の AABB 衝突判定（軸別解決で壁沿い滑り）。

間取りは voido 公式 FACILITY ページからの推定。寸法（1unit = 1m）は実測に応じて
`src/building.ts` 冒頭の定数（`SIZE_X`, `SIZE_Z`, `F1_H`, `F2_H` など）と各家具の
位置を編集してください。
