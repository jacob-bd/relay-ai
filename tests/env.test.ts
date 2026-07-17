// tests/env.test.ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  detectConflicts,
  resolveApiKey,
  buildChildEnv,
  classifyKeyringError,
  parseAuthRef,
  providerKeyringAccount,
  relayAiKeyEnvVar,
  resolveProviderCredential,
  GLOBAL_OPENCODE_KEYRING_ACCOUNT,
} from '../src/env.js';
import { BACKENDS, CONFLICTING_ENV_VARS } from '../src/constants.js';

// Snapshot of all conflicting vars before any test so we can restore them
const originalConflictingValues: Record<string, string | undefined> = {};

describe('classifyKeyringError', () => {
  it('identifies missing native module', () => {
    expect(classifyKeyringError(new Error("Cannot find module '@napi-rs/keyring'"))).toContain('native keyring module');
    expect(classifyKeyringError(new Error('Module not found: keyring.node'))).toContain('native keyring module');
    expect(classifyKeyringError(new Error('failed to load native binding'))).toContain('native keyring module');
  });

  it('identifies Secret Service / D-Bus daemon not running', () => {
    expect(classifyKeyringError(new Error('Secret Service error: no daemon running'))).toContain('Secret Service daemon');
    expect(classifyKeyringError(new Error('DBus error: connection refused'))).toContain('Secret Service daemon');
    expect(classifyKeyringError(new Error('daemon not available'))).toContain('Secret Service daemon');
  });

  it('identifies permission denied / locked keychain', () => {
    expect(classifyKeyringError(new Error('access denied by user'))).toContain('denied');
    expect(classifyKeyringError(new Error('keychain is locked'))).toContain('denied');
    expect(classifyKeyringError(new Error('user cancelled the operation'))).toContain('denied');
    expect(classifyKeyringError(new Error('user refused to grant access'))).toContain('denied');
  });

  it('falls back to generic message for unknown errors', () => {
    const result = classifyKeyringError(new Error('something totally unexpected'));
    expect(result).toContain('keyring error:');
    expect(result).toContain('something totally unexpected');
  });

  it('handles non-Error values gracefully', () => {
    expect(() => classifyKeyringError('string error')).not.toThrow();
    expect(() => classifyKeyringError(42)).not.toThrow();
    expect(() => classifyKeyringError(null)).not.toThrow();
  });
});

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

describe('provider credentials', () => {
  it('parses authRef strings', () => {
    expect(parseAuthRef('keyring:provider:groq')).toEqual({ kind: 'keyring', account: 'provider:groq' });
    expect(parseAuthRef('keyring:global:opencode')).toEqual({ kind: 'keyring', account: GLOBAL_OPENCODE_KEYRING_ACCOUNT });
    expect(parseAuthRef('env:OPENCODE_API_KEY')).toEqual({ kind: 'env', varName: 'OPENCODE_API_KEY' });
    expect(parseAuthRef('bad')).toBeNull();
  });

  it('builds provider keyring account names', () => {
    expect(providerKeyringAccount('groq')).toBe('provider:groq');
    expect(providerKeyringAccount('custom-together')).toBe('provider:custom-together');
  });

  it('resolves RELAY_AI_KEY_* env before authRef', async () => {
    process.env[relayAiKeyEnvVar('groq')] = 'env-groq-key';
    const key = await resolveProviderCredential('groq', 'keyring:provider:groq');
    expect(key).toBe('env-groq-key');
    delete process.env[relayAiKeyEnvVar('groq')];
  });

  it('resolves env authRef', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-openai';
    const key = await resolveProviderCredential('openai', 'env:OPENAI_API_KEY');
    expect(key).toBe('sk-openai');
    delete process.env['OPENAI_API_KEY'];
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
    expect(env['ANTHROPIC_MODEL']).toBe('claude-sonnet-4-6[1m]');
  });

  it('appends [1m] for third-party models with >200K context', () => {
    const env = buildChildEnv(BACKENDS.zen.baseUrl, 'gemini-3.5-flash', 'my-key', 12345, 1_000_000);
    expect(env['ANTHROPIC_MODEL']).toBe('gemini-3.5-flash[1m]');
    expect(env['CLAUDE_CODE_MAX_CONTEXT_TOKENS']).toBe('1000000');
  });

  it('sets CLAUDE_CODE_MAX_CONTEXT_TOKENS from model id for proxy sessions', () => {
    expect(buildChildEnv(BACKENDS.zen.baseUrl, 'zzzz-unknown-model', 'k')['CLAUDE_CODE_MAX_CONTEXT_TOKENS']).toBe('200000');
  });

  it('uses explicit contextWindow override when provided', () => {
    expect(buildChildEnv(BACKENDS.zen.baseUrl, 'custom-model', 'k', undefined, 512_000)['CLAUDE_CODE_MAX_CONTEXT_TOKENS']).toBe('512000');
    expect(buildChildEnv(BACKENDS.zen.baseUrl, 'custom-model', 'k', undefined, 1_048_576)['CLAUDE_CODE_MAX_CONTEXT_TOKENS']).toBe('1048576');
  });

  it('sets the launch model window AND gateway discovery in switch-menu mode', () => {
    // Claude Code's gateway model discovery only carries id + display_name (no
    // context_window), so this env var is the only context-window lever and it
    // reflects the launch model. It cannot update on live /model switch.
    const env = buildChildEnv(BACKENDS.zen.baseUrl, 'big-pickle', 'k', 1234, 200_000, true);
    expect(env['CLAUDE_CODE_MAX_CONTEXT_TOKENS']).toBe('200000');
    expect(env['CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY']).toBe('1');
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

  it('restores first-party-like Claude Code behavior for proxy/gateway routes', () => {
    const env = buildChildEnv(BACKENDS.zen.baseUrl, 'gemini-3.5-flash', 'my-key', 12345);
    expect(env['ENABLE_TOOL_SEARCH']).toBe('true');
    expect(env['CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT']).toBe('0');
  });

  it('uses backend URL when proxyPort is not provided', () => {
    const env = buildChildEnv(BACKENDS.go.baseUrl, 'minimax-m3', 'my-key');
    expect(env['ANTHROPIC_BASE_URL']).toBe('https://opencode.ai/zen/go');
  });
});
