import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as env from '../src/env.js';
import * as models from '../src/models.js';
import {
  resolveProvidersForDisplay,
  resolveZenGoAvailability,
} from '../src/provider-catalog.js';
import { emptyRegistry, saveRegistry } from '../src/registry/io.js';
import { zenRegistryStub } from '../src/registry/builtins.js';
import { BACKENDS } from '../src/constants.js';
import type { ModelInfo } from '../src/types.js';

function mockZenGoModels(zen: ModelInfo[], go: ModelInfo[] = []) {
  vi.spyOn(models, 'getModels').mockImplementation(async backend => ({
    models: backend.id === 'zen' ? zen : backend.id === 'go' ? go : [],
    fromCache: false,
  }));
}

describe('resolveProvidersForDisplay', () => {
  let home: string;
  const prevHome = process.env.RELAY_AI_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-ai-display-'));
    process.env.RELAY_AI_HOME = home;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('includes cloud Zen when API key exists but registry has no zen stub', async () => {
    const registry = emptyRegistry();
    registry.providers.push({
      id: 'groq',
      templateId: 'groq',
      name: 'Groq',
      enabled: true,
      authRef: 'keyring:provider:groq',
      api: { npm: '@ai-sdk/groq' },
      addedAt: new Date().toISOString(),
      modelsCache: { fetchedAt: new Date().toISOString(), models: [] },
    });
    saveRegistry(registry);

    vi.spyOn(env, 'readGlobalOpencodeCredential').mockResolvedValue('opencode-key');
    mockZenGoModels([
      { id: 'claude-sonnet', name: 'Sonnet', brand: 'Claude', modelFormat: 'anthropic', sourceBackend: 'zen', isFree: true, contextWindow: 200000 },
    ]);

    const entries = await resolveProvidersForDisplay();
    expect(entries.map(e => e.id)).toEqual(['zen', 'groq']);
    expect(entries[0]?.cloudBuiltin).toBe('zen');
    expect(entries[0]?.modelCount).toBe(1);
  });

  it('does not duplicate zen when registry already has zen stub', async () => {
    const registry = emptyRegistry();
    registry.providers.push(zenRegistryStub());
    saveRegistry(registry);

    vi.spyOn(env, 'readGlobalOpencodeCredential').mockResolvedValue('opencode-key');
    mockZenGoModels([
      { id: 'claude-sonnet', name: 'Sonnet', brand: 'Claude', modelFormat: 'anthropic', sourceBackend: 'zen', isFree: true, contextWindow: 200000 },
    ]);

    const entries = await resolveProvidersForDisplay();
    expect(entries.filter(e => e.id === 'zen')).toHaveLength(1);
    expect(entries.find(e => e.id === 'zen')?.inRegistry).toBe(true);
  });
});

describe('resolveZenGoAvailability', () => {
  let home: string;
  const prevHome = process.env.RELAY_AI_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-ai-zen-go-'));
    process.env.RELAY_AI_HOME = home;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('reports zen available when OpenCode key works even without registry stub', async () => {
    saveRegistry(emptyRegistry());
    vi.spyOn(env, 'readGlobalOpencodeCredential').mockResolvedValue('opencode-key');
    mockZenGoModels([
      { id: 'm1', name: 'M1', brand: 'Claude', modelFormat: 'anthropic', sourceBackend: 'zen', isFree: true, contextWindow: 1 },
    ]);

    expect(await resolveZenGoAvailability()).toEqual({ zen: true, go: false });
    expect(models.getModels).toHaveBeenCalledWith(BACKENDS.zen);
  });
});
