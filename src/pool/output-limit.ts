import { findModelsDevModel, modelsDevCrossVendorOutputLimit } from '../registry/models-dev.js';

/**
 * Coding turns write whole files and long tool calls, so the pool must not cap output at a chat-sized
 * number. A provider that rejects a larger value fails before any output and the pool falls through.
 */
export const POOL_DEFAULT_OUTPUT_TOKENS = 32_768;
/** Never reserve more than this share of the window for output. */
const MAX_OUTPUT_WINDOW_SHARE = 4;
const MIN_OUTPUT_TOKENS = 1_024;

/** The most output tokens the pool will ask this model for: the provider's published limit, else the model vendor's, else a coding-sized default. */
export function poolOutputCap(providerId: string, modelId: string, contextWindow: number): number {
  const published = findModelsDevModel(providerId, modelId)?.limit?.output ?? modelsDevCrossVendorOutputLimit(modelId);
  const base = typeof published === 'number' && Number.isSafeInteger(published) && published > 0
    ? published : POOL_DEFAULT_OUTPUT_TOKENS;
  const windowCap = Math.floor(contextWindow / MAX_OUTPUT_WINDOW_SHARE);
  return Math.max(MIN_OUTPUT_TOKENS, Math.min(base, windowCap));
}
