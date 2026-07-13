import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  minify: false,
  sourcemap: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: [
    '@napi-rs/keyring',
    'ws',
    /^@ai-sdk\//,
    '@openrouter/ai-sdk-provider',
    'gitlab-ai-provider',
    'open',
  ],
});
