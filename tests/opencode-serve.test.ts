import { describe, expect, it } from 'vitest';
import * as opencodeServe from '../src/opencode-serve.js';

describe('parseOpencodeServerBanner', () => {
  it('recognizes both OpenCode v1 and v2 server banners', () => {
    expect(typeof (opencodeServe as Record<string, unknown>)['parseOpencodeServerBanner']).toBe('function');
    const parse = (opencodeServe as unknown as {
      parseOpencodeServerBanner(output: string): { generation: 'v1' | 'v2'; url: string } | null;
    }).parseOpencodeServerBanner;

    expect(parse('opencode server listening on http://127.0.0.1:4096\n')).toEqual({
      generation: 'v1',
      url: 'http://127.0.0.1:4096',
    });
    expect(parse('server listening on http://127.0.0.1:51954\n')).toEqual({
      generation: 'v2',
      url: 'http://127.0.0.1:51954',
    });
  });
});

describe('normalizeV2Providers', () => {
  it('converts connected v2 integrations and models into the existing import shape', () => {
    expect(typeof (opencodeServe as Record<string, unknown>)['normalizeV2Providers']).toBe('function');
    const normalize = (opencodeServe as unknown as {
      normalizeV2Providers(
        models: unknown[],
        integrations: unknown[],
        providers: unknown[],
        env?: NodeJS.ProcessEnv,
      ): Array<Record<string, unknown>>;
    }).normalizeV2Providers;

    const providers = normalize([
      {
        id: 'qwen/qwen3-coder',
        modelID: 'qwen/qwen3-coder-upstream',
        providerID: 'nvidia',
        name: 'Qwen 3 Coder',
        family: 'qwen',
        capabilities: { tools: true, input: ['text'], output: ['text'] },
        variants: [],
        time: { released: 1_789_430_400_000 },
        cost: [{ input: 0.1, output: 0.2, cache: { read: 0.01, write: 0.02 } }],
        status: 'active',
        enabled: true,
        limit: { context: 262_144, output: 65_536 },
      },
      {
        id: 'gemini-3-flash',
        modelID: 'gemini-3-flash',
        providerID: 'google',
        name: 'Gemini 3 Flash',
        package: '@opencode/ai/providers/google',
        capabilities: { tools: true, input: ['text', 'image'], output: ['text'] },
        variants: [{ id: 'high', settings: {} }],
        time: { released: 1_766_016_000_000 },
        cost: [],
        status: 'active',
        enabled: true,
        limit: { context: 1_048_576, output: 65_536 },
      },
      {
        id: 'disabled-model',
        modelID: 'disabled-model',
        providerID: 'nvidia',
        name: 'Disabled model',
        capabilities: { tools: true, input: ['text'], output: ['text'] },
        variants: [],
        time: { released: 0 },
        cost: [],
        status: 'deprecated',
        enabled: false,
        limit: { context: 128_000, output: 8_192 },
      },
      {
        id: 'unconnected-model',
        modelID: 'unconnected-model',
        providerID: 'unconnected',
        name: 'Unconnected model',
        capabilities: { tools: true, input: ['text'], output: ['text'] },
        variants: [],
        time: { released: 0 },
        cost: [],
        status: 'active',
        enabled: true,
        limit: { context: 128_000, output: 8_192 },
      },
    ], [
      {
        id: 'nvidia',
        name: 'Nvidia',
        methods: [{ type: 'key' }],
        connections: [{ type: 'credential', id: 'cred_nvidia', label: 'API key' }],
      },
      {
        id: 'google',
        name: 'Google',
        methods: [{ type: 'env', names: ['GEMINI_API_KEY'] }],
        connections: [{ type: 'env', name: 'GEMINI_API_KEY' }],
      },
      {
        id: 'unconnected',
        name: 'Unconnected',
        methods: [{ type: 'key' }],
        connections: [],
      },
    ], [
      {
        id: 'nvidia',
        integrationID: 'nvidia',
        name: 'Nvidia',
        activation: 'auto',
        package: '@opencode/ai/providers/openai-compatible',
        settings: { baseURL: 'https://integrate.api.nvidia.com/v1' },
      },
      {
        id: 'google',
        integrationID: 'google',
        name: 'Google',
        activation: 'auto',
        package: '@opencode/ai/providers/google',
      },
    ], {
      GEMINI_API_KEY: 'gemini-key-from-env',
    });

    expect(providers).toEqual([
      {
        id: 'nvidia',
        name: 'Nvidia',
        key: undefined,
        configured: true,
        models: {
          'qwen/qwen3-coder': {
            id: 'qwen/qwen3-coder',
            name: 'Qwen 3 Coder',
            family: 'qwen',
            api: {
              id: 'qwen/qwen3-coder-upstream',
              npm: '@ai-sdk/openai-compatible',
              url: 'https://integrate.api.nvidia.com/v1',
            },
            cost: { input: 0.1, output: 0.2, cache_read: 0.01, cache_write: 0.02 },
            limit: { context: 262_144, output: 65_536 },
          },
        },
      },
      {
        id: 'google',
        name: 'Google',
        key: 'gemini-key-from-env',
        configured: true,
        models: {
          'gemini-3-flash': {
            id: 'gemini-3-flash',
            name: 'Gemini 3 Flash',
            family: undefined,
            api: {
              id: 'gemini-3-flash',
              npm: '@ai-sdk/google',
              url: undefined,
            },
            cost: undefined,
            limit: { context: 1_048_576, output: 65_536 },
          },
        },
      },
    ]);
  });
});
