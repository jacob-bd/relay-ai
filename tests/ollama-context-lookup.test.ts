import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveRegistry } from '../src/registry/io.js';
import * as env from '../src/env.js';
import { ollamaContextLimit } from '../src/test-model.js';

describe('Ollama context size lookup', () => {
  let home: string; let previous: string | undefined;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-ai-ollama-ctx-'));
    previous = process.env['RELAY_AI_HOME'];
    process.env['RELAY_AI_HOME'] = join(home, 'h');
    vi.spyOn(env, 'resolveProviderCredential').mockResolvedValue('ollama');
    const entry = (id: string, templateId: string) => ({
      id, templateId, name: id, enabled: true, api: { npm: '@ai-sdk/openai-compatible', url: 'http://10.0.0.5:11434/v1' },
      authRef: `keyring:provider:${id}`, addedAt: '2026-11-03T00:00:00Z',
      modelsCache: { fetchedAt: '2026-11-03T00:00:00Z', models: [{ id: 'm:cloud', name: 'm', upstreamModelId: 'm:cloud', modelFormat: 'openai' }] },
    });
    saveRegistry({ schemaVersion: 1, providers: [entry('ollama', 'ollama'), entry('groq', 'groq')] } as never);
  });
  afterEach(() => {
    vi.restoreAllMocks(); vi.unstubAllGlobals(); rmSync(home, { recursive: true, force: true });
    if (previous === undefined) delete process.env['RELAY_AI_HOME']; else process.env['RELAY_AI_HOME'] = previous;
  });

  it('reads <arch>.context_length from /api/show on the configured server', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ model_info: { 'general.x': 1, 'gemma4.context_length': 131072 } }) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await ollamaContextLimit('ollama', 'm:cloud', AbortSignal.timeout(1000))).toBe(131072);
    expect(fetchMock.mock.calls[0]![0]).toBe('http://10.0.0.5:11434/api/show');
  });

  it('says nothing for other providers or when the server has no answer', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetchMock);
    expect(await ollamaContextLimit('groq', 'm:cloud', AbortSignal.timeout(1000))).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await ollamaContextLimit('ollama', 'm:cloud', AbortSignal.timeout(1000))).toBeUndefined();
  });
});
