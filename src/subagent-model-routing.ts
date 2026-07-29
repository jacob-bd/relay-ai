import { MAX_MODEL_CATALOG } from './constants.js';
import type { AnthropicToolDefinition } from './proxy-types.js';
import { appendSubagentRouteMarker } from './subagent-route-registry.js';

export type ClaudeModelFamily = 'sonnet' | 'opus' | 'haiku' | 'fable';

export interface SubagentModelOption {
  id: string;
  compatibilityIds: string[];
  displayName: string;
  family?: ClaudeModelFamily;
}

export interface SubagentModelRouting {
  parentModelId: string;
  models: SubagentModelOption[];
  registerSubagentRoute?: (modelId: string) => string;
}

export type SubagentRoutingDecision =
  | { kind: 'inherit'; resolvedModelId: string }
  | { kind: 'compatibility'; requestedModelId: string; resolvedModelId: string }
  | { kind: 'family'; requestedModelId: ClaudeModelFamily; resolvedModelId: string }
  | { kind: 'family-fallback'; requestedModelId: ClaudeModelFamily; resolvedModelId: string }
  | { kind: 'explicit'; resolvedModelId: string }
  | { kind: 'fork' };

export interface NormalizedSubagentInput {
  input: Record<string, unknown>;
  decision: SubagentRoutingDecision;
}

const CLAUDE_MODEL_FAMILIES: ClaudeModelFamily[] = ['sonnet', 'opus', 'haiku', 'fable'];
const CLAUDE_MODEL_FAMILY_SET = new Set<string>(CLAUDE_MODEL_FAMILIES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function claudeModelFamily(modelId: string): ClaudeModelFamily | undefined {
  const normalized = modelId.toLowerCase();
  if (!normalized.startsWith('claude-')) return undefined;
  return CLAUDE_MODEL_FAMILIES.find(family => normalized.includes(family));
}

export function isClaudeAgentTool(tool: AnthropicToolDefinition): boolean {
  if (tool.name !== 'Agent' || !isRecord(tool.input_schema)) return false;
  const properties = tool.input_schema.properties;
  if (!isRecord(properties)) return false;
  return ['description', 'prompt', 'subagent_type'].every(name => isRecord(properties[name]));
}

export class UnavailableSubagentModelError extends Error {
  readonly statusCode = 400;

  constructor(
    readonly selector: string,
    routing: SubagentModelRouting,
  ) {
    const visible = routing.models.slice(0, MAX_MODEL_CATALOG).map(model => model.id);
    const omitted = routing.models.length - visible.length;
    const suffix = omitted > 0 ? `, and ${omitted} more` : '';
    super(
      `Subagent model "${selector}" is unavailable in this Relay AI session. `
      + `Available model ids: ${visible.join(', ')}${suffix}.`,
    );
    this.name = 'UnavailableSubagentModelError';
  }
}

export function normalizeClaudeAgentInput(
  input: unknown,
  routing: SubagentModelRouting,
): NormalizedSubagentInput {
  const source = isRecord(input) ? input : {};
  const normalized = { ...source };

  if (source.subagent_type === 'fork') {
    return { input: normalized, decision: { kind: 'fork' } };
  }

  const rawModel = source.model;
  if (rawModel == null) {
    normalized.model = routing.parentModelId;
    return {
      input: normalized,
      decision: { kind: 'inherit', resolvedModelId: routing.parentModelId },
    };
  }
  if (typeof rawModel !== 'string') {
    throw new UnavailableSubagentModelError(String(rawModel), routing);
  }
  const selector = rawModel.trim();
  if (selector === '' || selector === 'inherit') {
    normalized.model = routing.parentModelId;
    return {
      input: normalized,
      decision: { kind: 'inherit', resolvedModelId: routing.parentModelId },
    };
  }

  const exposed = routing.models.find(model => model.id === selector);
  if (exposed) {
    normalized.model = exposed.id;
    return {
      input: normalized,
      decision: { kind: 'explicit', resolvedModelId: exposed.id },
    };
  }

  const compatible = routing.models.find(model => model.compatibilityIds.includes(selector));
  if (compatible) {
    normalized.model = compatible.id;
    return {
      input: normalized,
      decision: {
        kind: 'compatibility',
        requestedModelId: selector,
        resolvedModelId: compatible.id,
      },
    };
  }

  if (CLAUDE_MODEL_FAMILY_SET.has(selector)) {
    const family = selector as ClaudeModelFamily;
    const nativeModel = routing.models.find(model => model.family === family);
    const resolvedModelId = nativeModel?.id ?? routing.parentModelId;
    normalized.model = resolvedModelId;
    return {
      input: normalized,
      decision: nativeModel
        ? { kind: 'family', requestedModelId: family, resolvedModelId }
        : { kind: 'family-fallback', requestedModelId: family, resolvedModelId },
    };
  }

  throw new UnavailableSubagentModelError(selector, routing);
}

export function prepareClaudeAgentInput(
  input: unknown,
  routing: SubagentModelRouting,
): NormalizedSubagentInput {
  const normalized = normalizeClaudeAgentInput(input, routing);
  const decision = normalized.decision;
  if (decision.kind === 'fork') return normalized;
  if (!routing.registerSubagentRoute) return normalized;
  const prompt = normalized.input.prompt;
  if (typeof prompt !== 'string') return normalized;

  const token = routing.registerSubagentRoute(decision.resolvedModelId);
  const clientInput = { ...normalized.input };
  const target = routing.models.find(model => model.id === decision.resolvedModelId);
  if (target?.family) clientInput.model = target.family;
  else delete clientInput.model;
  clientInput.prompt = appendSubagentRouteMarker(prompt, token);

  return { input: clientInput, decision };
}

export function augmentClaudeAgentTool(
  tool: AnthropicToolDefinition,
  routing: SubagentModelRouting,
): AnthropicToolDefinition {
  const inputSchema = isRecord(tool.input_schema) ? tool.input_schema : {};
  const properties = isRecord(inputSchema.properties) ? inputSchema.properties : {};
  const originalModel = isRecord(properties.model) ? properties.model : {};
  const smallCatalog = routing.models.length <= MAX_MODEL_CATALOG;

  const modelProperty: Record<string, unknown> = {
    ...originalModel,
    type: 'string',
  };
  if (smallCatalog) {
    const originalEnum = Array.isArray(originalModel.enum)
      ? originalModel.enum.filter((value): value is string => typeof value === 'string')
      : CLAUDE_MODEL_FAMILIES;
    modelProperty.enum = [...new Set([...originalEnum, ...routing.models.map(model => model.id)])];
  } else {
    delete modelProperty.enum;
  }

  const guidance = smallCatalog
    ? `Relay AI subagent model routing (default: ${routing.parentModelId}). `
      + routing.models.map(model => `${model.displayName}: ${model.id}`).join('; ')
    : `Relay AI subagent model routing (default: ${routing.parentModelId}). `
      + 'Other explicit model values must be exact ids from the current session catalog.';

  return {
    ...tool,
    description: [tool.description?.trim(), guidance].filter(Boolean).join('\n\n'),
    input_schema: {
      ...inputSchema,
      properties: {
        ...properties,
        model: modelProperty,
      },
    },
  };
}
