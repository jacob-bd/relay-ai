import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPoolCommand, validPoolReceipts } from '../src/pool/command.js';
import { loadPreferences, savePreferences } from '../src/config.js';
import { parseArgs } from '../src/cli.js';
vi.mock('../src/provider-catalog.js', async original => ({
  ...await original<typeof import('../src/provider-catalog.js')>(),
  fetchProviderCatalog: async () => [{ id: 'free', name: 'Free Provider', models: [{
    id: 'kimi', name: 'Kimi', npm: '@ai-sdk/openai-compatible', upstreamModelId: 'kimi',
    contextWindow: 128000, cost: { input: 0, output: 0 },
  }] }],
}));
let home: string;
let previous: string | undefined;
beforeEach(() => {
  previous = process.env.RELAY_AI_HOME;
  home = mkdtempSync(join(tmpdir(), 'relay-pool-command-'));
  process.env.RELAY_AI_HOME = home;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  if (previous === undefined) delete process.env.RELAY_AI_HOME;
  else process.env.RELAY_AI_HOME = previous;
  rmSync(home, { recursive: true, force: true });
});
describe('pool membership command', () => {
  it('discards malformed and duplicate receipts instead of blocking the save', () => {
    const receipt = {
      member: { providerId: 'p', modelId: 'm' }, endpointRevision: 'a'.repeat(64),
      verifiedAt: 1, expiresAt: 2, targets: ['codex'], tools: true, maxOutputTokens: 1,
      contextWindow: 1000, contextSource: 'provider', reasoningAccounting: 'inside-output',
      effortLevels: [], billingSafe: true,
    } as const;
    expect(validPoolReceipts([receipt, receipt, { ...receipt, endpointRevision: 'bad' } as never])).toEqual({
      // A member that passed the text and tool Test can serve Antigravity's Auto row too.
      receipts: [{ ...receipt, expiresAt: Number.MAX_SAFE_INTEGER, targets: ['codex', 'antigravity', 'core'] }], discarded: 2,
    });
  });

  it('parses membership commands without sending arguments to an agent', () => {
    expect(parseArgs(['pool', 'add', 'groq-2', 'model'])).toMatchObject({ command: 'pool', claudeArgs: ['add', 'groq-2', 'model'] });
  });
  it('adds, lists, changes effort and removes independently of favorites', async () => {
    savePreferences({ favoriteModels: [{ providerId: 'paid', modelId: 'm' }] });
    expect(await runPoolCommand(['add', 'groq-2', 'm'])).toBe(0);
    expect(await runPoolCommand(['effort', 'high'])).toBe(0);
    expect(await runPoolCommand(['list'])).toBe(0);
    expect(loadPreferences().freePool).toEqual({ members: [{ providerId: 'groq-2', modelId: 'm' }], effort: 'high', receipts: [] });
    expect(await runPoolCommand(['remove', 'groq-2', 'm'])).toBe(0);
    expect(loadPreferences().freePool?.members).toEqual([]);
    expect(loadPreferences().favoriteModels).toEqual([{ providerId: 'paid', modelId: 'm' }]);
  });
  it('leaves saved state intact on duplicate, invalid effort or malformed command', async () => {
    expect(await runPoolCommand(['add', 'groq-2', 'm'])).toBe(0);
    const saved = loadPreferences().freePool;
    for (const args of [['add', 'groq-2', 'm'], ['effort', 'max'], ['add', 'groq-2'], ['clear']]) {
      expect(await runPoolCommand(args)).toBe(1);
      expect(loadPreferences().freePool).toEqual(saved);
    }
  });
});

it('enables, disables, reorders and lists filtered candidates without inference', async () => {
  await runPoolCommand(['add', 'a', 'one']);
  await runPoolCommand(['add', 'b', 'two']);
  expect(await runPoolCommand(['enable'])).toBe(0);
  expect(loadPreferences().freePool?.enabled).toBe(true);
  expect(await runPoolCommand(['move', 'b', 'two', 'up'])).toBe(0);
  expect(loadPreferences().freePool?.members[0]).toEqual({ providerId: 'b', modelId: 'two' });
  expect(await runPoolCommand(['disable'])).toBe(0);
  expect(loadPreferences().freePool?.enabled).toBe(false);
  expect(await runPoolCommand(['candidates', '--search', 'kimi', '--min-context', '128000'])).toBe(0);
  const printed = vi.mocked(console.log).mock.calls.at(-1)?.[0];
  expect(JSON.parse(printed)).toMatchObject({ total: 1, shown: 1, models: [{ providerName: 'Free Provider', modelId: 'kimi' }] });
  expect(await runPoolCommand(['candidates', '--min-context', 'bogus'])).toBe(1);
});
