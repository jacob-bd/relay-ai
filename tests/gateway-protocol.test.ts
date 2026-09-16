import { describe, expect, it } from 'vitest';
import {
  classifyProtocolFailure,
  clearRememberedProtocols,
  isDualProtocolGateway,
  protocolCacheKey,
  protocolCooldownActive,
  rememberProtocol,
  rememberProtocolFailure,
  rememberedProtocol,
  resolveProtocolAlternative,
} from '../src/gateway-protocol.js';

describe('dual-protocol gateway detection', () => {
  it.each([
    ['zen', 'https://opencode.ai/zen/v1'],
    ['go', 'https://opencode.ai/zen/go/v1'],
    ['openrouter', 'https://openrouter.ai/api/v1'],
    ['commandcode', 'https://api.commandcode.ai/provider/v1'],
  ])('recognizes %s', (providerId, baseURL) => {
    expect(isDualProtocolGateway(providerId, baseURL)).toBe(true);
  });

  it('does not guess dual support for an unrelated custom endpoint', () => {
    expect(isDualProtocolGateway('custom-openai', 'https://api.example.com/v1')).toBe(false);
  });
});

describe('resolveProtocolAlternative', () => {
  it('maps an OpenCode Go chat route to its Messages sibling', () => {
    expect(resolveProtocolAlternative({
      providerId: 'go',
      modelFormat: 'openai',
      npm: '@ai-sdk/openai-compatible',
      baseURL: 'https://opencode.ai/zen/go/v1',
    })).toMatchObject({
      modelFormat: 'anthropic',
      npm: '@ai-sdk/anthropic',
      baseURL: 'https://opencode.ai/zen/go',
      upstreamUrl: 'https://opencode.ai/zen/go/v1/messages',
    });
  });

  it('maps an OpenRouter Messages route to its chat sibling', () => {
    expect(resolveProtocolAlternative({
      providerId: 'openrouter',
      modelFormat: 'anthropic',
      npm: '@ai-sdk/anthropic',
      baseURL: 'https://openrouter.ai/api',
    })).toMatchObject({
      modelFormat: 'openai',
      npm: '@openrouter/ai-sdk-provider',
      baseURL: 'https://openrouter.ai/api/v1',
      upstreamUrl: 'https://openrouter.ai/api/v1/chat/completions',
    });
  });

  it('does not create an alternative for a single-protocol provider', () => {
    expect(resolveProtocolAlternative({
      providerId: 'anthropic',
      modelFormat: 'anthropic',
      npm: '@ai-sdk/anthropic',
      baseURL: 'https://api.anthropic.com',
    })).toBeNull();
  });
});

describe('classifyProtocolFailure', () => {
  it('allows a retry for a generic early 500', () => {
    expect(classifyProtocolFailure({
      statusCode: 500,
      responseBody: '{"error":{"message":"Internal server error"}}',
    })).toMatchObject({ retryable: true, status: 500 });
  });

  it('allows a retry for an explicit wrong-endpoint response', () => {
    expect(classifyProtocolFailure({
      statusCode: 405,
      message: 'Method not allowed on /chat/completions; use /messages',
    })).toMatchObject({ retryable: true, status: 405 });
  });

  it.each([
    [401, 'invalid api key'],
    [403, 'MODEL_NOT_IN_PLAN'],
    [429, 'rate limit exceeded'],
  ])('does not retry status %s', (status, message) => {
    expect(classifyProtocolFailure({ statusCode: status, message })).toMatchObject({ retryable: false, status });
  });

  it('does not reinterpret a context error as a protocol error', () => {
    expect(classifyProtocolFailure({
      statusCode: 500,
      message: 'context length exceeded for this request',
    })).toMatchObject({ retryable: false, status: 500 });
  });
});

describe('learned protocol cache', () => {
  it('expires successful choices and suppresses retries after two failures', () => {
    clearRememberedProtocols();
    const key = protocolCacheKey({ providerId: 'go', modelId: 'union-alpha', baseURL: 'https://opencode.ai/zen/go/v1' });
    const now = 1_000_000;
    rememberProtocol(key, 'anthropic', now);
    expect(rememberedProtocol(key, now + 1)).toBe('anthropic');
    expect(rememberedProtocol(key, now + 24 * 60 * 60 * 1000 + 1)).toBeUndefined();
    rememberProtocolFailure(key, now);
    expect(protocolCooldownActive(key, now + 1)).toBe(true);
    expect(protocolCooldownActive(key, now + 5 * 60 * 1000 + 1)).toBe(false);
    clearRememberedProtocols();
  });
});
