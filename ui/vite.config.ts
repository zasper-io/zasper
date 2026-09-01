import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Mirrored by `paths` in tsconfig.json. Anything reaching outside its own
      // feature folder should use this rather than counting ../ hops.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        // Bootstrap 5.3 still uses @import and legacy colour functions
        // internally. We can't fix that from here, so don't let it drown out
        // warnings from our own SCSS.
        quietDeps: true,
        silenceDeprecations: ['import', 'global-builtin', 'color-functions'],
      },
    },
  },
  server: {
    // `make dev` serves the frontend here while the Go backend runs on 8048.
    port: 3000,
  },
  build: {
    // The Go binary embeds ui/build (see spa.go), so keep the CRA output path.
    outDir: 'build',
    emptyOutDir: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.js',
  },
});
