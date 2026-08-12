import { describe, expect, it } from 'vitest';
import { validateNativeCodexCatalog, captureNativeCodexCatalog } from '../src/codex/native-catalog.js';

const model = {
  slug: 'gpt-5.5',
  display_name: 'GPT-5.5',
  supported_reasoning_levels: [],
  default_reasoning_level: 'high',
  default_reasoning_summary: 'auto',
  shell_type: 'default',
  visibility: 'list',
  supported_in_api: true,
  priority: 1,
  availability_nux: null,
  upgrade: null,
  base_instructions: 'native',
  supports_reasoning_summaries: true,
  support_verbosity: false,
  default_verbosity: null,
  apply_patch_tool_type: null,
  truncation_policy: { mode: 'tokens', limit: 1000 },
  supports_parallel_tool_calls: true,
  experimental_supported_tools: [],
  unknown_native_field: { keep: true },
};

describe('native Codex catalog', () => {
  it('validates and preserves unknown native fields', () => {
    const catalog = validateNativeCodexCatalog({ models: [model] });
    expect(catalog.models[0]).toEqual(model);
  });

  it('captures a valid catalog from an injected exact-binary runner', async () => {
    const snapshot = await captureNativeCodexCatalog({
      target: 'cli',
      binaryPath: '/tmp/codex',
      codexVersion: 'codex-cli 0.1.0',
      run: async args => {
        expect(args).toEqual(['debug', 'models']);
        return JSON.stringify({ models: [model] });
      },
    });
    expect(snapshot.target).toBe('cli');
    expect(snapshot.source).toBe('refreshed');
    expect(snapshot.models[0]).toEqual(model);
  });

  it('rejects empty or malformed catalogs', () => {
    expect(() => validateNativeCodexCatalog({ models: [] })).toThrow(/no models/i);
    expect(() => validateNativeCodexCatalog({ models: [{ slug: 'bad' }] })).toThrow(/invalid/i);
  });
});
