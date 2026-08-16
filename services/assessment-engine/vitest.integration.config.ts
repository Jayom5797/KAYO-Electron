import { defineConfig } from 'vitest/config';

// Integration suite: launches real headless Chromium against a local fixture
// server. Slower and requires `npx playwright install chromium`. Runs serially
// so multiple browser launches don't contend for resources.
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
