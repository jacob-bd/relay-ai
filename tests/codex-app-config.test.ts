import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyAppConfigPatch,
  captureRestoreState,
  isAppManagedConfig,
  restoreConfigFromState,
  previewAppConfigToml,
} from '../src/codex/app-config.js';
import { CODEX_APP_PROVIDER_ID, CODEX_APP_AUTO_COMPACT_RATIO } from '../src/codex/app-profile.js';
import type { CodexAppConfigSpec } from '../src/codex/app-profile.js';

describe('app-config', () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-codex-app-'));
    prevHome = process.env.HOME;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.RELAY_AI_HOME = join(home, '.relay-ai');
  });

  afterEach(() => {
    if (prevHome) process.env.HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  const proxySpec = (catalogPath: string): CodexAppConfigSpec => ({
    route: {
      tier: 'proxy',
      npm: '@ai-sdk/anthropic',
      apiKey: 'sk-test',
      upstreamModelId: 'claude-sonnet-4-6',
      modelId: 'claude-sonnet-4-6',
      providerId: 'anthropic',
    },
    proxyPort: 54321,
    catalogPath,
  });

  it('patches config and marks app-managed', () => {
    const configPath = join(home, '.codex', 'config.toml');
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(configPath, 'sandbox = "workspace-write"\nmodel_reasoning_effort = "high"\n', 'utf8');
    const catalog = join(home, '.relay-ai', 'codex', 'app-models-anthropic.json');
    applyAppConfigPatch(proxySpec(catalog), configPath);
    const text = readFileSync(configPath, 'utf8');
    expect(isAppManagedConfig(text)).toBe(true);
    expect(text).toContain('sandbox = "workspace-write"');
    expect(text).toContain('model_provider = "openai"');
    expect(text).toContain('openai_base_url = "http://127.0.0.1:54321/v1"');
    expect(text).toContain('127.0.0.1:54321');
    expect(text).toContain('model = "claude-sonnet-4-6"');
    expect(text).not.toContain(`[model_providers.${CODEX_APP_PROVIDER_ID}]`);
    expect(text).toContain('model_reasoning_effort = "high"');
  });

  it('sets the auto-compact threshold from the context window and ratio', () => {
    const configPath = join(home, '.codex', 'config.toml');
    mkdirSync(join(home, '.codex'), { recursive: true });
    const spec = proxySpec(join(home, '.relay-ai', 'codex', 'app-models-anthropic.json'));
    spec.route.contextWindow = 200_000;

    applyAppConfigPatch(spec, configPath);

    const text = readFileSync(configPath, 'utf8');
    expect(text).toContain('model_context_window = 200000');
    expect(text).toContain(`model_auto_compact_token_limit = ${Math.floor(200_000 * CODEX_APP_AUTO_COMPACT_RATIO)}`);
  });

  it('restore state round-trips model_reasoning_effort', () => {
    const configPath = join(home, '.codex', 'config.toml');
    const before = 'model = "gpt-5"\nmodel_provider = "openai"\nmodel_reasoning_effort = "high"\n';
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(configPath, before, 'utf8');
    const state = captureRestoreState(before);
    expect(state.hadModelReasoningEffort).toBe(true);
    applyAppConfigPatch(proxySpec('/tmp/catalog.json'), configPath);
    restoreConfigFromState(state, configPath);
    const after = readFileSync(configPath, 'utf8');
    expect(after).toContain('model_reasoning_effort = "high"');
  });

  it('restore state round-trips original keys', () => {
    const configPath = join(home, '.codex', 'config.toml');
    const before = 'model = "gpt-5"\nmodel_provider = "openai"\n';
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(configPath, before, 'utf8');
    const state = captureRestoreState(before);
    applyAppConfigPatch(proxySpec('/tmp/catalog.json'), configPath);
    restoreConfigFromState(state, configPath);
    const after = readFileSync(configPath, 'utf8');
    expect(after).toContain('model = "gpt-5"');
    expect(after).toContain('model_provider = "openai"');
    expect(isAppManagedConfig(after)).toBe(false);
  });

  it('restore state round-trips openai_base_url', () => {
    const configPath = join(home, '.codex', 'config.toml');
    const before = 'model = "gpt-5"\nmodel_provider = "openai"\nopenai_base_url = "https://example.test/v1"\n';
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(configPath, before, 'utf8');
    const state = captureRestoreState(before);
    applyAppConfigPatch(proxySpec('/tmp/catalog.json'), configPath);
    restoreConfigFromState(state, configPath);
    const after = readFileSync(configPath, 'utf8');
    expect(after).toContain('openai_base_url = "https://example.test/v1"');
  });

  it('preserves openai_base_url when restoring a legacy snapshot', () => {
    const configPath = join(home, '.codex', 'config.toml');
    const managed = [
      'model = "relay-ai-launch-codex-app/claude-sonnet-4-6"',
      'model_provider = "relay-ai-launch-codex-app"',
      'model_catalog_json = "/tmp/app-models-anthropic.json"',
      'openai_base_url = "https://example.test/v1"',
      '',
      '[model_providers.relay-ai-launch-codex-app]',
      'name = "relay-ai"',
      'base_url = "http://127.0.0.1:54321/v1"',
      'wire_api = "responses"',
      '',
    ].join('\n');
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(configPath, managed, 'utf8');
    restoreConfigFromState({
      hadProfile: false,
      hadModel: true,
      model: 'gpt-5',
      hadModelProvider: true,
      modelProvider: 'openai',
      hadModelCatalogJson: false,
      hadModelReasoningEffort: false,
    }, configPath);
    const after = readFileSync(configPath, 'utf8');
    expect(after).toContain('openai_base_url = "https://example.test/v1"');
  });

  it('writes favorites slug as model field', () => {
    const configPath = join(home, '.codex', 'config.toml');
    mkdirSync(join(home, '.codex'), { recursive: true });
    const spec: CodexAppConfigSpec = {
      route: {
        tier: 'proxy',
        npm: '@ai-sdk/openai-compatible',
        apiKey: 'sk-test',
        upstreamModelId: 'big-pickle',
        modelId: 'zen__big-pickle',
        providerId: 'zen',
      },
      proxyPort: 54321,
      catalogPath: '/tmp/favorites-catalog.json',
    };
    applyAppConfigPatch(spec, configPath);
    const text = readFileSync(configPath, 'utf8');
    expect(text).toContain('model = "zen__big-pickle"');
  });

  it('preview validates without writing', () => {
    const toml = previewAppConfigToml(proxySpec('/tmp/c.json'));
    expect(toml).toContain('model_provider = "openai"');
    expect(toml).toContain('openai_base_url = "http://127.0.0.1:54321/v1"');
    expect(existsSync(join(home, '.codex', 'config.toml'))).toBe(false);
  });
});
