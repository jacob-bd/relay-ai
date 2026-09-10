import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Runs once per test file, before any import of the module under test, so the
    // app home is redirected before paths.ts resolves anything.
    setupFiles: ['./tests/setup-env.ts'],
  },
});
