import { describe, expect, it } from 'vitest';
import {
  COMMANDCODE_BASE_URL,
  classifyProbeResponse,
  parseCommandCodeModels,
} from '../src/registry/fetch-commandcode-models.js';
import { PROVIDER_TEMPLATES } from '../src/provider-templates.js';
import { resolveEndpoint } from '../src/providers.js';

// Trimmed from the live GET /provider/v1/models response.
const PAYLOAD = {
  object: 'list',
  data: [
    { id: 'claude-sonnet-5', object: 'model', owned_by: 'command-code', name: 'Claude Sonnet 5', context_length: 1000000 },
    { id: 'claude-haiku-4-5-20251001', object: 'model', name: 'Claude Haiku 4.5', context_length: 200000 },
    { id: 'deepseek/deepseek-v4.1-flash', object: 'model', name: 'DeepSeek V4.1 Flash', context_length: 1000000 },
    { id: 'gpt-5.6-luna', object: 'model', name: 'GPT-5.6 Luna', context_length: 1050000 },
    { id: 'google/gemini-3.8-flash', object: 'model', name: 'Gemini 3.8 Flash', context_length: 1000000 },
  ],
};

const byId = (id: string) => {
  const model = parseCommandCodeModels(PAYLOAD, COMMANDCODE_BASE_URL).find(m => m.id === id);
  if (!model) throw new Error(`missing ${id}`);
  return model;
};

describe('parseCommandCodeModels', () => {
  it('routes Claude models to the Anthropic endpoint', () => {
    const model = byId('claude-sonnet-5');
    expect(model.modelFormat).toBe('anthropic');
    expect(model.npm).toBe('@ai-sdk/anthropic');
    expect(model.apiUrl).toBe(COMMANDCODE_BASE_URL);
  });

  it('routes every other model to the OpenAI endpoint', () => {
    for (const id of ['deepseek/deepseek-v4.1-flash', 'gpt-5.6-luna', 'google/gemini-3.8-flash']) {
      const model = byId(id);
      expect(model.modelFormat, id).toBe('openai');
      expect(model.npm, id).toBe('@ai-sdk/openai-compatible');
      expect(model.apiUrl, id).toBe(COMMANDCODE_BASE_URL);
    }
  });

  it('keeps provider display names verbatim', () => {
    expect(byId('claude-sonnet-5').name).toBe('Claude Sonnet 5');
    expect(byId('gpt-5.6-luna').name).toBe('GPT-5.6 Luna');
  });

  it('keeps the provider-reported context window', () => {
    expect(byId('claude-haiku-4-5-20251001').contextWindow).toBe(200000);
    expect(byId('deepseek/deepseek-v4.1-flash').contextWindow).toBe(1000000);
    expect(byId('gpt-5.6-luna').contextWindowSource).toBe('provider');
  });

  it('sends the catalog id upstream unchanged', () => {
    expect(byId('deepseek/deepseek-v4.1-flash').upstreamModelId).toBe('deepseek/deepseek-v4.1-flash');
  });

  it('falls back to the id when no display name is given', () => {
    const [model] = parseCommandCodeModels({ data: [{ id: 'x/y-z' }] }, COMMANDCODE_BASE_URL);
    expect(model?.name).toBe('x/y-z');
  });

  it('skips unusable rows instead of failing the whole catalog', () => {
    const models = parseCommandCodeModels(
      { data: [{ id: '' }, { name: 'no id' }, null, 'nope', { id: 'ok/model' }] },
      COMMANDCODE_BASE_URL,
    );
    expect(models.map(m => m.id)).toEqual(['ok/model']);
  });

  it('returns nothing for a malformed payload', () => {
    expect(parseCommandCodeModels(null, COMMANDCODE_BASE_URL)).toEqual([]);
    expect(parseCommandCodeModels({}, COMMANDCODE_BASE_URL)).toEqual([]);
  });
});

describe('Command Code routing lands on the right upstream URLs', () => {
  it('sends Claude models to /provider/v1/messages via the Anthropic SDK', () => {
    const model = byId('claude-sonnet-5');
    const endpoint = resolveEndpoint(model.npm!, model.apiUrl!);
    // The Anthropic SDK appends /v1/messages, so the base must stop before /v1.
    expect(endpoint).toEqual({ format: 'anthropic', baseUrl: 'https://api.commandcode.ai/provider' });
  });

  it('sends everything else to /provider/v1/chat/completions', () => {
    const model = byId('gpt-5.6-luna');
    const endpoint = resolveEndpoint(model.npm!, model.apiUrl!);
    expect(endpoint).toEqual({
      format: 'openai',
      completionsUrl: 'https://api.commandcode.ai/provider/v1/chat/completions',
    });
  });
});

describe('Command Code template', () => {
  it('is registered and addable with the Provider API base URL', () => {
    const template = PROVIDER_TEMPLATES.find(t => t.id === 'commandcode');
    expect(template).toBeDefined();
    expect(template?.supported).toBe(true);
    expect(template?.authType).toBe('api');
    expect(template?.defaultBaseUrl).toBe(COMMANDCODE_BASE_URL);
    expect(template?.modelSource).toBe('commandcode');
  });
});

describe('classifyProbeResponse', () => {
  const notInPlan = { error: { message: 'MODEL_NOT_IN_PLAN: Claude Sonnet 5 available in Pro and above plans' } };

  it('marks a plan-gated model unavailable', () => {
    expect(classifyProbeResponse(403, notInPlan)).toBe('not-in-plan');
  });

  it('keeps a model that answered', () => {
    expect(classifyProbeResponse(200, { choices: [] })).toBe('available');
  });

  it('keeps a model whose upstream is temporarily down', () => {
    // Command Code 503s when the underlying provider is overloaded. A model the
    // plan does include must not be dropped from the catalog over an outage.
    const outage = { error: { message: 'Upstream model provider is temporarily unavailable.' } };
    expect(classifyProbeResponse(503, outage)).toBe('unknown');
  });

  it('keeps a model on any other failure rather than guessing it is gated', () => {
    expect(classifyProbeResponse(429, { error: { message: 'rate limited' } })).toBe('unknown');
    expect(classifyProbeResponse(500, {})).toBe('unknown');
    expect(classifyProbeResponse(400, { error: { message: 'bad max_tokens' } })).toBe('available');
  });

  it('does not treat a bare 403 without the plan marker as gated', () => {
    expect(classifyProbeResponse(403, { error: { message: 'forbidden' } })).toBe('unknown');
  });
});
