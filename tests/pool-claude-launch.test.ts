import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, runClaudeCommand } from '../src/cli.js';
import { poolEndpointRevision } from '../src/pool/capabilities.js';
let home: string;
const previous: Record<string, string | undefined> = {};
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'relay-claude-pool-'));
  for (const key of ['HOME', 'CLAUDE_CONFIG_DIR', 'RELAY_AI_HOME', 'TMPDIR']) previous[key] = process.env[key];
  process.env.HOME = home;
  process.env.CLAUDE_CONFIG_DIR = home;
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
  member, endpointRevision: poolEndpointRevision({ providerId: 'account-2', npm: '@ai-sdk/openai-compatible', upstreamModelId: 'm' }),
  verifiedAt: Date.now() - 1000, expiresAt: Date.now() + 3600000, targets: ['claude'], tools: true,
  maxOutputTokens: 4096, contextWindow: 128000, contextSource: 'provider',
  reasoningAccounting: 'inside-output', effortLevels: [], billingSafe: true,
};
function writeConfig(receipts: unknown[]) {
  writeFileSync(join(process.env.RELAY_AI_HOME!, 'config.json'), JSON.stringify({
    freePool: { members: [member], effort: 'auto', receipts },
  }));
}
describe('relay-ai claude --pool gate', () => {
  it('parses --pool without forwarding it to Claude Code', () => {
    const parsed = parseArgs(['claude', '--pool', '--dry-run']);
    expect(parsed.claudePool).toBe(true);
    expect(parsed.claudeArgs).not.toContain('--pool');
  });
  it('previews a verified pool in dry-run and refuses an empty one', async () => {
    writeConfig([receipt]);
    expect(await runClaudeCommand(parseArgs(['claude', '--pool', '--dry-run']))).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Free pool mode: 1 member(s), 1 verified receipt(s).'));
    writeFileSync(join(process.env.RELAY_AI_HOME!, 'config.json'), JSON.stringify({
      freePool: { members: [], effort: 'auto', receipts: [] },
    }));
    expect(await runClaudeCommand(parseArgs(['claude', '--pool', '--dry-run']))).toBe(1);
  });
});
