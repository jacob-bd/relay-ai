import { describe, expect, it } from 'vitest';
import { MAX_MODEL_CATALOG } from '../src/constants.js';
import {
  UnavailableSubagentModelError,
  augmentClaudeAgentTool,
  isClaudeAgentTool,
  normalizeClaudeAgentInput,
  type SubagentModelRouting,
} from '../src/subagent-model-routing.js';

function agentTool() {
  return {
    name: 'Agent',
    description: 'Launch a specialist agent',
    input_schema: {
      type: 'object',
      required: ['description', 'prompt', 'subagent_type'],
      properties: {
        description: { type: 'string' },
        prompt: { type: 'string' },
        subagent_type: { type: 'string' },
        model: { type: 'string', enum: ['sonnet', 'opus', 'haiku', 'fable'] },
      },
    },
  };
}

const routing: SubagentModelRouting = {
  parentModelId: 'anthropic-relay__qwen-3',
  models: [
    {
      id: 'anthropic-relay__qwen-3',
      compatibilityIds: ['relay:qwen', 'qwen-3'],
      displayName: 'Qwen 3',
    },
    {
      id: 'anthropic-relay__grok-4',
      compatibilityIds: ['relay:grok', 'grok-4'],
      displayName: 'Grok 4',
    },
    {
      id: 'claude-native__sonnet-4-6',
      compatibilityIds: ['claude-sonnet-4-6'],
      displayName: 'Claude Sonnet 4.6',
      family: 'sonnet',
    },
    {
      id: 'claude-native__sonnet-4-5',
      compatibilityIds: ['claude-sonnet-4-5'],
      displayName: 'Claude Sonnet 4.5',
      family: 'sonnet',
    },
  ],
};

describe('isClaudeAgentTool', () => {
  it('requires the Claude Agent name and characteristic schema fields', () => {
    expect(isClaudeAgentTool(agentTool())).toBe(true);
    expect(isClaudeAgentTool({ ...agentTool(), name: 'Delegate' })).toBe(false);
    expect(isClaudeAgentTool({ name: 'Agent', input_schema: { type: 'object' } })).toBe(false);
    expect(isClaudeAgentTool({
      name: 'Agent',
      description: 'Unrelated application agent',
      input_schema: {
        type: 'object',
        properties: { prompt: { type: 'string' } },
      },
    })).toBe(false);
  });
});

describe('normalizeClaudeAgentInput', () => {
  it.each([
    ['omitted', undefined],
    ['null', null],
    ['empty', ''],
    ['whitespace', '   '],
    ['inherit', 'inherit'],
  ])('inherits the exact parent id when model is %s', (_label, model) => {
    const input = model === undefined
      ? { prompt: 'inspect', subagent_type: 'general-purpose' }
      : { prompt: 'inspect', subagent_type: 'general-purpose', model };
    const result = normalizeClaudeAgentInput(input, routing);
    expect(result.input.model).toBe(routing.parentModelId);
    expect(result.decision).toEqual({
      kind: 'inherit',
      resolvedModelId: routing.parentModelId,
    });
  });

  it('leaves fork calls untouched', () => {
    const input = { prompt: 'continue', subagent_type: 'fork' };
    const result = normalizeClaudeAgentInput(input, routing);
    expect(result.input).toEqual(input);
    expect(result.decision).toEqual({ kind: 'fork' });
  });

  it('preserves an exact exposed catalog id', () => {
    const result = normalizeClaudeAgentInput({
      subagent_type: 'general-purpose',
      model: 'anthropic-relay__grok-4',
    }, routing);
    expect(result.input.model).toBe('anthropic-relay__grok-4');
    expect(result.decision.kind).toBe('explicit');
  });

  it('rewrites an exact compatibility id to the exposed id', () => {
    const result = normalizeClaudeAgentInput({
      subagent_type: 'general-purpose',
      model: 'relay:grok',
    }, routing);
    expect(result.input.model).toBe('anthropic-relay__grok-4');
    expect(result.decision).toEqual({
      kind: 'compatibility',
      requestedModelId: 'relay:grok',
      resolvedModelId: 'anthropic-relay__grok-4',
    });
  });

  it('resolves a built-in family to the first matching native model', () => {
    const result = normalizeClaudeAgentInput({
      subagent_type: 'general-purpose',
      model: 'sonnet',
    }, routing);
    expect(result.input.model).toBe('claude-native__sonnet-4-6');
    expect(result.decision).toEqual({
      kind: 'family',
      requestedModelId: 'sonnet',
      resolvedModelId: 'claude-native__sonnet-4-6',
    });
  });

  it('falls back to the parent when a built-in family is unavailable', () => {
    const result = normalizeClaudeAgentInput({
      subagent_type: 'general-purpose',
      model: 'haiku',
    }, routing);
    expect(result.input.model).toBe(routing.parentModelId);
    expect(result.decision).toEqual({
      kind: 'family-fallback',
      requestedModelId: 'haiku',
      resolvedModelId: routing.parentModelId,
    });
  });

  it('rejects an unavailable explicit selector with a 400-class error', () => {
    expect(() => normalizeClaudeAgentInput({
      subagent_type: 'general-purpose',
      model: 'claude-sonnet-5',
    }, routing)).toThrow(UnavailableSubagentModelError);
    try {
      normalizeClaudeAgentInput({
        subagent_type: 'general-purpose',
        model: 'claude-sonnet-5',
      }, routing);
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 400, selector: 'claude-sonnet-5' });
      expect((error as Error).message).toContain('anthropic-relay__qwen-3');
    }
  });

  it('rejects a non-string explicit selector instead of treating it as inheritance', () => {
    expect(() => normalizeClaudeAgentInput({
      subagent_type: 'general-purpose',
      model: 42,
    }, routing)).toThrow('42');
  });

  it('does not mutate the original input', () => {
    const input = { prompt: 'inspect', subagent_type: 'general-purpose' };
    normalizeClaudeAgentInput(input, routing);
    expect(input).toEqual({ prompt: 'inspect', subagent_type: 'general-purpose' });
  });

  it('bounds ids in unavailable-model errors', () => {
    const largeRouting: SubagentModelRouting = {
      parentModelId: 'model-0',
      models: Array.from({ length: MAX_MODEL_CATALOG + 3 }, (_, index) => ({
        id: `model-${index}`,
        compatibilityIds: [],
        displayName: `Model ${index}`,
      })),
    };
    try {
      normalizeClaudeAgentInput({ model: 'missing' }, largeRouting);
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain(`and 3 more`);
      expect(message).not.toContain(`model-${MAX_MODEL_CATALOG + 2}`);
    }
  });
});

describe('augmentClaudeAgentTool', () => {
  it('adds exposed ids to a small catalog without mutating the source schema', () => {
    const source = agentTool();
    const original = structuredClone(source);
    const augmented = augmentClaudeAgentTool(source, routing);
    const schema = augmented.input_schema as any;

    expect(schema.properties.model.enum).toEqual([
      'sonnet',
      'opus',
      'haiku',
      'fable',
      'anthropic-relay__qwen-3',
      'anthropic-relay__grok-4',
      'claude-native__sonnet-4-6',
      'claude-native__sonnet-4-5',
    ]);
    expect(augmented.description).toContain('Qwen 3: anthropic-relay__qwen-3');
    expect(augmented.description).toContain(`default: ${routing.parentModelId}`);
    expect(source).toEqual(original);
  });

  it('uses an unconstrained string and bounded guidance for a large catalog', () => {
    const largeRouting: SubagentModelRouting = {
      parentModelId: 'model-0',
      models: Array.from({ length: MAX_MODEL_CATALOG + 1 }, (_, index) => ({
        id: `model-${index}`,
        compatibilityIds: [],
        displayName: `Model ${index}`,
      })),
    };
    const augmented = augmentClaudeAgentTool(agentTool(), largeRouting);
    const modelProperty = (augmented.input_schema as any).properties.model;

    expect(modelProperty.type).toBe('string');
    expect(modelProperty.enum).toBeUndefined();
    expect(augmented.description).toContain('default: model-0');
    expect(augmented.description).not.toContain('model-20');
  });
});
