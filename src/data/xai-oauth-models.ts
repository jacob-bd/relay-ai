// src/data/xai-oauth-models.ts
//
// Static fallback list of Grok models accessible via xAI SuperGrok OAuth.
//
// WHY FALLBACK: xAI's SuperGrok OAuth token (from auth.x.ai) uses a different
// format/scope than the developer API key (xai-...) that api.x.ai/v1/models
// expects. The OAuth JWT is rejected by the /v1/models endpoint with 401.
//
// This list is used as a fallback when the live api.x.ai/v1/models call fails
// with an OAuth token. If api.x.ai ever starts accepting OAuth tokens directly,
// the live fetch path in refresh-models.ts will be used instead.
//
// Update this list when xAI adds new models to their SuperGrok offering.

import type { CachedModel } from '../registry/types.js';
import { resolveContextWindow } from '../context-window.js';
import { deriveBrand } from '../models.js';

interface OAuthModelSeed {
  id: string;
  name: string;
  reasoning?: boolean;
}

// Models available to SuperGrok subscribers via xAI OAuth.
// Ordered from newest to oldest.
const XAI_OAUTH_MODEL_SEEDS: OAuthModelSeed[] = [
  // Grok 4 family
  { id: 'grok-4',              name: 'Grok 4',               reasoning: true },
  { id: 'grok-4-fast',         name: 'Grok 4 Fast',          reasoning: true },
  // Grok 3 family
  { id: 'grok-3',              name: 'Grok 3',               reasoning: true },
  { id: 'grok-3-fast',         name: 'Grok 3 Fast' },
  { id: 'grok-3-mini',         name: 'Grok 3 Mini',          reasoning: true },
  { id: 'grok-3-mini-fast',    name: 'Grok 3 Mini Fast',     reasoning: true },
];

export function buildXaiOAuthModels(): CachedModel[] {
  return XAI_OAUTH_MODEL_SEEDS.map(seed => {
    const prefix = seed.id.split('-')[0] ?? seed.id;
    return {
      id: seed.id,
      name: seed.name,
      upstreamModelId: seed.id,
      family: prefix,
      brand: deriveBrand(prefix),
      contextWindow: resolveContextWindow(seed.id),
      modelFormat: 'openai' as const,
      npm: '@ai-sdk/xai',
      reasoning: seed.reasoning,
    };
  });
}
