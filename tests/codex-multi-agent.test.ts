import { describe, expect, it } from 'vitest';
import { renderMultiAgentV2Feature, supportsMultiAgentV2 } from '../src/codex/multi-agent.js';

describe('Codex multi-agent v2 runtime support', () => {
  it('renders the feature shape required for model overrides', () => {
    expect(renderMultiAgentV2Feature()).toBe(
      '[features]\nmulti_agent_v2 = { enabled = true, max_concurrent_threads_per_session = 6, expose_spawn_agent_model_overrides = true }\n',
    );
  });

  it('accepts a runtime that loads the probe config', () => {
    expect(supportsMultiAgentV2('/tmp/codex', () => ({ stdout: '', stderr: 'Not logged in' }))).toBe(true);
  });

  it('rejects a runtime that reports a configuration error', () => {
    expect(supportsMultiAgentV2('/tmp/codex', () => ({ stdout: '', stderr: 'Error loading configuration: unknown field' }))).toBe(false);
  });
});
