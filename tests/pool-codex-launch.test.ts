import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// These tests exercise the pool gate, not the launch: CI has no Codex installed.
vi.mock('../src/codex/launch.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/codex/launch.js')>(),
  findCodexBinary: () => '/usr/local/bin/codex',
}));
import { runCodexCommand } from '../src/codex.js';
import { buildCodexProfileToml } from '../src/codex/profile.js';
import { poolEndpointRevision } from '../src/pool/capabilities.js';
let home: string;
const previous: Record<string, string | undefined> = {};
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'relay-pool-launch-'));
  for (const key of ['HOME', 'CODEX_HOME', 'RELAY_AI_HOME', 'TMPDIR']) previous[key] = process.env[key];
  process.env.HOME = home;
  process.env.CODEX_HOME = home;
  process.env.RELAY_AI_HOME = join(home, '.relay-ai');
  process.env.TMPDIR = home;
  mkdirSync(process.env.RELAY_AI_HOME, { recursive: true });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(home, { recursive: true, force: true });
});
const member = { providerId: 'account-2', modelId: 'm' };
function writeConfig(receipts: unknown[]) {
  writeFileSync(join(process.env.RELAY_AI_HOME!, 'config.json'), JSON.stringify({
    freePool: { members: [member], effort: 'auto', receipts },
  }));
}
const receipt = {
  member, endpointRevision: poolEndpointRevision({ providerId: 'account-2', npm: '@ai-sdk/openai-compatible', upstreamModelId: 'm' }),
  verifiedAt: Date.now() - 1000, expiresAt: Date.now() + 3600000, targets: ['codex'], tools: true,
  maxOutputTokens: 4096, contextWindow: 128000, contextSource: 'provider',
  reasoningAccounting: 'inside-output', effortLevels: [], billingSafe: true,
};
describe('relay-ai codex --pool launch gate', () => {
  it('forces the pooled Codex provider onto HTTP Responses', () => {
    const profile = buildCodexProfileToml({
      route: { tier: 'proxy', modelId: 'relay-free-pool', providerId: 'relay-free-pool', npm: '@ai-sdk/openai-compatible', upstreamModelId: 'relay-free-pool', apiKey: '' },
      proxyPort: 1234,
      catalogPath: '/tmp/models-pool.json',
      supportsWebSockets: false,
    });
    expect(profile).toContain('wire_api = "responses"');
    expect(profile).toContain('supports_websockets = false');
  });

  it('previews a configured, verified pool without starting Codex', async () => {
    writeConfig([receipt]);
    expect(await runCodexCommand(['--pool', '--config'], false, { pool: true })).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Free pool mode: 1 member(s), 1 verified receipt(s).'));
  });
  it('refuses an empty pool, and does not retire a verified member by age', async () => {
    writeFileSync(join(process.env.RELAY_AI_HOME!, 'config.json'), JSON.stringify({
      freePool: { members: [], effort: 'auto', receipts: [] },
    }));
    expect(await runCodexCommand(['--pool', '--config'], false, { pool: true })).toBe(1);
    writeConfig([{ ...receipt, expiresAt: Date.now() - 1 }]);
    expect(await runCodexCommand(['--pool', '--config'], false, { pool: true })).toBe(0);
  });
});
