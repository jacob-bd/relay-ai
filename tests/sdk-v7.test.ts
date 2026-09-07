// Issue #71: Relay and Alef must share one AI SDK generation (v7 / spec v4).
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
  engines: { node: string };
};

describe('AI SDK v7 (issue #71)', () => {
  it('declares ai ^7 and Node 22+', () => {
    expect(pkg.dependencies.ai).toMatch(/^\^7/);
    expect(pkg.engines.node).toMatch(/22/);
  });

  it('resolves the ai package to 7.x, not a nested 6.x tree', () => {
    const aiPkg = require('ai/package.json') as { version: string };
    expect(aiPkg.version).toMatch(/^7\./);
  });

  it('does not ship the v6-era Venice SDK package', () => {
    expect(pkg.dependencies['venice-ai-sdk-provider']).toBeUndefined();
  });

  it('first-party providers emit specificationVersion v4', async () => {
    const { createOpenAI } = await import('@ai-sdk/openai');
    const model = createOpenAI({ apiKey: 'sk-test' })('gpt-4o');
    expect(model.specificationVersion).toBe('v4');
  });
});
