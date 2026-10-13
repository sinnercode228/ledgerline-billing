import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The core ships TypeScript sources; the dashboard compiles them with its own
// build instead of waiting for `tsc -b` to produce packages/core/dist.
const coreSource = fileURLToPath(new URL('../packages/core/src/index.ts', import.meta.url));

export default defineConfig({
  // GitHub Pages serves the site from /<repository>/.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  resolve: {
    alias: [{ find: /^@ledgerline\/core$/, replacement: coreSource }],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
});
