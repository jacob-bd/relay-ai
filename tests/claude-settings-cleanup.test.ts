import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRelayAliasModel, restoreClaudeModel, snapshotClaudeModel } from '../src/claude-settings-cleanup.js';

describe('claude settings model cleanup', () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;
  const file = () => join(dir, 'settings.json');
  const read = () => JSON.parse(readFileSync(file(), 'utf8'));

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'relay-claude-')); env = { CLAUDE_CONFIG_DIR: dir }; });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('recognises relay aliases only', () => {
    expect(isRelayAliasModel('anthropic-a2agent__DeepSeek-V4.1-Flash-1017[1m]')).toBe(true);
    expect(isRelayAliasModel('anthropic-opencode-go__deepseek-v4-flash')).toBe(true);
    expect(isRelayAliasModel('claude-pool')).toBe(true);
    expect(isRelayAliasModel('claude-pool[1m]')).toBe(true);
    expect(isRelayAliasModel('sonnet')).toBe(false);
    expect(isRelayAliasModel('claude-sonnet-5-5')).toBe(false);
    expect(isRelayAliasModel(undefined)).toBe(false);
  });

  it('restores the previous model and keeps other settings', () => {
    writeFileSync(file(), JSON.stringify({ model: 'sonnet', theme: 'dark' }));
    const snap = snapshotClaudeModel(env);
    writeFileSync(file(), JSON.stringify({ model: 'anthropic-a2agent__x[1m]', theme: 'light' }));
    expect(restoreClaudeModel(snap)).toBe(true);
    expect(read()).toEqual({ model: 'sonnet', theme: 'light' });
  });

  it('removes the model when none existed before', () => {
    writeFileSync(file(), JSON.stringify({ theme: 'dark' }));
    const snap = snapshotClaudeModel(env);
    writeFileSync(file(), JSON.stringify({ model: 'anthropic-go__y', theme: 'dark' }));
    restoreClaudeModel(snap);
    expect(read()).toEqual({ theme: 'dark' });
  });

  it('cleans up the pool model Claude Code persists', () => {
    writeFileSync(file(), JSON.stringify({ model: 'sonnet', theme: 'dark' }));
    const snap = snapshotClaudeModel(env);
    writeFileSync(file(), JSON.stringify({ model: 'claude-pool[1m]', theme: 'light' }));
    expect(restoreClaudeModel(snap)).toBe(true);
    expect(read()).toEqual({ model: 'sonnet', theme: 'light' });
  });

  it('drops a stale alias that was already present at launch', () => {
    writeFileSync(file(), JSON.stringify({ model: 'anthropic-go__y' }));
    const snap = snapshotClaudeModel(env);
    restoreClaudeModel(snap);
    expect(read()).toEqual({});
  });

  it('leaves a non-relay choice made during the session alone', () => {
    writeFileSync(file(), JSON.stringify({ model: 'sonnet' }));
    const snap = snapshotClaudeModel(env);
    writeFileSync(file(), JSON.stringify({ model: 'opus' }));
    expect(restoreClaudeModel(snap)).toBe(false);
    expect(read().model).toBe('opus');
  });

  it('does not throw when settings.json is missing or invalid', () => {
    const snap = snapshotClaudeModel(env);
    expect(restoreClaudeModel(snap)).toBe(false);
    writeFileSync(file(), '{ nope');
    expect(restoreClaudeModel(snap)).toBe(false);
  });
});
