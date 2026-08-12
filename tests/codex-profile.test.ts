import { describe, expect, it } from 'vitest';
import { parse } from 'smol-toml';
import { buildCodexMixedProfileToml } from '../src/codex/profile.js';

describe('Codex mixed profile', () => {
  it('defines the Relay provider used by model-only Sub-agent definitions', () => {
    const text = buildCodexMixedProfileToml({
      model: 'openrouter__gpt-5.5',
      catalogPath: '/tmp/models-mixed.json',
      baseUrl: 'http://127.0.0.1:12345/_relay-codex/token/v1',
      multiAgentV2Enabled: true,
    });

    expect(text).toContain('model_provider = "openai"');
    expect(text).toContain('[model_providers.relay-ai]');
    expect(text).toContain('base_url = "http://127.0.0.1:12345/_relay-codex/token/v1"');
    expect(text).toContain('env_key = "RELAY_AI_CODEX_KEY"');
    expect(text).toContain('[features]');
    expect(text).toContain('multi_agent_v2 = { enabled = true');
    expect(text).not.toContain('[agents.');
    expect(text).not.toContain('config_file');
    expect(parse(text)).toMatchObject({
      features: { multi_agent_v2: { enabled: true, expose_spawn_agent_model_overrides: true } },
      model_providers: { 'relay-ai': { base_url: 'http://127.0.0.1:12345/_relay-codex/token/v1' } },
    });
  });
});
