// src/server/models.ts
import { resolveContextWindow } from '../context-window.js';
import { aliasModelId } from '../proxy.js';
import { maskGatewayModelId } from './vendor-mask.js';

export interface GatewayModelOptions {
  maskGatewayIds?: boolean;
}

export type ServerModelFormat = 'anthropic' | 'openai' | 'cloud-code' | 'unsupported';
export type ServerBackendId = 'zen' | 'go';
export type ServerModelSource = ServerBackendId | 'vertex' | (string & {});

export interface ServerModelInfo {
  id: string;
  name: string;
  isFree: boolean;
  brand: string;
  sourceBackend: ServerModelSource;
  modelFormat: ServerModelFormat;
  /** Wire id sent to the upstream API; may differ from catalog id. */
  upstreamModelId?: string;
  cost?: {
    input: number;
    output: number;
    cache_read?: number;
    cache_write?: number;
  };
  baseUrl?: string;        // anthropic-format: direct Anthropic-protocol URL (without /v1)
  completionsUrl?: string; // openai-format: full chat completions endpoint URL
  npm?: string;            // OpenCode api.npm — openai-format models route through the SDK adapter
  apiBaseUrl?: string;     // base URL for openai-compatible / openrouter SDK providers
  apiKey?: string;         // model-specific API key; overrides server-level apiKey if set; never returned in API responses
  authType?: 'api' | 'oauth' | 'none';
  oauthAccountId?: string;
  supportedParameters?: string[];
  reasoning?: boolean;
  interleavedReasoningField?: string;
  /** Fallback reasoning effort when the client omits output_config.effort. */
  defaultEffort?: string;
  contextWindow?: number;
  /** Picker label for gateway aliases, e.g. "OpenCode Go" or local provider name. */
  providerLabel?: string;
  /** Provider id for filtering: `zen`, `go`, or a local OpenCode provider id. */
  providerId?: string;
}

export interface ModelCatalog {
  get: (id: string) => ServerModelInfo | undefined;
  list: () => ServerModelInfo[];
}

const CREATED_AT_ISO = '2025-01-01T00:00:00Z';
const CREATED_AT_UNIX = 1735689600;

export function formatAnthropicModelEntry(
  id: string,
  displayName: string,
  contextWindow?: number,
) {
  const maxInput = resolveContextWindow(id, contextWindow);
  return {
    id,
    type: 'model' as const,
    display_name: displayName,
    created_at: CREATED_AT_ISO,
    context_window: maxInput,
    max_input_tokens: maxInput,
  };
}

export function createModelCatalog(models: ServerModelInfo[]): ModelCatalog {
  const byId = new Map(models.map(model => [model.id, model]));

  return {
    get: (id: string) => byId.get(id),
    list: () => [...models],
  };
}

export interface ModelDisplayEntry {
  id: string;
  name: string;
  contextWindow?: number;
}

export function formatAnthropicModelList(entries: ModelDisplayEntry[]) {
  return {
    data: entries.map(entry => formatAnthropicModelEntry(entry.id, entry.name, entry.contextWindow)),
    has_more: false,
    first_id: entries[0]?.id ?? null,
    last_id: entries.at(-1)?.id ?? null,
  };
}

export function formatAnthropicModels(models: ServerModelInfo[]) {
  return formatAnthropicModelList(
    models.map(model => ({ id: model.id, name: model.name, contextWindow: model.contextWindow })),
  );
}

export function gatewayProviderLabel(model: ServerModelInfo): string {
  return model.providerLabel ?? (model.sourceBackend === 'go' ? 'OpenCode Go' : 'OpenCode Zen');
}

/** Stable slug for gateway alias ids — provider id when set, else zen/go backend id. */
export function gatewayProviderId(model: ServerModelInfo): string {
  return model.providerId ?? model.sourceBackend;
}

/** Gateway-discovery-safe id — Claude clients only surface claude-* and anthropic-* ids. */
export function gatewayAliasId(model: ServerModelInfo): string {
  return aliasModelId(model.id, gatewayProviderId(model));
}

export function exposedGatewayAliasId(model: ServerModelInfo, opts?: GatewayModelOptions): string {
  const alias = gatewayAliasId(model);
  return opts?.maskGatewayIds ? maskGatewayModelId(alias) : alias;
}

/** Readable picker label — discovery ids may be masked; names stay real. */
export function gatewayDisplayName(model: ServerModelInfo, opts?: GatewayModelOptions): string {
  if (!opts?.maskGatewayIds) return model.name;
  return `${model.name} (${gatewayProviderLabel(model)})`;
}

export function formatGatewayAnthropicModels(models: ServerModelInfo[], opts?: GatewayModelOptions) {
  return formatAnthropicModelList(
    models.map(model => ({
      id: exposedGatewayAliasId(model, opts),
      name: gatewayDisplayName(model, opts),
      contextWindow: model.contextWindow,
    })),
  );
}

/** Catalog with alias → model lookup for gateway clients (Claude Desktop, Claude Code). */
export function createGatewayModelCatalog(models: ServerModelInfo[], opts?: GatewayModelOptions): ModelCatalog {
  const byId = new Map<string, ServerModelInfo>();
  for (const model of models) {
    byId.set(model.id, model);
    const alias = exposedGatewayAliasId(model, opts);
    if (alias !== model.id) byId.set(alias, model);
    if (opts?.maskGatewayIds) {
      const rawAlias = gatewayAliasId(model);
      if (rawAlias !== alias) byId.set(rawAlias, model);
    }
  }

  return {
    get: (id: string) => byId.get(id),
    list: () => [...models],
  };
}

/** Model id to send upstream (OpenCode / provider API), not the gateway alias. */
export function upstreamModelId(model: ServerModelInfo): string {
  const id = model.upstreamModelId ?? model.id;
  // Claude Code uses a [1m] suffix for 1M context with third-party APIs; Vertex ids omit it.
  return id.replace(/\[1m\]$/i, '');
}

export function supportsDirectOpenAIChatCompletions(model: ServerModelInfo): boolean {
  return model.modelFormat === 'openai'
    && (
      !!model.completionsUrl
      || model.sourceBackend === 'zen'
      || model.sourceBackend === 'go'
    );
}

export function formatOpenAIModels(models: ServerModelInfo[]) {
  return {
    object: 'list',
    data: models.map(model => ({
      id: model.id,
      object: 'model',
      created: CREATED_AT_UNIX,
      owned_by: model.sourceBackend,
    })),
  };
}
