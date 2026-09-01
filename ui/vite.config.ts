import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
