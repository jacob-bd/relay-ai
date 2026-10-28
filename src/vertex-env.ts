// src/vertex-env.ts — Vertex AI environment, gcloud credentials and the model file.
//
// Dependency-free on purpose: the registry provider, provider factory and the
// `--vertex` launchers all read these, and server/vertex-config.ts sits inside
// the proxy <-> server/models import cycle.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { getVertexModelsPath } from './paths.js';

export interface VertexModelEntry {
  id: string;
  display_name: string;
  /** Wire id for the Vertex API; defaults to `id`. */
  upstream_id?: string;
}

/**
 * Public-safe default catalog: current Claude models by their generic Vertex
 * ids, newest first. Used until the user saves their own list; keep
 * assets/vertex-models.example.json in sync.
 */
export const DEFAULT_VERTEX_MODELS: VertexModelEntry[] = [
  { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' },
  { id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' },
  { id: 'claude-opus-4-6', display_name: 'Claude Opus 4.6' },
  { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
];

export type EnvLike = Record<string, string | undefined>;

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
  env: EnvLike = process.env,
): boolean {
  const explicitPath = env['GOOGLE_APPLICATION_CREDENTIALS']?.trim();
  if (explicitPath && existsSync(explicitPath)) return true;
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

/** True when the user saved their own list (otherwise the defaults apply). */
export function hasCustomVertexModels(env: EnvLike = process.env): boolean {
  return existsSync(getVertexModelsPath(env));
}

export function saveVertexModelEntries(entries: VertexModelEntry[], env: EnvLike = process.env): void {
  const path = getVertexModelsPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(entries, null, 2)}\n`);
}

/** Drop the saved list so the defaults (including future updates) apply again. */
export function resetVertexModelEntries(env: EnvLike = process.env): void {
  rmSync(getVertexModelsPath(env), { force: true });
}
