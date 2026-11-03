import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The suite has enough independent files to saturate the CPU when Vitest
    // starts one worker per core. Keep assertion timers measuring the test's
    // work instead of time spent waiting behind unrelated imports.
    maxWorkers: 4,
    // Runs once per test file, before any import of the module under test, so the
    // app home is redirected before paths.ts resolves anything.
    setupFiles: ['./tests/setup-env.ts'],
  },
});
