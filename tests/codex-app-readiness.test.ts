import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyAppConfigPatch } from '../src/codex/app-config.js';
import { verifyCodexAppReadiness } from '../src/codex/app-readiness.js';
import type { CodexAppConfigSpec } from '../src/codex/app-profile.js';

describe('Codex App startup readiness regression protections', () => {
  let home: string;
  let configPath: string;
  let catalogPath: string;
  let spec: CodexAppConfigSpec;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-app-ready-'));
    configPath = join(home, '.codex', 'config.toml');
    catalogPath = join(home, '.relay-ai', 'codex', 'app-models-mixed.json');
    mkdirSync(join(home, '.codex'), { recursive: true });
    mkdirSync(join(home, '.relay-ai', 'codex'), { recursive: true });
    writeFileSync(configPath, 'model = "gpt-native"\n', 'utf8');
    writeFileSync(catalogPath, JSON.stringify({ models: [{ slug: 'antigravity__gemini-pro' }, { slug: 'gpt-native' }] }), 'utf8');
    spec = {
      route: {
        tier: 'proxy', npm: '', apiKey: '', upstreamModelId: '',
        modelId: 'antigravity__gemini-pro', providerId: 'antigravity',
      },
      proxyPort: 43210,
      proxyBaseUrl: 'http://127.0.0.1:43210/_relay-codex/capability/v1',
      catalogPath,
    };
    applyAppConfigPatch(spec, configPath);
  });

  afterEach(() => rmSync(home, { recursive: true, force: true }));

  function readyFetch(): typeof fetch {
    return vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/health')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response(JSON.stringify({
        object: 'list',
        data: [{ id: 'antigravity__gemini-pro' }, { id: 'gpt-native' }],
      }), { status: 200 });
    }) as typeof fetch;
  }

  it('requires proxy health, advertised mixed catalog, and patched config readback before launch', async () => {
    await expect(verifyCodexAppReadiness(spec, { configPath, fetchImpl: readyFetch() })).resolves.toBeUndefined();
  });

  it('blocks launch when the proxy is not healthy', async () => {
    const fetchImpl = vi.fn(async () => new Response('offline', { status: 503 })) as typeof fetch;
    await expect(verifyCodexAppReadiness(spec, { configPath, fetchImpl })).rejects.toThrow(/HTTP 503/);
  });

  it('blocks the false-positive picker when a catalog model is not routed', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => String(input).endsWith('/health')
      ? new Response(JSON.stringify({ ok: true }), { status: 200 })
      : new Response(JSON.stringify({ data: [{ id: 'gpt-native' }] }), { status: 200 })) as typeof fetch;
    await expect(verifyCodexAppReadiness(spec, { configPath, fetchImpl })).rejects.toThrow(/does not advertise.*gemini-pro/);
  });

  it('blocks launch if config.toml no longer matches the validated Relay session', async () => {
    writeFileSync(configPath, 'model = "gpt-native"\n', 'utf8');
    await expect(verifyCodexAppReadiness(spec, { configPath, fetchImpl: readyFetch() })).rejects.toThrow(/Generated config/);
  });

  it('writes config atomically with private permissions and exact readback', () => {
    expect(readFileSync(configPath, 'utf8')).toContain('antigravity__gemini-pro');
    // POSIX mode assertion is intentionally bounded to macOS/Linux.
    if (process.platform !== 'win32') {
      const { mode } = statSync(configPath);
      expect(mode & 0o777).toBe(0o600);
    }
  });
});
