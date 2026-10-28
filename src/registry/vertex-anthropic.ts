// src/registry/vertex-anthropic.ts — Claude on Google Vertex AI as a registry provider
//
// Auth is gcloud Application Default Credentials and the project comes from the
// environment, so the provider stores no key. Its models come from
// ~/.relay-ai/vertex-models.json (the same catalog `--vertex` launches use).

import { VERTEX_ANTHROPIC_NPM } from '../constants.js';
import {
  hasApplicationDefaultCredentials,
  loadVertexModelEntries,
  resolveVertexProject,
  saveVertexModelEntries,
  type VertexModelEntry,
} from '../vertex-env.js';
import { modelIdError } from './provider-models.js';
import { loadRegistry } from './io.js';
import type { CachedModel, RegistryProvider } from './types.js';

export const VERTEX_ANTHROPIC_PROVIDER_ID = 'vertex-anthropic';

/** True once the user has added (and not disabled) the Vertex provider. */
export function isVertexAnthropicRegistered(): boolean {
  return loadRegistry().providers.some(p => p.enabled && isVertexAnthropicProvider(p));
}

export function isVertexAnthropicProvider(provider: Pick<RegistryProvider, 'id' | 'templateId'>): boolean {
  return provider.templateId === VERTEX_ANTHROPIC_PROVIDER_ID || provider.id === VERTEX_ANTHROPIC_PROVIDER_ID;
}

/** Read live so edits to vertex-models.json apply on the next launch without a refresh. */
export function vertexAnthropicCachedModels(): CachedModel[] {
  return loadVertexModelEntries().map(entry => ({
    id: entry.id,
    name: entry.display_name,
    upstreamModelId: entry.upstream_id ?? entry.id,
    family: 'claude',
    brand: 'Anthropic',
    modelFormat: 'openai',
    npm: VERTEX_ANTHROPIC_NPM,
  }));
}

export function vertexAnthropicSetupError(): { error: string; hint: string } | null {
  if (!hasApplicationDefaultCredentials()) {
    return { error: 'Google Application Default Credentials not found.', hint: 'Run: gcloud auth application-default login' };
  }
  if (!resolveVertexProject()) {
    return {
      error: 'No Google Cloud project configured for Vertex AI.',
      hint: 'Set ANTHROPIC_VERTEX_PROJECT_ID (or GOOGLE_CLOUD_PROJECT) in your shell profile, then try again.',
    };
  }
  return null;
}

/** `claude-haiku-5-5` → `Claude Haiku 5.5`; anything else is returned as-is. */
export function vertexModelDisplayName(id: string): string {
  const m = id.match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?(?:@.*)?$/i);
  if (!m) return id;
  const tier = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase();
  return `Claude ${tier} ${m[2]}${m[3] !== undefined ? `.${m[3]}` : ''}`;
}

/** Appends to the current list (the defaults, until the user saves their own). */
export function addVertexModelEntry(entry: VertexModelEntry): { ok: boolean; error?: string } {
  const idError = modelIdError(entry.id);
  if (idError) return { ok: false, error: idError };
  const current = loadVertexModelEntries();
  if (current.some(m => m.id === entry.id)) return { ok: false, error: `${entry.id} is already in your Vertex model list.` };
  saveVertexModelEntries([...current, entry]);
  return { ok: true };
}

/** An empty list would silently fall back to the defaults, so one model must remain. */
export function removeVertexModelEntries(ids: string[]): { ok: boolean; error?: string } {
  const current = loadVertexModelEntries();
  const remaining = current.filter(m => !ids.includes(m.id));
  if (remaining.length === current.length) return { ok: false, error: 'None of those models are in your Vertex model list.' };
  if (remaining.length === 0) return { ok: false, error: 'Keep at least one model. To start over, reset to the latest default list instead.' };
  saveVertexModelEntries(remaining);
  return { ok: true };
}
