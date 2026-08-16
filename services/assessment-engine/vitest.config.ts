import { defineConfig } from 'vitest/config';

// Default suite: fast, hermetic unit + property tests. No browser, no network.
// Integration tests (which launch Chromium) are excluded here and run via the
// `test:integration` script / vitest.integration.config.ts.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.integration.test.ts'],
  },
});
