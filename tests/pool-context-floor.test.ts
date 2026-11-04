import { describe, expect, it } from 'vitest';
import { poolMembershipProblem } from '../src/pool/verify.js';
import type { LocalProvider, LocalProviderModel } from '../src/types.js';

const provider = { id: 'p', name: 'P', apiKey: '', models: [] } as LocalProvider;
const model = (contextWindow?: number): LocalProviderModel => ({
  id: 'm', name: 'm', family: '', brand: '', modelFormat: 'openai', upstreamModelId: 'm',
  npm: '@ai-sdk/openai-compatible', cost: { input: 0, output: 0 }, ...(contextWindow === undefined ? {} : { contextWindow }),
}) as LocalProviderModel;

describe('pool context floor', () => {
  it('rejects windows below the Claude Code/Codex minimum, accepts the floor and unknown sizes', () => {
    expect(poolMembershipProblem(provider, model(66_000))).toMatch(/below 128K/);
    expect(poolMembershipProblem(provider, model(127_999))).toMatch(/below 128K/);
    expect(poolMembershipProblem(provider, model(128_000))).toBeUndefined();
    expect(poolMembershipProblem(provider, model(undefined))).toBeUndefined();
  });
});
