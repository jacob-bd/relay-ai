import { describe, expect, it } from 'vitest';
import type { CodexProxyRoute } from '../src/codex-proxy.js';
import {
  classifyCodexDispatch,
  createMixedProxyCapability,
  mixedProxyBaseUrl,
  parseMixedProxyPath,
} from '../src/codex/routing.js';

const relay: CodexProxyRoute = {
  modelId: 'kilo__kilo-auto/free',
  npm: '@ai-sdk/openai-compatible',
  apiKey: 'relay-secret',
  upstreamModelId: 'kilo-auto/free',
  providerId: 'kilo',
};

describe('mixed Codex routing', () => {
  it('prioritizes exact native ids and never falls back to a Relay route', () => {
    const native = new Set(['gpt-5.5']);
    expect(classifyCodexDispatch('gpt-5.5', [relay], native)).toEqual({ kind: 'native', modelId: 'gpt-5.5' });
    expect(classifyCodexDispatch('kilo__kilo-auto/free', [relay], native)).toEqual({ kind: 'relay', route: relay });
    expect(classifyCodexDispatch('gpt-5.6-sol', [relay], native)).toEqual({ kind: 'unknown', modelId: 'gpt-5.6-sol' });
    expect(classifyCodexDispatch('kilo-auto/free', [relay], native)).toEqual({ kind: 'unknown', modelId: 'kilo-auto/free' });
  });

  it('creates and validates a capability path', () => {
    const capability = createMixedProxyCapability();
    expect(capability).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const base = mixedProxyBaseUrl(43210, capability);
    expect(parseMixedProxyPath(new URL(`${base}/v1/responses`).pathname, capability)).toEqual({
      capability,
      suffix: '/v1/responses',
    });
    expect(parseMixedProxyPath('/_relay-codex/wrong/v1/responses', capability)).toBeNull();
  });
});
