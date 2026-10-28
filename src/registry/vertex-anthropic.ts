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
} from '../vertex-env.js';
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
