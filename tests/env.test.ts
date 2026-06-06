// tests/env.test.ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { detectConflicts, resolveApiKey, buildChildEnv } from '../src/env.js';
import { BACKENDS, CONFLICTING_ENV_VARS } from '../src/constants.js';

// Snapshot of all conflicting vars before any test so we can restore them
const originalConflictingValues: Record<string, string | undefined> = {};

describe('detectConflicts', () => {
  beforeEach(() => {
    // Save and unset ALL conflicting vars so the empty-array test is reliable
    // even when the shell has ANTHROPIC_API_KEY, CLAUDE_CODE_USE_VERTEX, etc. set.
    for (const name of CONFLICTING_ENV_VARS) {
      originalConflictingValues[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    // Restore everything we cleared in beforeEach
    for (const name of CONFLICTING_ENV_VARS) {
      if (originalConflictingValues[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = originalConflictingValues[name];
      }
    }
  });

  it('returns empty array when no conflicting vars are set', () => {
    expect(detectConflicts()).toEqual([]);
  });

  it('returns conflict entries for each set variable', () => {
    process.env['CLAUDE_CODE_USE_VERTEX'] = '1';
    process.env['ANTHROPIC_API_KEY'] = 'old-key';
    const conflicts = detectConflicts();
    expect(conflicts.some(c => c.name === 'CLAUDE_CODE_USE_VERTEX' && c.value === '1')).toBe(true);
    expect(conflicts.some(c => c.name === 'ANTHROPIC_API_KEY' && c.value === 'old-key')).toBe(true);
  });
});

describe('resolveApiKey', () => {
  const originalKey = process.env['OPENCODE_API_KEY'];

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env['OPENCODE_API_KEY'];
    } else {
      process.env['OPENCODE_API_KEY'] = originalKey;
    }
  });

  it('returns null when OPENCODE_API_KEY is not set', () => {
    delete process.env['OPENCODE_API_KEY'];
    expect(resolveApiKey()).toBeNull();
  });

  it('returns null when OPENCODE_API_KEY is empty string (deleted Keychain entry)', () => {
    process.env['OPENCODE_API_KEY'] = '';
    expect(resolveApiKey()).toBeNull();
  });

  it('returns the key value when set', () => {
    process.env['OPENCODE_API_KEY'] = 'sk-test-key-123';
    expect(resolveApiKey()).toBe('sk-test-key-123');
  });
});

describe('buildChildEnv', () => {
  beforeEach(() => {
    process.env['CLAUDE_CODE_USE_VERTEX'] = '1';
    process.env['ANTHROPIC_VERTEX_PROJECT_ID'] = 'my-project';
    process.env['ANTHROPIC_DEFAULT_OPUS_MODEL'] = 'claude-opus-4-6[1m]';
  });

  afterEach(() => {
    delete process.env['CLAUDE_CODE_USE_VERTEX'];
    delete process.env['ANTHROPIC_VERTEX_PROJECT_ID'];
    delete process.env['ANTHROPIC_DEFAULT_OPUS_MODEL'];
  });

  it('removes all conflicting vars from child env', () => {
    const env = buildChildEnv(BACKENDS.zen.baseUrl, 'claude-sonnet-4-6', 'my-key');
    expect(env['CLAUDE_CODE_USE_VERTEX']).toBeUndefined();
    expect(env['ANTHROPIC_VERTEX_PROJECT_ID']).toBeUndefined();
    expect(env['ANTHROPIC_DEFAULT_OPUS_MODEL']).toBeUndefined();
  });

  it('sets ANTHROPIC_BASE_URL to backend URL', () => {
    const env = buildChildEnv(BACKENDS.zen.baseUrl, 'claude-sonnet-4-6', 'my-key');
    expect(env['ANTHROPIC_BASE_URL']).toBe('https://opencode.ai/zen');
  });

  it('sets ANTHROPIC_API_KEY to the provided key', () => {
    const env = buildChildEnv(BACKENDS.zen.baseUrl, 'claude-sonnet-4-6', 'my-key');
    expect(env['ANTHROPIC_API_KEY']).toBe('my-key');
  });

  it('sets ANTHROPIC_MODEL to the selected model', () => {
    const env = buildChildEnv(BACKENDS.zen.baseUrl, 'claude-sonnet-4-6', 'my-key');
    expect(env['ANTHROPIC_MODEL']).toBe('claude-sonnet-4-6');
  });

  it('does NOT mutate process.env', () => {
    buildChildEnv(BACKENDS.zen.baseUrl, 'claude-sonnet-4-6', 'my-key');
    expect(process.env['CLAUDE_CODE_USE_VERTEX']).toBe('1');
    expect(process.env['ANTHROPIC_VERTEX_PROJECT_ID']).toBe('my-project');
  });

  it('preserves non-conflicting env vars like PATH and HOME', () => {
    const env = buildChildEnv(BACKENDS.zen.baseUrl, 'claude-sonnet-4-6', 'my-key');
    expect(env['PATH']).toBe(process.env['PATH']);
    expect(env['HOME']).toBe(process.env['HOME']);
  });

  it('uses proxy URL when proxyPort is provided', () => {
    const env = buildChildEnv(BACKENDS.zen.baseUrl, 'deepseek-v4-flash', 'my-key', 12345);
    expect(env['ANTHROPIC_BASE_URL']).toBe('http://127.0.0.1:12345');
  });

  it('uses backend URL when proxyPort is not provided', () => {
    const env = buildChildEnv(BACKENDS.go.baseUrl, 'minimax-m3', 'my-key');
    expect(env['ANTHROPIC_BASE_URL']).toBe('https://opencode.ai/zen/go');
  });
});
