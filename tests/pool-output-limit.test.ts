import { describe, expect, it } from 'vitest';
import { modelsDevCrossVendorOutputLimit } from '../src/registry/models-dev.js';
import { POOL_DEFAULT_OUTPUT_TOKENS, poolOutputCap } from '../src/pool/output-limit.js';

describe('pool output cap', () => {
  it('uses a coding-sized default for unknown models, never a chat-sized one', () => {
    expect(poolOutputCap('no-such-provider', 'no-such-model', 1_000_000)).toBe(POOL_DEFAULT_OUTPUT_TOKENS);
    expect(POOL_DEFAULT_OUTPUT_TOKENS).toBeGreaterThanOrEqual(16_384);
  });

  it('never reserves more than a quarter of a small window, and keeps a floor', () => {
    expect(poolOutputCap('x', 'y', 64_000)).toBe(16_000);
    expect(poolOutputCap('x', 'y', 2_000)).toBe(1_024);
  });
});

describe('vendor fallback', () => {
  it('uses the model vendor limit when the provider has no models.dev entry', () => {
    // gpt-4.1 has no entry under the github-copilot slug; OpenAI lists it.
    const vendor = modelsDevCrossVendorOutputLimit('gpt-4.1');
    expect(vendor).toBeDefined();
    expect(poolOutputCap('github-copilot', 'gpt-4.1', 4_000_000)).toBe(vendor);
  });
});
