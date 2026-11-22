import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  antigravityAppHelpText,
  antigravityCliHelpText,
  antigravityIdeHelpText,
  claudeHelpText,
} from '../src/cli.js';
import { claudeAppHelpText } from '../src/claude-app.js';
import { codexHelpText } from '../src/codex.js';
import { codexAppHelpText, runCodexAppCommand } from '../src/codex-app.js';
import { geminiHelpText, runGeminiCommand } from '../src/gemini.js';
import { poolEndpointRevision } from '../src/pool/capabilities.js';
import * as geminiLaunch from '../src/gemini/launch.js';
import * as geminiProxy from '../src/gemini-proxy.js';

describe('--pool across all supported tools', () => {
  let home: string;
  let prevHome: string | undefined;
  let prevGroqKey: string | undefined;

  beforeEach(() => {
    prevHome = process.env.RELAY_AI_HOME;
    prevGroqKey = process.env.GROQ_API_KEY;
    home = mkdtempSync(join(tmpdir(), 'relay-pool-all-tools-'));
    process.env.RELAY_AI_HOME = home;
    process.env.GROQ_API_KEY = 'test-groq-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prevHome;
    if (prevGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = prevGroqKey;
    rmSync(home, { recursive: true, force: true });
  });

  it('documents --pool in every tool help text', () => {
    for (const text of [
      claudeHelpText(),
      claudeAppHelpText(),
      codexHelpText(),
      codexAppHelpText(),
      geminiHelpText(),
      antigravityCliHelpText(),
      antigravityAppHelpText(),
      antigravityIdeHelpText(),
    ]) {
      expect(text).toContain('--pool');
    }
  });

  function writePoolFixture(homeDir: string) {
    const providerId = 'groq';
    const modelId = 'free-model';
    const url = 'http://127.0.0.1:9/v1';
    const authRef = 'env:GROQ_API_KEY';
    const revision = poolEndpointRevision({
      providerId,
      authRef,
      npm: '@ai-sdk/openai-compatible',
      baseURL: url,
      upstreamModelId: modelId,
    });
    writeFileSync(join(homeDir, 'providers.json'), JSON.stringify({
      schemaVersion: 1,
      providers: [{
        id: providerId,
        templateId: 'groq',
        name: 'Free Prov',
        enabled: true,
        authType: 'api-key',
        authRef,
        api: { url, npm: '@ai-sdk/openai-compatible' },
        modelsCache: {
          fetchedAt: '2026-07-23T00:00:00Z',
          models: [{
            id: modelId,
            name: 'Free Model',
            upstreamModelId: modelId,
            modelFormat: 'openai',
            contextWindow: 128000,
            contextWindowSource: 'provider',
            cost: { input: 0, output: 0 },
          }],
        },
        addedAt: '2026-07-23T00:00:00Z',
      }],
    }));
    writeFileSync(join(homeDir, 'config.json'), JSON.stringify({
      freePool: {
        enabled: false,
        effort: 'auto',
        members: [{ providerId, modelId }],
        receipts: [{
          member: { providerId, modelId },
          endpointRevision: revision,
          verifiedAt: Date.now() - 1000,
          expiresAt: Date.now() + 60_000,
          targets: ['codex', 'claude', 'antigravity', 'core'],
          tools: true,
          maxOutputTokens: 4096,
          contextWindow: 128000,
          contextSource: 'provider',
          reasoningAccounting: 'inside-output',
          effortLevels: [],
          billingSafe: true,
        }],
      },
    }));
  }

  it('supports codex-app --pool --config even when additive pool is disabled', async () => {
    writePoolFixture(home);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const code = await runCodexAppCommand(['--config'], { pool: true });
    expect(code).toBe(0);
    expect(log.mock.calls.flat().join('\n')).toContain('Relay Free Pool');
  });

  it('supports gemini --pool and rejects unconfigured/unverified pools', async () => {
    vi.spyOn(geminiLaunch, 'findGeminiBinary').mockReturnValue('/usr/local/bin/gemini');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // No pool members
    expect(await runGeminiCommand([], false, { pool: true })).toBe(1);
    expect(error.mock.calls.flat().join('\n')).toContain('No free pool members');

    // Configured + verified member -> starts proxy with relay-free-pool route and launches gemini
    writePoolFixture(home);

    const close = vi.fn();
    const startProxySpy = vi.spyOn(geminiProxy, 'startGeminiProxy').mockResolvedValue({
      port: 43210,
      token: 'tok',
      close,
    });
    const launchSpy = vi.spyOn(geminiLaunch, 'launchGemini').mockResolvedValue(0);

    expect(await runGeminiCommand(['-p', 'hi'], false, { pool: true })).toBe(0);
    expect(startProxySpy).toHaveBeenCalledTimes(1);
    const routes = startProxySpy.mock.calls[0]![0];
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      aliasId: 'relay-free-pool',
      providerId: 'relay-free-pool',
      displayName: 'Relay Free Pool',
    });
    expect(launchSpy).toHaveBeenCalledWith(
      '/usr/local/bin/gemini',
      'relay-free-pool',
      expect.objectContaining({ GOOGLE_GEMINI_BASE_URL: 'http://127.0.0.1:43210' }),
      ['-p', 'hi'],
    );
    expect(close).toHaveBeenCalledTimes(1);
  });
});
