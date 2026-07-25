import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeGatewayDiscoveryCache } from '../src/http-proxy/discovery-cache.js';
import { RELAY_BASE_URL } from '../src/http-proxy/anthropic-host.js';
import type { ProxyRoute } from '../src/proxy.js';

const route: ProxyRoute = {
  aliasId: 'relay:moonshot:kimi-k3[1m]',
  gatewayAliasId: 'anthropic-moonshot__kimi-k3[1m]',
  realModelId: 'kimi-k3-upstream',
  displayName: 'Kimi K3 (Moonshot)',
  upstreamUrl: '',
  apiKey: 'moonshot-secret',
  modelFormat: 'openai',
  npm: '@ai-sdk/openai-compatible',
  providerId: 'moonshot',
  contextWindow: 1_000_000,
};

describe('gateway discovery cache seeder', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'relay-ai-cache-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes a Claude-Code-shaped cache keyed on the pinned base URL', () => {
    writeGatewayDiscoveryCache({ CLAUDE_CONFIG_DIR: tempDir }, [route]);
    const file = join(tempDir, 'cache', 'gateway-models.json');
    expect(existsSync(file)).toBe(true);
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      baseUrl: string;
      models: Array<{ id: string; display_name: string }>;
    };
    expect(parsed.baseUrl).toBe(RELAY_BASE_URL);
    expect(parsed.models[0]).toMatchObject({
      id: 'anthropic-moonshot__kimi-k3[1m]',
      display_name: 'Kimi K3 (Moonshot)',
    });
  });

  it('creates the cache directory when missing and tolerates empty routes', () => {
    writeGatewayDiscoveryCache({ CLAUDE_CONFIG_DIR: tempDir }, []);
    const file = join(tempDir, 'cache', 'gateway-models.json');
    expect(existsSync(file)).toBe(true);
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { models: unknown[] };
    expect(parsed.models).toEqual([]);
  });
});
