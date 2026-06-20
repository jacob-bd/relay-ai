// src/data/openai-oauth-models.ts
//
// Static seed list of GPT models accessible via ChatGPT Plus / Pro OAuth.
//
// WHY STATIC: The ChatGPT OAuth backend (chatgpt.com/backend-api/codex) does not
// expose a standard GET /v1/models endpoint. OAuth access tokens from auth.openai.com
// are NOT the same as developer API keys (sk-...) and are rejected by api.openai.com/v1/models.
// See provider-factory.ts: OpenAI OAuth routes inference to chatgpt.com/backend-api/codex,
// not api.openai.com.
//
// These are models confirmed to work via the ChatGPT Codex backend. Models are available
// depending on subscription tier (Plus vs Pro). We include the full set here and let the
// user discover what their tier unlocks at inference time.
//
// Update this list when OpenAI adds new models to their ChatGPT OAuth offering.

import type { CachedModel } from '../registry/types.js';
import { resolveContextWindow } from '../context-window.js';
import { deriveBrand } from '../models.js';

interface OAuthModelSeed {
  id: string;
  name: string;
  reasoning?: boolean;
}

// Models that the ChatGPT Codex backend (chatgpt.com/backend-api/codex) explicitly rejects
// for OAuth-authenticated ChatGPT accounts. The API returns HTTP 400 with:
//   "The '<model>' model is not supported when using Codex with a ChatGPT account."
// These models may be valid via OpenAI developer API keys (api.openai.com) — they are
// only excluded from the OAuth path. Update this set when OpenAI changes availability.
export const CHATGPT_CODEX_UNSUPPORTED_MODELS = new Set<string>([
  'gpt-5.4',        // confirmed: rejected by chatgpt.com/backend-api/codex
  'gpt-5.4-turbo',  // confirmed: rejected by chatgpt.com/backend-api/codex
  'gpt-5.5-fast',   // confirmed: rejected by chatgpt.com/backend-api/codex
]);

// Models available via ChatGPT Plus/Pro OAuth (chatgpt.com/backend-api/codex).
// Ordered from newest to oldest within each tier.
const OPENAI_OAUTH_MODEL_SEEDS: OAuthModelSeed[] = [
  // GPT-5.5 family (Pro)
  { id: 'gpt-5.5',              name: 'GPT-5.5',           reasoning: true },
  // gpt-5.5-fast excluded — chatgpt.com/backend-api/codex rejects it for ChatGPT accounts.
  // GPT-5.4 family excluded — chatgpt.com/backend-api/codex rejects them for ChatGPT accounts.
  // Use a direct OpenAI API key to access gpt-5.4 / gpt-5.4-turbo.
  // GPT-5 base (Pro / Plus)
  { id: 'gpt-5',                name: 'GPT-5',             reasoning: true },
  // GPT-4.1 family (Plus+)
  { id: 'gpt-4.1',              name: 'GPT-4.1' },
  { id: 'gpt-4.1-mini',         name: 'GPT-4.1 Mini' },
  { id: 'gpt-4.1-nano',         name: 'GPT-4.1 Nano' },
  // GPT-4o family (Plus+)
  { id: 'gpt-4o',               name: 'GPT-4o' },
  { id: 'gpt-4o-mini',          name: 'GPT-4o Mini' },
  // o-series reasoning (Plus+)
  { id: 'o4-mini',              name: 'o4 Mini',           reasoning: true },
  { id: 'o3',                   name: 'o3',                reasoning: true },
  { id: 'o3-mini',              name: 'o3 Mini',           reasoning: true },
  { id: 'o1',                   name: 'o1',                reasoning: true },
  { id: 'o1-mini',              name: 'o1 Mini',           reasoning: true },
];

export function buildOpenAiOAuthModels(): CachedModel[] {
  return OPENAI_OAUTH_MODEL_SEEDS.map(seed => {
    const prefix = seed.id.split('-')[0] ?? seed.id;
    return {
      id: seed.id,
      name: seed.name,
      upstreamModelId: seed.id,
      family: prefix,
      brand: deriveBrand(prefix),
      contextWindow: resolveContextWindow(seed.id),
      modelFormat: 'openai' as const,
      npm: '@ai-sdk/openai',
      reasoning: seed.reasoning,
    };
  });
}
