import { describe, expect, it, vi } from 'vitest';
import { launchClaudeWithHttpProxy } from '../src/http-proxy/launch.js';
import type { LocalProvider } from '../src/types.js';

const providers: LocalProvider[] = [{
  id: 'moonshot',
  name: 'Moonshot',
  apiKey: '',
  models: [{
    id: 'kimi-k3',
    upstreamModelId: 'kimi-k3-upstream',
    name: 'Kimi K3',
    family: 'kimi',
    brand: 'Kimi',
    modelFormat: 'openai',
    npm: '@ai-sdk/openai-compatible',
    contextWindow: 1_000_000,
  }],
}];

describe('transparent Claude launch lifecycle', () => {
  it('launches the selected Relay model while preserving native Anthropic auth', async () => {
    const close = vi.fn(async () => {});
    const launch = vi.fn(async () => 0);
    const start = vi.fn(async () => ({
      handle: {
        host: '127.0.0.1',
        port: 4321,
        proxyUrl: 'http://relay-ai:session-secret@127.0.0.1:4321',
        caCertPath: '/tmp/relay-ca.pem',
        modelIds: ['relay:moonshot:kimi-k3[1m]'],
        close,
      },
      loaded: { routes: [], unavailable: [], unsupported: [] },
      startingModel: 'relay:moonshot:kimi-k3[1m]',
    }));

    const result = await launchClaudeWithHttpProxy({
      providers,
      favorites: [],
      selected: { providerId: 'moonshot', modelId: 'kimi-k3' },
      baseEnv: {
        ANTHROPIC_AUTH_TOKEN: 'native-oauth-token',
        ANTHROPIC_BASE_URL: 'https://stale-gateway.example',
      },
      claudeArgs: ['-c'],
    }, { start, launch });

    expect(result.exitCode).toBe(0);
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        ANTHROPIC_AUTH_TOKEN: 'native-oauth-token',
        HTTPS_PROXY: 'http://relay-ai:session-secret@127.0.0.1:4321',
        NODE_EXTRA_CA_CERTS: '/tmp/relay-ca.pem',
      }),
      'relay:moonshot:kimi-k3[1m]',
      ['-c'],
    );
    expect(launch.mock.calls[0]![0]).not.toHaveProperty('ANTHROPIC_BASE_URL');
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes the proxy and refuses to launch when the selected route is unavailable', async () => {
    const close = vi.fn(async () => {});
    const launch = vi.fn(async () => 0);
    const start = vi.fn(async () => ({
      handle: {
        host: '127.0.0.1',
        port: 4321,
        proxyUrl: 'http://relay-ai:session-secret@127.0.0.1:4321',
        caCertPath: '/tmp/relay-ca.pem',
        modelIds: [],
        close,
      },
      loaded: {
        routes: [],
        unavailable: [{ providerId: 'moonshot', modelId: 'kimi-k3' }],
        unsupported: [],
      },
      startingModel: undefined,
    }));

    await expect(launchClaudeWithHttpProxy({
      providers,
      favorites: [],
      selected: { providerId: 'moonshot', modelId: 'kimi-k3' },
      baseEnv: {},
      claudeArgs: [],
    }, { start, launch })).rejects.toThrow(/selected Relay model.*unavailable/i);
    expect(launch).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects an inherited corporate proxy before creating local credentials', async () => {
    const start = vi.fn();
    const launch = vi.fn();
    await expect(launchClaudeWithHttpProxy({
      providers,
      favorites: [],
      baseEnv: { HTTPS_PROXY: 'http://corporate.example:8080' },
      claudeArgs: [],
    }, { start, launch })).rejects.toThrow(/existing HTTPS_PROXY/i);
    expect(start).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });

  it('does not reveal inherited proxy credentials when preflight fails', async () => {
    const start = vi.fn();
    const launch = vi.fn();
    const error = await launchClaudeWithHttpProxy({
      providers: [],
      favorites: [],
      baseEnv: { HTTPS_PROXY: 'http://employee:super-secret@corporate.example:8080' },
      claudeArgs: [],
    }, { start, launch }).then(() => null, reason => reason as Error);
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toMatch(/existing HTTPS_PROXY/i);
    expect(error?.message).not.toContain('super-secret');
  });
});
