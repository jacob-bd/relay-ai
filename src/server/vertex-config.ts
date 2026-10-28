import { resolveContextWindow } from '../context-window.js';
import { VERTEX_ANTHROPIC_NPM } from '../constants.js';
import { getReasoningCapabilities } from '../provider-factory.js';
import { createGatewayModelCatalog, type ModelCatalog, type ServerModelInfo } from './models.js';
import {
  loadVertexModelEntries,
  resolveVertexLocation,
  resolveVertexProject,
  type EnvLike,
  type VertexModelEntry,
} from '../vertex-env.js';

export {
  DEFAULT_VERTEX_MODELS,
  defaultAdcCredentialsPath,
  hasApplicationDefaultCredentials,
  loadVertexModelEntries,
  resolveVertexLocation,
  resolveVertexProject,
  type VertexModelEntry,
} from '../vertex-env.js';

export interface VertexRuntimeConfig {
  project: string;
  location: string;
  models: VertexModelEntry[];
}

/** Claude Code shorthand ids (settings.json / /model) → Vertex catalog ids. */
export const VERTEX_MODEL_SHORT_ALIASES: Record<string, string> = {
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
  opus: 'claude-opus-4-6',
};

/** True for Vertex models with a 1M context window (Haiku 4.5 is 200k only), so `[1m]` aliases resolve. */
export function isVertexOneMModel(modelId: string): boolean {
  return resolveContextWindow(modelId) >= 1_000_000;
}

export function buildVertexRuntimeConfig(env: EnvLike = process.env): VertexRuntimeConfig | null {
  const project = resolveVertexProject(env);
  if (!project) return null;

  return {
    project,
    location: resolveVertexLocation(env),
    models: loadVertexModelEntries(env),
  };
}

export function vertexModelsToServerModels(config: VertexRuntimeConfig): ServerModelInfo[] {
  return config.models.map(model => {
    const caps = getReasoningCapabilities(VERTEX_ANTHROPIC_NPM, model.upstream_id ?? model.id);
    return {
      id: model.id,
      name: model.display_name,
      isFree: false,
      brand: 'Anthropic',
      sourceBackend: 'vertex',
      modelFormat: 'openai',
      upstreamModelId: model.upstream_id ?? model.id,
      npm: VERTEX_ANTHROPIC_NPM,
      providerLabel: 'Vertex AI',
      providerId: 'vertex',
      contextWindow: resolveContextWindow(model.id),
      ...(caps.defaultLevel ? { defaultEffort: caps.defaultLevel } : {}),
    };
  });
}

/** Claude Code client ids to try when resolving a Vertex catalog model (aliases, [1m], dated builds). */
export function vertexClientModelLookupCandidates(modelId: string): string[] {
  const candidates: string[] = [modelId];
  const without1m = modelId.replace(/\[1m\]$/i, '');
  if (without1m !== modelId) candidates.push(without1m);

  const withoutDate = without1m.replace(/-(\d{8})$/, '');
  if (withoutDate !== without1m) candidates.push(withoutDate);

  if (withoutDate !== without1m) {
    const datedWith1m = `${withoutDate}[1m]`;
    if (!candidates.includes(datedWith1m)) candidates.push(datedWith1m);
  }

  return [...new Set(candidates)];
}

function registerVertexCatalogAlias(byId: Map<string, ServerModelInfo>, alias: string, model: ServerModelInfo): void {
  if (!byId.has(alias)) byId.set(alias, model);
}

export function createVertexModelCatalog(models: ServerModelInfo[]): ModelCatalog {
  const catalog = createGatewayModelCatalog(models);
  const byId = new Map<string, ServerModelInfo>();
  for (const model of models) {
    byId.set(model.id, model);
    for (const [alias, targetId] of Object.entries(VERTEX_MODEL_SHORT_ALIASES)) {
      if (model.id === targetId) {
        registerVertexCatalogAlias(byId, alias, model);
        if (isVertexOneMModel(targetId)) {
          registerVertexCatalogAlias(byId, `${alias}[1m]`, model);
        }
      }
    }
    if (isVertexOneMModel(model.id)) {
      registerVertexCatalogAlias(byId, `${model.id}[1m]`, model);
    }
  }

  return {
    get: (id: string) => {
      const requested1m = /\[1m\]$/i.test(id);
      for (const candidate of vertexClientModelLookupCandidates(id)) {
        const match = byId.get(candidate) ?? catalog.get(candidate);
        if (match) {
          if (requested1m && !isVertexOneMModel(match.id)) return undefined;
          return match;
        }
      }
      return undefined;
    },
    list: () => catalog.list(),
  };
}
