import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCodexCommand } from '../src/codex.js';
import { poolEndpointRevision } from '../src/pool/capabilities.js';
import { codexPoolCatalogModel } from '../src/pool/catalog.js';
import type { FreePoolPreferences } from '../src/types.js';

let home: string;
const previous: Record<string, string | undefined> = {};
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'relay-pool-additive-'));
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
const receipt = {
  member,
  endpointRevision: poolEndpointRevision({ providerId: 'account-2', npm: '@ai-sdk/openai-compatible', upstreamModelId: 'm' }),
  verifiedAt: Date.now() - 1000,
  expiresAt: Date.now() + 3_600_000,
  targets: ['codex' as const],
  tools: true,
  maxOutputTokens: 4096,
  contextWindow: 200_000,
  contextSource: 'provider' as const,
  reasoningAccounting: 'inside-output' as const,
  effortLevels: ['low', 'medium', 'high'],
  billingSafe: true,
};

function pool(overrides: Partial<FreePoolPreferences> = {}): FreePoolPreferences {
  return { enabled: true, members: [member], effort: 'auto', receipts: [receipt], ...overrides };
}

function writeConfig(freePool: unknown) {
  writeFileSync(join(process.env.RELAY_AI_HOME!, 'config.json'), JSON.stringify({ freePool }));
}

describe('Relay Free Pool as a catalog selection', () => {
  it('maps the synthetic provider/model pair to the standalone pool branch', async () => {
    writeConfig(pool({ enabled: true }));
    const exit = await runCodexCommand(['--config'], false, {
      launchProvider: 'relay-free-pool',
      launchModel: 'relay-free-pool',
    });
    expect(exit).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Free pool mode: 1 member(s), 1 verified receipt(s).'));
  });

  it('maps a bare relay-free-pool model selection without hijacking other providers', async () => {
    writeConfig(pool({ enabled: true }));
    expect(await runCodexCommand(['--config'], false, { launchModel: 'relay-free-pool' })).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Free pool mode:'));
  });

  it('builds a real catalog row with the verified window and shared effort ladder', () => {
    const entry = codexPoolCatalogModel(pool({ members: [member], receipts: [receipt] }), [receipt]);
    expect(entry).toBeDefined();
    expect(entry!.slug).toBe('relay-free-pool');
    expect(entry!.display_name).toBe('Relay Free Pool');
    expect(entry!.context_window).toBeLessThan(200_000);
    expect(entry!.max_context_window).toBe(entry!.context_window);
    expect(entry!.supported_reasoning_levels).toEqual([
      { effort: 'low', description: expect.any(String) },
      { effort: 'medium', description: expect.any(String) },
      { effort: 'high', description: expect.any(String) },
    ]);
    expect(entry!.default_reasoning_level).toBe('low');
    expect(entry!.supports_reasoning_summaries).toBe(false);
  });

  it('advertises no reasoning levels when verified members share none', () => {
    const plain = { ...receipt, effortLevels: [] };
    const entry = codexPoolCatalogModel({ members: [member], effort: 'auto', receipts: [plain] }, [plain]);
    expect(entry!.supported_reasoning_levels).toEqual([{ effort: 'none', description: 'none' }]);
    expect(entry!.default_reasoning_level).toBe('none');
  });

  it('uses only the levels every verified member can honor', () => {
    const second = {
      ...receipt,
      member: { providerId: 'account-3', modelId: 'n' },
      endpointRevision: poolEndpointRevision({ providerId: 'account-3', npm: '@ai-sdk/openai-compatible', upstreamModelId: 'n' }),
      effortLevels: ['medium', 'high', 'xhigh'],
      contextWindow: 300_000,
    };
    const entry = codexPoolCatalogModel(
      { members: [member, second.member], effort: 'auto', receipts: [receipt, second] },
      [receipt, second],
    );
    expect(entry!.supported_reasoning_levels.map(level => (level as { effort: string }).effort)).toEqual(['medium', 'high']);
    expect(entry!.context_window).toBeLessThan(200_000);
  });

  it('returns no catalog row without a fresh verified receipt', () => {
    const stale = { ...receipt, expiresAt: Date.now() - 1 };
    expect(codexPoolCatalogModel({ members: [member], effort: 'auto', receipts: [stale] }, [stale])).toBeUndefined();
  });

  it('app catalog keeps app truncation and shell defaults', () => {
    const entry = codexPoolCatalogModel(pool(), [receipt], { appCatalog: true });
    expect(entry!.shell_type).toBe('default');
    expect(entry!.truncation_policy).toEqual({ mode: 'bytes', limit: 10_000 });
    expect(entry!.supports_parallel_tool_calls).toBe(false);
  });
});
