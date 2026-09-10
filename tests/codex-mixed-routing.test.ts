import { describe, expect, it } from 'vitest';
import type { CodexProxyRoute } from '../src/codex-proxy.js';
import {
  classifyCodexDispatch,
  classifyCodexMixedDispatch,
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

  it('routes a marked Sub-agent to the configured Relay Sub-agent, whatever model it asks for', () => {
    const native = new Set(['gpt-5.5']);
    expect(classifyCodexMixedDispatch({
      modelId: 'gpt-5.5', markedSubagent: true, subagentRoute: relay, relayRoutes: [relay], nativeModelIds: native,
    })).toEqual({ kind: 'relay', route: relay });
  });

  it('falls through to native for a marked Sub-agent when no Relay Sub-agent is configured', () => {
    const native = new Set(['gpt-5.5']);
    expect(classifyCodexMixedDispatch({
      modelId: 'gpt-5.5', markedSubagent: true, relayRoutes: [relay], nativeModelIds: native,
    })).toEqual({ kind: 'native', modelId: 'gpt-5.5' });
  });

  it('sends a Codex-internal Sub-agent alias native instead of rejecting it (issue #72)', () => {
    const native = new Set(['gpt-5.5']);
    expect(classifyCodexMixedDispatch({
      modelId: 'codex-auto-review', markedSubagent: true, relayRoutes: [relay], nativeModelIds: native,
    })).toEqual({ kind: 'native', modelId: 'codex-auto-review' });
  });

  it('still honours an explicit Relay model id from an unconfigured Sub-agent', () => {
    const native = new Set(['gpt-5.5']);
    expect(classifyCodexMixedDispatch({
      modelId: 'kilo__kilo-auto/free', markedSubagent: true, relayRoutes: [relay], nativeModelIds: native,
    })).toEqual({ kind: 'relay', route: relay });
  });

  it('keeps rejecting an unknown model on a normal request', () => {
    const native = new Set(['gpt-5.5']);
    expect(classifyCodexMixedDispatch({
      modelId: 'gpt-5.6-sol', markedSubagent: false, relayRoutes: [relay], nativeModelIds: native,
    })).toEqual({ kind: 'unknown', modelId: 'gpt-5.6-sol' });
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
