import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/provider-catalog.js', () => ({ resolveLocalProviderApiKey: vi.fn(async () => 'fake') }));
vi.mock('../src/provider-factory.js', async importOriginal => ({
  ...await importOriginal<object>(),
  createLanguageModel: vi.fn(async () => ({})),
}));
vi.mock('../src/provider-runtime.js', () => ({ providerRefreshToken: () => undefined }));
import { prepareClaudePoolRoutes } from '../src/pool/claude-prepare.js';
import { poolEndpointRevision, type PoolCapabilityReceipt } from '../src/pool/capabilities.js';
import { createLanguageModel } from '../src/provider-factory.js';
import type { PoolHealthStore } from '../src/pool/health.js';
import type { LocalProvider } from '../src/types.js';

const provider: LocalProvider = {
  id: 'account-2', name: 'Account 2', apiKey: '',
  models: [{
    id: 'm', name: 'm', family: '', brand: '', modelFormat: 'openai',
    upstreamModelId: 'm', npm: '@ai-sdk/openai-compatible',
    apiBaseUrl: 'http://127.0.0.1:12345/v1', cost: { input: 0, output: 0 },
  }],
};
const member = { providerId: provider.id, modelId: 'm' };
const receipt: PoolCapabilityReceipt = {
  member,
  endpointRevision: poolEndpointRevision({
    providerId: provider.id, npm: '@ai-sdk/openai-compatible',
    baseURL: provider.models[0].apiBaseUrl, upstreamModelId: 'm',
  }),
  verifiedAt: Date.now() - 1000, expiresAt: Date.now() + 60_000,
  targets: ['claude'], tools: true, maxOutputTokens: 8192,
  contextWindow: 128000, contextSource: 'provider',
  reasoningAccounting: 'inside-output', effortLevels: [], billingSafe: true,
};

describe('Claude pool route preparation', () => {
  it('creates the per-member model with the request conversation id', async () => {
    const routes = await prepareClaudePoolRoutes({
      pool: { members: [member], effort: 'auto', receipts: [] },
      providers: [provider],
      receipts: [receipt],
      body: { model: 'claude-pool', max_tokens: 64, messages: [{ role: 'user', content: 'hello' }] },
      signal: new AbortController().signal,
      sessionId: 'claude-conversation-1',
      health: { cooldownFor: async () => undefined, disabledFor: async () => undefined } as unknown as PoolHealthStore,
    });

    expect(routes).toHaveLength(1);
    expect(createLanguageModel).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'account-2',
      sessionId: 'claude-conversation-1',
      apiKey: 'fake',
    }));
  });

  it('keeps a member when the client asks for more output than the receipt reserved', async () => {
    // Claude Code sends max_tokens in the tens of thousands; this used to drop every member.
    const routes = await prepareClaudePoolRoutes({
      pool: { members: [member], effort: 'auto', receipts: [] },
      providers: [provider],
      receipts: [receipt],
      body: { model: 'claude-pool', max_tokens: 32000, messages: [{ role: 'user', content: 'hello' }] },
      signal: new AbortController().signal,
      health: { cooldownFor: async () => undefined, disabledFor: async () => undefined } as unknown as PoolHealthStore,
    });
    expect(routes).toHaveLength(1);
  });
});
