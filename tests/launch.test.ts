// tests/launch.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findBinaryOnPath } from '../src/binary-lookup.js';
import { buildClaudeArgs, findClaudeBinary } from '../src/launch.js';
import { buildGeminiChildEnv, prepareGeminiChildEnv } from '../src/gemini/launch.js';
import { setAppPathOverride } from '../src/config.js';

describe('buildClaudeArgs', () => {
  it('omits --model in native-auth HTTP proxy mode', () => {
    expect(buildClaudeArgs(undefined, ['-c'])).toEqual(['-c']);
  });

  it('builds model args when no extra args are provided', () => {
    expect(buildClaudeArgs('claude-sonnet-4-6', [])).toEqual(['--model', 'claude-sonnet-4-6']);
  });

  it('preserves -c', () => {
    expect(buildClaudeArgs('claude-sonnet-4-6', ['-c'])).toEqual(['--model', 'claude-sonnet-4-6', '-c']);
  });

  it('preserves resume session id', () => {
    expect(buildClaudeArgs('claude-sonnet-4-6', ['--resume', 'abc-123'])).toEqual([
      '--model',
      'claude-sonnet-4-6',
      '--resume',
      'abc-123',
    ]);
  });

  it('preserves prompt text', () => {
    expect(buildClaudeArgs('claude-sonnet-4-6', ['--print', 'hello'])).toEqual([
      '--model',
      'claude-sonnet-4-6',
      '--print',
      'hello',
    ]);
  });
});

describe('findBinaryOnPath', () => {
  it('trusts a PATH hit by default', () => {
    const result = findBinaryOnPath('claude', ['/fallback/claude'], {
      runWhich: () => '/path/claude\n',
      exists: () => false,
      isWindows: false,
    });

    expect(result).toBe('/path/claude');
  });

  it('revalidates a PATH hit when requested', () => {
    const result = findBinaryOnPath('antigravity', ['/fallback/antigravity'], {
      runWhich: () => '/missing/antigravity\n',
      exists: path => path === '/fallback/antigravity',
      verifyWhichResult: true,
      isWindows: false,
    });

    expect(result).toBe('/fallback/antigravity');
  });

  it('prefers .cmd wrappers on Windows', () => {
    const result = findBinaryOnPath('gemini', [], {
      runWhich: () => 'C:\\bin\\gemini\nC:\\bin\\gemini.cmd\n',
      exists: () => true,
      isWindows: true,
    });

    expect(result).toBe('C:\\bin\\gemini.cmd');
  });

  it('never shell-interprets the binary name in the default which lookup', () => {
    // Regression: commit d887984 hardened detection to argv-based execFileSync;
    // the shared-helper refactor reintroduced shell-string execSync. A name with
    // shell metacharacters must not execute anything.
    const marker = join(mkdtempSync(join(tmpdir(), 'relay-inj-')), 'pwned');
    try {
      const result = findBinaryOnPath(`no-such-binary; touch ${marker}`, []);
      expect(result).toBeNull();
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(join(marker, '..'), { recursive: true, force: true });
    }
  });
});

describe('findClaudeBinary app path override', () => {
  let tempHome: string;
  let previousRelayHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'relay-ai-launch-test-'));
    previousRelayHome = process.env['RELAY_AI_HOME'];
    process.env['RELAY_AI_HOME'] = join(tempHome, 'relay-home');
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    if (previousRelayHome === undefined) delete process.env['RELAY_AI_HOME'];
    else process.env['RELAY_AI_HOME'] = previousRelayHome;
  });

  it('prefers a saved app path override over auto-detection', () => {
    const customClaude = join(tempHome, 'custom-claude');
    writeFileSync(customClaude, '#!/bin/sh\n');
    setAppPathOverride('claude', customClaude);

    expect(findClaudeBinary()).toBe(customClaude);
  });
});

describe('Gemini launch auth isolation', () => {
  let previousGeminiCliHome: string | undefined;
  let previousDefaultAuth: string | undefined;
  let previousGeminiKey: string | undefined;
  let previousGoogleKey: string | undefined;
  let previousGoogleGenAiKey: string | undefined;
  let previousGoogleGeminiBaseUrl: string | undefined;

  beforeEach(() => {
    previousGeminiCliHome = process.env['GEMINI_CLI_HOME'];
    previousDefaultAuth = process.env['GEMINI_DEFAULT_AUTH_TYPE'];
    previousGeminiKey = process.env['GEMINI_API_KEY'];
    previousGoogleKey = process.env['GOOGLE_API_KEY'];
    previousGoogleGenAiKey = process.env['GOOGLE_GENAI_API_KEY'];
    previousGoogleGeminiBaseUrl = process.env['GOOGLE_GEMINI_BASE_URL'];
  });

  afterEach(() => {
    if (previousGeminiCliHome === undefined) delete process.env['GEMINI_CLI_HOME'];
    else process.env['GEMINI_CLI_HOME'] = previousGeminiCliHome;
    if (previousDefaultAuth === undefined) delete process.env['GEMINI_DEFAULT_AUTH_TYPE'];
    else process.env['GEMINI_DEFAULT_AUTH_TYPE'] = previousDefaultAuth;
    if (previousGeminiKey === undefined) delete process.env['GEMINI_API_KEY'];
    else process.env['GEMINI_API_KEY'] = previousGeminiKey;
    if (previousGoogleKey === undefined) delete process.env['GOOGLE_API_KEY'];
    else process.env['GOOGLE_API_KEY'] = previousGoogleKey;
    if (previousGoogleGenAiKey === undefined) delete process.env['GOOGLE_GENAI_API_KEY'];
    else process.env['GOOGLE_GENAI_API_KEY'] = previousGoogleGenAiKey;
    if (previousGoogleGeminiBaseUrl === undefined) delete process.env['GOOGLE_GEMINI_BASE_URL'];
    else process.env['GOOGLE_GEMINI_BASE_URL'] = previousGoogleGeminiBaseUrl;
  });

  it('forces Gemini CLI API-key auth in the child environment', () => {
    process.env['GEMINI_DEFAULT_AUTH_TYPE'] = 'oauth-personal';
    process.env['GEMINI_API_KEY'] = 'real-user-key';
    process.env['GOOGLE_API_KEY'] = 'real-google-key';
    process.env['GOOGLE_GENAI_API_KEY'] = 'real-genai-key';
    process.env['GOOGLE_GEMINI_BASE_URL'] = 'https://example.invalid';

    const env = buildGeminiChildEnv(4567, 'proxy-token');

    expect(env['GOOGLE_GEMINI_BASE_URL']).toBe('http://127.0.0.1:4567');
    expect(env['GEMINI_API_KEY']).toBe('proxy-token');
    expect(env['GEMINI_DEFAULT_AUTH_TYPE']).toBe('gemini-api-key');
    expect(env['GOOGLE_API_KEY']).toBeUndefined();
    expect(env['GOOGLE_GENAI_API_KEY']).toBeUndefined();
  });

  it('uses a temporary Gemini CLI home with API-key auth selected', () => {
    const prepared = prepareGeminiChildEnv(4567, 'proxy-token');
    const cliHome = prepared.env['GEMINI_CLI_HOME'];

    expect(cliHome).toBeTruthy();
    expect(cliHome).toContain('relay-ai-gemini-');
    // Gemini CLI treats GEMINI_CLI_HOME as its home directory, so the
    // overlay settings must live at $GEMINI_CLI_HOME/.gemini/settings.json.
    const settings = JSON.parse(readFileSync(join(cliHome!, '.gemini', 'settings.json'), 'utf8'));
    expect(settings.security.auth.selectedType).toBe('gemini-api-key');

    prepared.cleanup();
    expect(existsSync(cliHome!)).toBe(false);
  });
});
