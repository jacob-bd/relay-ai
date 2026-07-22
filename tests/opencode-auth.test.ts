import { describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  authFilePermissionWarning,
  isOpencodeOAuth,
  readOpencodeAuthFile,
  resolveOpencodeAuthPath,
} from '../src/registry/opencode-auth.js';
import {
  buildImportProviderList,
  classifyOpencodeCredentialGap,
  listCredentialSkippedProviders,
} from '../src/registry/import-build.js';
import type { RawProvider } from '../src/providers.js';

// Build an env whose data-home points inside `home`, using the variable the
// resolver actually honors on this platform (APPDATA on Windows, XDG on unix).
function authEnvForHome(home: string): NodeJS.ProcessEnv {
  return process.platform === 'win32'
    ? { APPDATA: join(home, 'Roaming') }
    : { XDG_DATA_HOME: join(home, 'share') };
}

describe('resolveOpencodeAuthPath', () => {
  it('resolves the platform data path', () => {
    if (process.platform === 'win32') {
      expect(resolveOpencodeAuthPath({ APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }))
        .toBe('C:\\Users\\me\\AppData\\Roaming\\opencode\\auth.json');
    } else {
      expect(resolveOpencodeAuthPath({ XDG_DATA_HOME: '/tmp/xdg' })).toBe('/tmp/xdg/opencode/auth.json');
    }
  });
});

describe('readOpencodeAuthFile', () => {
  it('parses oauth entries', () => {
    const home = mkdtempSync(join(tmpdir(), 'relay-oauth-'));
    const env = authEnvForHome(home);
    const path = resolveOpencodeAuthPath(env);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({
      xai: {
        type: 'oauth',
        access: 'acc',
        refresh: 'ref',
        expires: 123,
        providerData: { copilot: { lookup_status: 'known', is_free_plan: true } },
      },
    }), 'utf8');
    if (process.platform !== 'win32') chmodSync(path, 0o600);

    const result = readOpencodeAuthFile(env);
    expect(result?.entries['xai']).toMatchObject({
      type: 'oauth',
      access: 'acc',
      providerData: { copilot: { lookup_status: 'known', is_free_plan: true } },
    });
    expect(isOpencodeOAuth(result?.entries['xai'])).toBe(true);
    rmSync(home, { recursive: true, force: true });
  });

  it('flags or skips the world-readable warning per platform', () => {
    const home = mkdtempSync(join(tmpdir(), 'relay-oauth-'));
    const path = join(home, 'auth.json');
    writeFileSync(path, '{}', 'utf8');
    if (process.platform === 'win32') {
      // NTFS has no world-readable bit; the warning is intentionally suppressed.
      expect(authFilePermissionWarning(path)).toBeUndefined();
    } else {
      chmodSync(path, 0o644);
      expect(authFilePermissionWarning(path)).toContain('readable by others');
    }
    rmSync(home, { recursive: true, force: true });
  });
});

describe('buildImportProviderList', () => {
  const raw: RawProvider[] = [{
    id: 'xai',
    name: 'xAI',
    models: {
      grok: {
        id: 'grok',
        api: { npm: '@ai-sdk/xai', url: '' },
      },
    },
  }, {
    id: 'groq',
    name: 'Groq',
    key: 'gsk_real_key_1234567890',
    models: {
      llama: {
        id: 'llama',
        api: { npm: '@ai-sdk/groq', url: 'https://api.groq.com/openai/v1' },
      },
    },
  }];

  it('includes oauth providers from auth.json', () => {
    const { providers, oauth } = buildImportProviderList(raw, {
      xai: { type: 'oauth', access: 'tok', refresh: 'ref', expires: 1 },
    });
    expect(providers.map(p => p.id).sort()).toEqual(['groq', 'xai-oauth']);
    expect(oauth.oauthByProviderId.has('xai-oauth')).toBe(true);
  });

  it('maps OpenCode cloud provider ids to relay-ai zen and go ids', () => {
    const cloudRaw: RawProvider[] = [{
      id: 'opencode',
      name: 'OpenCode',
      key: 'shared-opencode-key',
      models: {
        zen: {
          id: 'zen-model',
          api: { npm: '@ai-sdk/openai-compatible', url: 'https://opencode.ai/zen/v1' },
        },
      },
    }, {
      id: 'opencode-go',
      name: 'OpenCode Go',
      key: 'shared-opencode-key',
      models: {
        go: {
          id: 'go-model',
          api: { npm: '@ai-sdk/openai-compatible', url: 'https://opencode.ai/go/v1' },
        },
      },
    }];

    const { providers } = buildImportProviderList(cloudRaw, {});

    expect(providers.map(provider => provider.id)).toEqual(['zen', 'go']);
    expect(providers.map(provider => provider.name)).toEqual(['OpenCode Zen', 'OpenCode Go']);
  });

  it('classifies credential gaps by provider type', () => {
    expect(classifyOpencodeCredentialGap('xai')).toBe('oauth-no-token');
    expect(classifyOpencodeCredentialGap('anthropic')).toBe('no-api-key');
    expect(classifyOpencodeCredentialGap('google-vertex')).toBe('manual-only');
  });

  it('lists oauth-capable providers without tokens', () => {
    const skipped = listCredentialSkippedProviders(raw, {}, new Set(['groq']));
    expect(skipped).toEqual([{ id: 'xai', name: 'xAI', reason: 'oauth-no-token' }]);
  });

  it('does not list random OpenCode catalog stubs without keys', () => {
    const rawCatalog: RawProvider[] = [{
      id: 'google',
      name: 'Google',
      models: { gemini: { id: 'gemini', api: { npm: '@ai-sdk/google', url: '' } } },
    }];
    expect(listCredentialSkippedProviders(rawCatalog, {}, new Set(), new Set())).toEqual([]);
  });

  it('does not duplicate providers already reported as conflict-kept', () => {
    const rawWithAnthropic: RawProvider[] = [{
      id: 'anthropic',
      name: 'Anthropic',
      key: 'anything',
      models: { m: { id: 'claude', api: { npm: '@ai-sdk/anthropic', url: '' } } },
    }];
    const skipped = listCredentialSkippedProviders(
      rawWithAnthropic,
      {},
      new Set(),
      new Set(['anthropic']),
    );
    expect(skipped).toEqual([]);
  });
});
