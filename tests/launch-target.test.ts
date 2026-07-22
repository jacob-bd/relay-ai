import { describe, it, expect } from 'vitest';
import {
  findProviderAndModel,
  hasCompleteExplicitLaunch,
  isClaudeMachineReadableOutput,
  isClaudePrintMode,
  isCodexMachineReadableOutput,
  isCodexNonInteractive,
  launchAllowsNonTty,
  normalizeClaudeAgentArgs,
  parseModelSlug,
  planLaunchWizard,
  resolveLaunchTarget,
  wantsCleanAgentStdout,
} from '../src/launch-target.js';
import type { LocalProvider } from '../src/types.js';

const providers: LocalProvider[] = [
  {
    id: 'zen',
    name: 'OpenCode Zen',
    apiKey: 'key',
    models: [{ id: 'deepseek-v4-flash-free', name: 'DeepSeek', family: 'deepseek', brand: 'DeepSeek', modelFormat: 'openai', upstreamModelId: 'deepseek-v4-flash-free' }],
  },
  {
    id: 'groq',
    name: 'Groq',
    apiKey: 'key',
    models: [{ id: 'llama-3.3-70b', name: 'Llama', family: 'llama', brand: 'Meta', modelFormat: 'openai', upstreamModelId: 'llama-3.3-70b' }],
  },
];

describe('launch-target', () => {
  it('parses provider__model slug', () => {
    expect(parseModelSlug('zen__deepseek-v4-flash-free')).toEqual({
      providerId: 'zen',
      modelId: 'deepseek-v4-flash-free',
    });
    expect(parseModelSlug('llama-3.3-70b')).toEqual({ modelId: 'llama-3.3-70b' });
  });

  it('detects claude print mode', () => {
    expect(isClaudePrintMode(['-p', 'hello'])).toBe(true);
    expect(isClaudePrintMode(['--print', 'hello'])).toBe(true);
    expect(isClaudePrintMode(['-c'])).toBe(false);
  });

  it('detects codex non-interactive args', () => {
    expect(isCodexNonInteractive(['exec', 'fix bug'])).toBe(true);
    expect(isCodexNonInteractive(['fix bug'])).toBe(true);
    expect(isCodexNonInteractive(['-s', 'danger-full-access'])).toBe(false);
  });

  it('resolves explicit slug-only model', () => {
    expect(hasCompleteExplicitLaunch({ modelId: 'zen__deepseek-v4-flash-free' })).toBe(true);
    const target = resolveLaunchTarget(
      { modelId: 'zen__deepseek-v4-flash-free' },
      {},
      'codex',
    );
    expect(target).toEqual({ providerId: 'zen', modelId: 'deepseek-v4-flash-free' });
  });

  it('finds provider and model in catalog', () => {
    const found = findProviderAndModel(providers, { providerId: 'groq', modelId: 'llama-3.3-70b' });
    expect(found?.provider.id).toBe('groq');
    expect(found?.model.id).toBe('llama-3.3-70b');
  });

  it('skips wizard when explicit provider and model are set', () => {
    const plan = planLaunchWizard({
      explicit: { providerId: 'zen', modelId: 'deepseek-v4-flash-free' },
      childArgs: [],
      agent: 'codex',
      prefs: {},
    });
    expect(plan.skip).toBe(true);
    expect(plan.target).toEqual({ providerId: 'zen', modelId: 'deepseek-v4-flash-free' });
  });

  it('skips wizard in print mode using saved prefs', () => {
    const plan = planLaunchWizard({
      explicit: {},
      childArgs: ['-p', 'review file'],
      agent: 'claude',
      prefs: { lastProvider: 'groq', lastModel: 'llama-3.3-70b' },
    });
    expect(plan.skip).toBe(true);
    expect(plan.target).toEqual({ providerId: 'groq', modelId: 'llama-3.3-70b' });
  });

  it('errors in print mode without prefs or explicit launch', () => {
    const plan = planLaunchWizard({
      explicit: {},
      childArgs: ['--print', 'hello'],
      agent: 'claude',
      prefs: {},
    });
    expect(plan.skip).toBe(false);
    expect(plan.error).toContain('Print mode requires');
  });

  it('detects machine-readable claude and codex output', () => {
    expect(isClaudeMachineReadableOutput(['-p', 'hi', '--output-format', 'stream-json'])).toBe(true);
    expect(isClaudeMachineReadableOutput(['-p', 'hi', '--output-format', 'text'])).toBe(false);
    expect(isClaudeMachineReadableOutput(['-p', 'hi', '--output-format=json'])).toBe(true);
    expect(isCodexMachineReadableOutput(['exec', '--json', 'hi'])).toBe(true);
    expect(isCodexMachineReadableOutput(['exec', 'hi'])).toBe(false);
    expect(wantsCleanAgentStdout('claude', ['-p', 'x', '--output-format', 'stream-json'])).toBe(true);
    expect(wantsCleanAgentStdout('codex', ['exec', '--json', 'x'])).toBe(true);
  });

  it('adds --verbose for claude stream-json print mode', () => {
    expect(normalizeClaudeAgentArgs(['-p', 'hi', '--output-format', 'stream-json'])).toContain('--verbose');
    expect(normalizeClaudeAgentArgs(['-p', 'hi', '--output-format', 'json'])).not.toContain('--verbose');
  });

  describe('launchAllowsNonTty', () => {
    it('allows a launch when boot flags resolved a target', () => {
      expect(launchAllowsNonTty({ skip: true, target: { providerId: 'go', modelId: 'kimi-k3' } })).toBe(true);
    });

    it('disallows a launch that would open the interactive wizard', () => {
      expect(launchAllowsNonTty({ skip: false, target: null })).toBe(false);
    });

    it('disallows when skip is set but no target was resolved', () => {
      expect(launchAllowsNonTty({ skip: true, target: null })).toBe(false);
    });

    it('allows when the caller bypasses the wizard (e.g. http-proxy)', () => {
      expect(launchAllowsNonTty({ skip: true, target: null }, true)).toBe(true);
      expect(launchAllowsNonTty({ skip: false, target: null }, true)).toBe(true);
    });
  });
});
