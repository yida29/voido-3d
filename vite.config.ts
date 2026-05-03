import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// GitHub Pages: https://<user>.github.io/voido-3d/
// 本番ビルド時は base を /voido-3d/ にしないと assets が 404 になる。
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/voido-3d/' : '/',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        roundtrip: resolve(__dirname, 'roundtrip.html'),
      },
    },
  },
});
