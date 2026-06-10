import { describe, expect, it } from 'vitest';
import { createGatewayModelCatalog, formatGatewayAnthropicModels } from '../src/server/models.js';
import type { ServerModelInfo } from '../src/server/models.js';
import { maskGatewayModelId, unmaskGatewayModelId } from '../src/server/vendor-mask.js';

function model(partial: Partial<ServerModelInfo> & Pick<ServerModelInfo, 'id'>): ServerModelInfo {
  return {
    name: partial.name ?? partial.id,
    isFree: false,
    brand: 'DeepSeek',
    sourceBackend: 'zen',
    modelFormat: 'openai',
    providerId: 'zen',
    providerLabel: 'OpenCode Zen',
    ...partial,
  };
}

describe('gateway id masking', () => {
  it('reverses provider slug and model suffix', () => {
    expect(maskGatewayModelId('anthropic-opencode-zen__deepseek-v4-flash-free'))
      .toBe('anthropic-nez-edocnepo__eerf-hsalf-4v-keespeed');
    expect(maskGatewayModelId('anthropic-openai__gpt-5.5-fast'))
      .toBe('anthropic-ianepo__tsaf-5.5-tpg');
  });

  it('is self-inverse', () => {
    const original = 'anthropic-google__gemini-3.5-flash';
    const masked = maskGatewayModelId(original);
    expect(unmaskGatewayModelId(masked)).toBe(original);
  });

  it('leaves claude ids unchanged', () => {
    expect(maskGatewayModelId('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });

  it('exposes masked ids in discovery while resolving chat requests', () => {
    const models = [
      model({ id: 'big-pickle', name: 'Big Pickle', brand: 'Other' }),
      model({ id: 'deepseek-v4-flash-free', name: 'DeepSeek V4 Flash Free' }),
    ];
    const catalog = createGatewayModelCatalog(models, { maskGatewayIds: true });
    const listed = formatGatewayAnthropicModels(models, { maskGatewayIds: true });

    const maskedDeepseek = 'anthropic-nez__eerf-hsalf-4v-keespeed';
    expect(listed.data.map(entry => entry.id)).toEqual([
      'anthropic-nez__elkcip-gib',
      maskedDeepseek,
    ]);
    expect(listed.data[1]!.display_name).toBe('DeepSeek V4 Flash Free (OpenCode Zen)');
    expect(catalog.get(maskedDeepseek)?.id).toBe('deepseek-v4-flash-free');
  });

  it('masks openai-only provider slug so Desktop discovery works', () => {
    const openai = model({
      id: 'gpt-5.5-fast',
      name: 'GPT-5.5 Fast',
      providerId: 'openai',
      providerLabel: 'OpenAI',
      sourceBackend: 'zen',
    });
    const listed = formatGatewayAnthropicModels([openai], { maskGatewayIds: true });
    expect(listed.data[0]!.id).toBe('anthropic-ianepo__tsaf-5.5-tpg');
    expect(listed.data[0]!.display_name).toBe('GPT-5.5 Fast (OpenAI)');
    expect(listed.data[0]!.id).not.toContain('openai');
    expect(listed.data[0]!.id).not.toContain('gpt');
  });
});
