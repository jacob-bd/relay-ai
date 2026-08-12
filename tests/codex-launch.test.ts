import { describe, it, expect } from 'vitest';
import { buildCodexChildEnv, ensureCodexSandboxArgs, selectCodexBinary, stripCodexInheritedEnv } from '../src/codex/launch.js';

describe('stripCodexInheritedEnv', () => {
  it('removes CI flags that trigger Codex read-only sandbox', () => {
    const env = stripCodexInheritedEnv({
      CI: '1',
      CODEX_CI: '1',
      GITHUB_ACTIONS: 'true',
      HOME: '/Users/me',
    });
    expect(env['CI']).toBeUndefined();
    expect(env['CODEX_CI']).toBeUndefined();
    expect(env['GITHUB_ACTIONS']).toBeUndefined();
    expect(env['HOME']).toBe('/Users/me');
  });
});

describe('ensureCodexSandboxArgs', () => {
  it('injects danger-full-access when no sandbox flag is present', () => {
    expect(ensureCodexSandboxArgs(['exec', 'hello'])).toEqual([
      '-s',
      'danger-full-access',
      'exec',
      'hello',
    ]);
  });

  it('preserves user-provided -s flag', () => {
    expect(ensureCodexSandboxArgs(['-s', 'workspace-write', 'exec'])).toEqual([
      '-s',
      'workspace-write',
      'exec',
    ]);
  });

  it('preserves --dangerously-bypass-approvals-and-sandbox', () => {
    expect(ensureCodexSandboxArgs(['--dangerously-bypass-approvals-and-sandbox'])).toEqual([
      '--dangerously-bypass-approvals-and-sandbox',
    ]);
  });
});

describe('buildCodexChildEnv', () => {
  it('sets RELAY_AI_CODEX_KEY for proxy tier', () => {
    const env = buildCodexChildEnv({
      tier: 'proxy',
      npm: '@ai-sdk/xai',
      upstreamModelId: 'grok-3',
      apiKey: 'secret',
      modelId: 'grok-3',
      providerId: 'xai',
    }, 12345);
    expect(env['RELAY_AI_CODEX_KEY']).toBe('proxy-local');
    expect(env['CI']).toBeUndefined();
  });

  it('provides the Relay proxy credential for mixed-mode agent providers', () => {
    const env = buildCodexChildEnv({
      tier: 'proxy', npm: '@ai-sdk/xai', upstreamModelId: 'grok-3', apiKey: 'relay-secret', modelId: 'kilo__auto', providerId: 'kilo',
    }, 12345, { mixedNative: true });
    expect(env['RELAY_AI_CODEX_KEY']).toBe('proxy-local');
    expect(env['XAI_API_KEY']).toBeUndefined();
  });
});

describe('selectCodexBinary', () => {
  it('skips broken Codex wrappers and chooses the first runnable binary', () => {
    expect(selectCodexBinary(
      ['/opt/homebrew/bin/codex', '/Users/me/.nvm/bin/codex'],
      () => true,
      path => path.includes('.nvm'),
    )).toBe('/Users/me/.nvm/bin/codex');
  });
});
