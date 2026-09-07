import { defineConfig } from 'tsup';

// Embedded Core API build — separate dist/core output with type declarations.
// The CLI build (tsup.config.ts) already cleans dist and owns the shebang bundle.
export default defineConfig({
  entry: ['src/core/index.ts'],
  outDir: 'dist/core',
  format: ['esm'],
  target: 'node22',
  dts: true,
  clean: false,
  minify: false,
  sourcemap: true,
  external: [
    '@napi-rs/keyring',
    'ws',
    /^@ai-sdk\//,
    '@openrouter/ai-sdk-provider',
    'gitlab-ai-provider',
    'open',
  ],
});
