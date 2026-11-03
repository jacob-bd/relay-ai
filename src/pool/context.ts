/**
 * Conservative request estimate used for provider-reported windows. UTF-8 bytes / 2
 * reserves more than the usual English heuristic, including JSON scaffolding.
 * This is not a certified upper bound for every tokenizer or language. A provider
 * context error is still pre-commit and retryable on another route.
 */
export function estimatePoolRequestTokens(value: unknown): number {
  const json = JSON.stringify(value) ?? '';
  return Math.ceil(Buffer.byteLength(json, 'utf8') / 2);
}

export function poolRequestFitsWindow(
  value: unknown,
  contextWindow: number,
  outputReserve: number,
): { fits: boolean; required: number } {
  if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0) return { fits: false, required: Infinity };
  if (!Number.isSafeInteger(outputReserve) || outputReserve <= 0) return { fits: false, required: Infinity };
  const margin = Math.max(4096, Math.ceil(contextWindow * 0.1));
  const required = estimatePoolRequestTokens(value) + outputReserve + margin;
  return { fits: required <= contextWindow, required };
}
