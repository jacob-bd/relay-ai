import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveContextWindow } from '../context-window.js';
import { VERTEX_ANTHROPIC_NPM } from '../constants.js';
import { getVertexModelsPath } from '../paths.js';
import { createGatewayModelCatalog, type ModelCatalog, type ServerModelInfo } from './models.js';

export interface VertexModelEntry {
  id: string;
  display_name: string;
  /** Wire id for the Vertex API; defaults to `id`. */
  upstream_id?: string;
}

export interface VertexRuntimeConfig {
  project: string;
  location: string;
  models: VertexModelEntry[];
}

/** Public-safe default catalog — generic Anthropic model ids on Vertex. */
export const DEFAULT_VERTEX_MODELS: VertexModelEntry[] = [
  { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4-6', display_name: 'Claude Opus 4.6' },
  { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
];

/** Claude Code shorthand ids (settings.json / /model) → Vertex catalog ids. */
export const VERTEX_MODEL_SHORT_ALIASES: Record<string, string> = {
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
  opus: 'claude-opus-4-6',
};

/** Vertex partner models with a 1M context window (Haiku 4.5 is 200k only). */
export const VERTEX_ONE_M_MODEL_IDS = new Set([
  'claude-sonnet-4-6',
  'claude-opus-4-6',
]);

type EnvLike = Record<string, string | undefined>;

export function resolveVertexProject(env: EnvLike = process.env): string | undefined {
  const project = env['ANTHROPIC_VERTEX_PROJECT_ID']
    ?? env['GOOGLE_CLOUD_PROJECT']
    ?? env['GOOGLE_VERTEX_PROJECT'];
  return project?.trim() || undefined;
}

export function resolveVertexLocation(env: EnvLike = process.env): string {
  const location = env['GOOGLE_CLOUD_LOCATION']
    ?? env['CLOUD_ML_REGION']
    ?? env['GOOGLE_VERTEX_LOCATION']
    ?? 'global';
  return location.trim() || 'global';
}

export function defaultAdcCredentialsPath(home = homedir()): string {
  return join(home, '.config', 'gcloud', 'application_default_credentials.json');
}

export function hasApplicationDefaultCredentials(
  home = homedir(),
  adcPath = defaultAdcCredentialsPath(home),
): boolean {
  return existsSync(adcPath);
}

export function loadVertexModelEntries(env: EnvLike = process.env): VertexModelEntry[] {
  const configPath = getVertexModelsPath(env);
  if (!existsSync(configPath)) return DEFAULT_VERTEX_MODELS;

  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_VERTEX_MODELS;

    const models = parsed
      .filter((entry): entry is VertexModelEntry =>
        !!entry
        && typeof entry === 'object'
        && typeof entry.id === 'string'
        && entry.id.length > 0
        && typeof entry.display_name === 'string'
        && entry.display_name.length > 0,
      )
      .map(entry => ({
        id: entry.id,
        display_name: entry.display_name,
        ...(typeof entry.upstream_id === 'string' && entry.upstream_id.length > 0
          ? { upstream_id: entry.upstream_id }
          : {}),
      }));

    return models.length > 0 ? models : DEFAULT_VERTEX_MODELS;
  } catch {
    return DEFAULT_VERTEX_MODELS;
  }
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
  return config.models.map(model => ({
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
  }));
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
        if (VERTEX_ONE_M_MODEL_IDS.has(targetId)) {
          registerVertexCatalogAlias(byId, `${alias}[1m]`, model);
        }
      }
    }
    if (VERTEX_ONE_M_MODEL_IDS.has(model.id)) {
      registerVertexCatalogAlias(byId, `${model.id}[1m]`, model);
    }
  }

  return {
    get: (id: string) => {
      const requested1m = /\[1m\]$/i.test(id);
      for (const candidate of vertexClientModelLookupCandidates(id)) {
        const match = byId.get(candidate) ?? catalog.get(candidate);
        if (match) {
          if (requested1m && !VERTEX_ONE_M_MODEL_IDS.has(match.id)) return undefined;
          return match;
        }
      }
      return undefined;
    },
    list: () => catalog.list(),
  };
}
