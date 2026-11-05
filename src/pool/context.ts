/**
 * Conservative request estimate used for provider-reported windows. UTF-8 bytes / 2
 * reserves more than the usual English heuristic, including JSON scaffolding.
 * Image parts reserve vision tokens separately, wherever they sit (user turns and tool results alike):
 * their binary/base64 size is not text, and a Buffer would otherwise serialize to about four JSON bytes per byte.
 * This is not a certified upper bound for every tokenizer or language. A provider
 * context error is still pre-commit and retryable on another route.
 */
const IMAGE_INPUT_TOKENS = 4096;
const IMAGE_PART_TYPES = new Set(['image', 'image-data', 'image-url']);
const MEDIA_PART_TYPES = new Set(['file', 'media', 'file-data']);

function isImagePart(part: Record<string, unknown>): boolean {
  if (typeof part.type !== 'string') return false;
  if (IMAGE_PART_TYPES.has(part.type)) return true;
  return MEDIA_PART_TYPES.has(part.type) && typeof part.mediaType === 'string' && part.mediaType.startsWith('image');
}

interface Binary { images: number; bytes: number }

/** Copy of `value` with image parts and raw binary replaced by small stand-ins; the input is never modified. */
function withoutBinary(value: unknown, found: Binary): unknown {
  if (value instanceof Uint8Array) {
    found.bytes += value.byteLength;
    return null;
  }
  if (Array.isArray(value)) return value.map(item => withoutBinary(item, found));
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (typeof record.toJSON === 'function') return withoutBinary((record.toJSON as () => unknown)(), found);
  if (isImagePart(record)) {
    found.images += 1;
    return { type: 'image' };
  }
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, withoutBinary(item, found)]));
}

export function estimatePoolRequestTokens(value: unknown): number {
  const found: Binary = { images: 0, bytes: 0 };
  const json = JSON.stringify(withoutBinary(value, found)) ?? '';
  // Non-image binary (a PDF, say) is sent as the provider's own file input; count it by size, not as JSON.
  return Math.ceil(Buffer.byteLength(json, 'utf8') / 2) + found.images * IMAGE_INPUT_TOKENS + Math.ceil(found.bytes / 2);
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
