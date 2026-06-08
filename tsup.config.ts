import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node18',
  clean: true,
  minify: false,
  sourcemap: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: [
    '@napi-rs/keyring',
    /^@ai-sdk\//,
    '@openrouter/ai-sdk-provider',
    'gitlab-ai-provider',
    'venice-ai-sdk-provider',
  ],
});
