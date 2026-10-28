// src/registry/vertex-model-check.ts — confirm the user's Vertex project can serve a model
//
// Separate from vertex-anthropic.ts: that module is loaded by the registry for
// every launch and must not pull in the SDK provider factory.

import { generateText } from 'ai';
import { formatUpstreamError } from '../codex/upstream-error.js';
import { VERTEX_ANTHROPIC_NPM } from '../constants.js';
import { createLanguageModel } from '../provider-factory.js';
import { VERTEX_ANTHROPIC_PROVIDER_ID } from './vertex-anthropic.js';

/** One minimal request: a model that is not enabled for the project fails here, not mid-session. */
export async function checkVertexModelAccess(modelId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const model = await createLanguageModel({
      npm: VERTEX_ANTHROPIC_NPM, modelId, apiKey: '', providerId: VERTEX_ANTHROPIC_PROVIDER_ID,
    });
    await generateText({
      model, prompt: 'Reply with exactly OK.', maxOutputTokens: 16, maxRetries: 0,
      abortSignal: AbortSignal.timeout(60_000),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: formatUpstreamError(err) };
  }
}
