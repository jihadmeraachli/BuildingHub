import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Deliberately NOT vite.config.ts. That one loads React, Tailwind and the PWA
 * plugin, none of which a pure-function test needs, and all of which make the
 * suite slow enough that people stop running it. This carries the one thing
 * the tests do need: the '@' alias.
 *
 * `environment: 'node'` for the same reason — there is no DOM in reportData.
 * A test that needs one should say so per file, not slow down every other test.
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
