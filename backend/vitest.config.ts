import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // OCR and pipeline tests do real work on real image bytes.
    testTimeout: 30_000,
  },
});
