import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleUiApiRequest } from '../src/ui/api.js';
import { loadPreferences } from '../src/config.js';
import * as env from '../src/env.js';
import { createMockRequest, createMockResponse } from './helpers/ui-api-test-utils.js';

describe('Codex Sub-agents UI config contract', () => {
  let tempHome: string;
  let previousRelayHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'relay-ai-ui-config-'));
    previousRelayHome = process.env['RELAY_AI_HOME'];
    process.env['RELAY_AI_HOME'] = join(tempHome, 'relay-home');
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    if (previousRelayHome === undefined) delete process.env['RELAY_AI_HOME'];
    else process.env['RELAY_AI_HOME'] = previousRelayHome;
  });

  it('returns an empty Codex Sub-agents list without importing General Favorites', async () => {
    const response = createMockResponse();
    handleUiApiRequest(createMockRequest('GET', '/api/config'), response.res);
    expect(JSON.parse(response.result.data)).toMatchObject({
      favoriteModels: [],
      codexSubagentModels: [],
    });
  });

  it('persists Codex Sub-agents without touching General Favorites', async () => {
    const body = JSON.stringify({
      favoriteModels: [{ providerId: 'general', modelId: 'keep-me' }],
      codexSubagentModels: [{ providerId: 'kilo', modelId: 'kilo-auto/free' }],
    });
    const response = createMockResponse();
    handleUiApiRequest(createMockRequest('POST', '/api/config', body), response.res);
    await vi.waitFor(() => expect(response.result.data).not.toBe(''));
    expect(response.result.code).toBe(200);
    expect(loadPreferences()).toMatchObject({
      favoriteModels: [{ providerId: 'general', modelId: 'keep-me' }],
      codexSubagentModels: [{ providerId: 'kilo', modelId: 'kilo-auto/free' }],
    });
  });

  it('rejects more than one Codex Sub-agent model', async () => {
    const codexSubagentModels = [
      { providerId: 'deepseek', modelId: 'deepseek-v4-flash' },
      { providerId: 'google', modelId: 'gemini-3.5-flash' },
    ];
    const response = createMockResponse();
    handleUiApiRequest(createMockRequest('POST', '/api/config', JSON.stringify({ codexSubagentModels })), response.res);
    await vi.waitFor(() => expect(response.result.data).not.toBe(''));
    expect(response.result.code).toBe(400);
    expect(JSON.parse(response.result.data).error).toContain('limited to 1 model');
  });

  it('requires confirmation before replacing a stored OpenCode Go/Zen key', async () => {
    const readStored = vi.spyOn(env, 'readStoredProviderCredential').mockResolvedValue('old-key');
    const save = vi.spyOn(env, 'saveProviderCredential').mockResolvedValue(true);

    const response = createMockResponse();
    handleUiApiRequest(createMockRequest('POST', '/api/keys', JSON.stringify({
      providerId: 'go',
      key: 'new-key',
    })), response.res);
    await vi.waitFor(() => expect(response.result.data).not.toBe(''));

    expect(response.result.code).toBe(409);
    expect(JSON.parse(response.result.data)).toMatchObject({ ok: false, needsConfirmation: true });
    expect(save).not.toHaveBeenCalled();
    expect(readStored).toHaveBeenCalledWith('keyring:provider:opencode');
  });

  it('saves a confirmed OpenCode Go/Zen key in the shared Relay override slot', async () => {
    vi.spyOn(env, 'readStoredProviderCredential').mockResolvedValue('old-key');
    const save = vi.spyOn(env, 'saveProviderCredential').mockResolvedValue(true);

    const response = createMockResponse();
    handleUiApiRequest(createMockRequest('POST', '/api/keys', JSON.stringify({
      providerId: 'zen',
      key: 'new-key',
      confirmOverwrite: true,
    })), response.res);
    await vi.waitFor(() => expect(response.result.data).not.toBe(''));

    expect(response.result.code).toBe(200);
    expect(save).toHaveBeenCalledWith('keyring:provider:opencode', 'new-key');
  });
});
