import { defineConfig } from 'vitest/config';

// Pure-logic unit tests run in Node (no DOM needed). Component tests, if added
// later, can opt into jsdom per-file via `// @vitest-environment jsdom`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
