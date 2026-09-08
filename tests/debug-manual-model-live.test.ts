import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRegistry, saveRegistry } from '../src/registry/io.js';
import { resolveProviderCredential, resolveProviderOAuthAccountId } from '../src/env.js';
import { addManualModel, removeManualModel } from '../src/registry/manual-models.js';
import { getProviderModels } from '../src/registry/provider-models.js';
import { listRelayModels, createRelayModel } from '../src/core/index.js';
import { startProxy } from '../src/proxy.js';

// Opt in explicitly: sends small paid/usage-counted requests. Never changes the real registry.
describe.skipIf(!process.env.RELAY_AI_LIVE_MODEL)('live release verification', () => {
  it('adds an unlisted DeepSeek model with the real validator and exposes it to Core', async () => {
    const original = loadRegistry(undefined, { persist: false });
    const p = original.providers.find(p => p.id === 'deepseek');
    expect(p).toBeDefined();
    const key = await resolveProviderCredential(p!.id, p!.authRef);
    expect(Boolean(key)).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), 'relay-manual-live-'));
    vi.stubEnv('RELAY_AI_HOME', dir);
    vi.stubEnv('RELAY_AI_MANUAL_TEST_KEY', key!);
    try {
      saveRegistry({ schemaVersion: 1, providers: [{ ...p!, authRef: 'env:RELAY_AI_MANUAL_TEST_KEY', modelsCache: undefined, manualModels: undefined }] });
      const result = await addManualModel({ providerId: 'deepseek', modelId: process.env.RELAY_AI_LIVE_MODEL!, displayName: 'DeepSeek beta validation' });
      expect(result, result.error).toMatchObject({ ok: true, model: { source: 'manual' } });
      expect(getProviderModels(loadRegistry().providers[0])).toHaveLength(1);
      expect(listRelayModels()[0].modelId).toBe(process.env.RELAY_AI_LIVE_MODEL);
      const runtime = await createRelayModel(`deepseek::${process.env.RELAY_AI_LIVE_MODEL}`);
      expect(runtime).toBeDefined();
      expect(removeManualModel('deepseek', process.env.RELAY_AI_LIVE_MODEL!).ok).toBe(true);
      expect(listRelayModels()).toHaveLength(0);
    } finally { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); }
  }, 110_000);

  it('serves Astra through the fixed non-streaming Claude proxy', async () => {
    const p = loadRegistry(undefined, { persist: false }).providers.find(p => p.id === 'openai-oauth');
    expect(p).toBeDefined();
    const m = p!.modelsCache?.models.find(m => m.id === 'gpt-6-astra');
    expect(m).toBeDefined();
    const key = await resolveProviderCredential(p!.id, p!.authRef);
    const account = await resolveProviderOAuthAccountId(p!.authRef);
    const proxy = await startProxy('', m!.id, false, undefined, { npm: '@ai-sdk/openai', authType: 'oauth',
      providerId: p!.id, oauthAccountId: account ?? undefined, useResponsesLite: m!.useResponsesLite, preferWebSockets: m!.preferWebSockets }, key!);
    try {
      const response = await fetch(`http://127.0.0.1:${proxy.port}/v1/messages`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': proxy.token! }, signal: AbortSignal.timeout(45000),
        body: JSON.stringify({ model: m!.id, stream: false, max_tokens: 64, output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'Reply with exactly ASTRA_OK.' }] }),
      });
      const body = await response.json() as any;
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.content).toContainEqual({ type: 'text', text: 'ASTRA_OK' });
    } finally { proxy.close(); }
  }, 55_000);
});
