import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config.ts';

// Same game, but three.js stays external so the published page can load it from a
// CDN through an import map instead of inlining the library.
export default mergeConfig(
  base,
  defineConfig({
    build: {
      outDir: 'dist-artifact',
      emptyOutDir: true,
      rollupOptions: {
        external: ['three', /^three\/examples\/jsm\//],
      },
    },
  }),
);
