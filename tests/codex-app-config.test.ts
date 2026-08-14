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
import { restoreCodexAppOverlay } from '../src/codex/app-session.js';
import { getBackupsDir } from '../src/codex/session.js';
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

  // The catalog id can differ from the id sent upstream. Classifying the route
  // by the alias loses the upstream model's real levels, and this merge then
  // rewrites the user's saved effort to the wrong model's default.
  it('keeps a saved xhigh effort for an alias route whose upstream supports it', () => {
    const configPath = join(home, '.codex', 'config.toml');
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(configPath, 'model_reasoning_effort = "xhigh"\n', 'utf8');
    const spec = proxySpec(join(home, '.relay-ai', 'codex', 'app-models-openai.json'));
    spec.route.npm = '@ai-sdk/openai';
    spec.route.providerId = 'openai';
    spec.route.modelId = 'gpt-5.5-fast';
    spec.route.upstreamModelId = 'gpt-5.5';

    applyAppConfigPatch(spec, configPath);
    expect(readFileSync(configPath, 'utf8')).toContain('model_reasoning_effort = "xhigh"');
  });

  it('still corrects a saved effort the upstream model does not support', () => {
    const configPath = join(home, '.codex', 'config.toml');
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(configPath, 'model_reasoning_effort = "none"\n', 'utf8');
    const spec = proxySpec(join(home, '.relay-ai', 'codex', 'app-models-openai.json'));
    spec.route.npm = '@ai-sdk/openai';
    spec.route.providerId = 'openai';
    spec.route.modelId = 'pro-alias';
    spec.route.upstreamModelId = 'gpt-5.5-pro';   // documented: medium/high/xhigh, default high

    applyAppConfigPatch(spec, configPath);
    expect(readFileSync(configPath, 'utf8')).toContain('model_reasoning_effort = "high"');
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

  it('accepts the capability-protected mixed proxy base URL', () => {
    const configPath = join(home, '.codex', 'config.toml');
    const spec = proxySpec('/tmp/app-models-mixed.json');
    spec.proxyBaseUrl = 'http://127.0.0.1:54321/_relay-codex/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/v1';
    applyAppConfigPatch(spec, configPath);
    expect(readFileSync(configPath, 'utf8')).toContain(spec.proxyBaseUrl);
    expect(isAppManagedConfig(readFileSync(configPath, 'utf8'))).toBe(true);
  });

  it('enables multi-agent v2 for mixed desktop launches and restores it', () => {
    const configPath = join(home, '.codex', 'config.toml');
    mkdirSync(join(home, '.codex'), { recursive: true });
    const before = 'model = "gpt-5.6-sol"\nmodel_provider = "openai"\n';
    writeFileSync(configPath, before, 'utf8');
    const state = captureRestoreState(before);
    const spec = proxySpec('/tmp/app-models-mixed.json');
    spec.multiAgentV2Enabled = true;
    applyAppConfigPatch(spec, configPath);
    const patched = readFileSync(configPath, 'utf8');
    expect(patched).toContain('[features.multi_agent_v2]');
    expect(patched).toContain('enabled = true');
    restoreConfigFromState(state, configPath);
    expect(readFileSync(configPath, 'utf8')).not.toContain('multi_agent_v2');
  });

  it('does not inject temporary agent registrations into the desktop config', () => {
    const configPath = join(home, '.codex', 'config.toml');
    mkdirSync(join(home, '.codex'), { recursive: true });
    applyAppConfigPatch(proxySpec('/tmp/app-models-mixed.json'), configPath);
    expect(readFileSync(configPath, 'utf8')).not.toContain('[agents.');
  });

  it('restores the newest config backup when an app overlay is orphaned', () => {
    const configPath = join(home, '.codex', 'config.toml');
    const backupDir = getBackupsDir();
    mkdirSync(join(home, '.codex'), { recursive: true });
    mkdirSync(backupDir, { recursive: true });

    const original = 'model = "gpt-5.6-sol"\nmodel_provider = "openai"\n';
    writeFileSync(join(backupDir, 'config.toml.older.bak'), 'model = "gpt-5.5"\n', 'utf8');
    writeFileSync(join(backupDir, 'config.toml.newer.bak'), original, 'utf8');
    writeFileSync(configPath, [
      'model = "go__glm-5.2"',
      'model_provider = "openai"',
      'openai_base_url = "http://127.0.0.1:54321/_relay-codex/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/v1"',
      'model_catalog_json = "/tmp/app-models-mixed.json"',
      '',
    ].join('\n'), 'utf8');

    const result = restoreCodexAppOverlay();

    expect(result.restored).toBe(true);
    expect(readFileSync(configPath, 'utf8')).toBe(original);
  });
});
