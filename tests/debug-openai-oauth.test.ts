import { describe, it } from 'vitest';
import { loadRegistry } from '../src/registry/io.js';
import { resolveProviderCredential, resolveProviderOAuthAccountId } from '../src/env.js';

function extractModels(data: unknown): any[] {
  if (!data || typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;
  if (Array.isArray(record.models)) return record.models;
  if (Array.isArray(record.data)) return record.data;
  if (record.models && typeof record.models === 'object') {
    return Object.entries(record.models as Record<string, unknown>).map(([slug, value]) => (
      value && typeof value === 'object'
        ? { slug, ...(value as Record<string, unknown>) }
        : { slug, value }
    ));
  }
  return [];
}

describe('OpenAI OAuth models probe', () => {
  it('runs live API tests against the ChatGPT Codex backend', async () => {
    const registry = loadRegistry();
    const provider = registry.providers.find(p => p.id === 'openai-oauth');
    if (!provider) {
      console.log('openai-oauth provider not found in registry');
      return;
    }

    const token = await resolveProviderCredential(provider.id, provider.authRef);
    if (!token) {
      console.log('Failed to resolve provider credential (no token)');
      return;
    }

    const accountId = await resolveProviderOAuthAccountId(provider.authRef);

    const headers = {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {})
    };

    const url = 'https://chatgpt.com/backend-api/codex/models?client_version=2.1.183';
    const res = await fetch(url, { headers });
    const data = await res.json();
    const models = extractModels(data);
    if (models.length === 0) {
      console.log(`No iterable models in live response (status ${res.status}). Keys: ${Object.keys((data && typeof data === 'object') ? data : {}).join(', ') || '(none)'}`);
      return;
    }

    console.log('PARSED MODELS:');
    for (const m of models) {
      console.log(`- Slug: ${m.slug}`);
      console.log(`  Display Name: ${m.display_name}`);
      console.log(`  Context Window: ${m.context_window}`);
      console.log(`  Supports Reasoning Levels: ${!!m.supported_reasoning_levels}`);
      if (m.supported_reasoning_levels) {
        console.log(`    Levels: ${JSON.stringify(m.supported_reasoning_levels.map((l: any) => l.effort))}`);
      }
    }
  });
});
