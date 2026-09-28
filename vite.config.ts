import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4000,
    modulePreload: false,
  },
  worker: {
    format: 'es',
  },
  server: {
    host: true,
    // A live 3D session does not survive hot reloads well; refresh manually instead.
    hmr: false,
  },
});
