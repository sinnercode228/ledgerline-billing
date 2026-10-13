import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const core = (path: string) => fileURLToPath(new URL(`../packages/core/src/${path}`, import.meta.url));

export default defineConfig({
  resolve: {
    // Tests run against the core sources, so they never depend on a stale build.
    alias: [
      { find: /^@ledgerline\/core$/, replacement: core('index.ts') },
      { find: /^@ledgerline\/core\/testing$/, replacement: core('testing/index.ts') },
    ],
  },
  test: {
    name: 'server',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
