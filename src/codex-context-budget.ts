/**
 * Context budget for Codex relay routes (#95).
 *
 * One estimator is used both to decide when a request is too large and to
 * calibrate chars-per-token from real provider usage, so the two never drift.
 * Code/JSON-heavy Codex sessions measured ~1.6 chars/token (1,950,921 chars →
 * 1,207,698 Anthropic tokens), far denser than the old fixed 3 chars/token.
 */

export const DEFAULT_CHARS_PER_TOKEN = 3;
/** An image costs a few thousand vision tokens, not its base64 length. */
export const IMAGE_CHAR_WEIGHT = 4_000;

const MIN_CALIBRATION_TOKENS = 1_000;
const MIN_CHARS_PER_TOKEN = 1;
const MAX_CHARS_PER_TOKEN = 6;
const MAX_KEYS = 256;

const DATA_IMAGE_URL = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi;

function isImagePart(o: Record<string, unknown>): boolean {
  const type = o['type'];
  if (type === 'input_image' || type === 'image' || type === 'image-data' || type === 'image_url') return true;
  const media = (o['mediaType'] ?? o['media_type'] ?? o['mimeType']) as unknown;
  return (type === 'file' || type === 'file-data' || type === 'media') && typeof media === 'string' && media.startsWith('image');
}

function stringChars(s: string): number {
  if (s.length < 64 || !s.includes('base64,')) return s.length;
  let images = 0;
  const stripped = s.replace(DATA_IMAGE_URL, () => { images++; return ''; });
  return stripped.length + images * IMAGE_CHAR_WEIGHT;
}

/** Chars for any JSON-like value, counting every embedded image once at IMAGE_CHAR_WEIGHT. */
export function estimateValueChars(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'string') return stringChars(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).length;
  if (Array.isArray(value)) {
    let n = 2;
    for (const v of value) n += estimateValueChars(v) + 1;
    return n;
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (isImagePart(o)) return IMAGE_CHAR_WEIGHT;
    let n = 2;
    for (const [k, v] of Object.entries(o)) n += k.length + 3 + estimateValueChars(v) + 1;
    return n;
  }
  return 0;
}

export function estimateInputItemChars(item: unknown): number {
  return estimateValueChars(item);
}

/** instructions + tool definitions + every input item. */
export function estimateResponsesBodyChars(body: Record<string, unknown>): number {
  let chars = typeof body.instructions === 'string' ? body.instructions.length : 0;
  if (body.tools !== undefined) chars += estimateValueChars(body.tools);
  const input = body.input;
  if (typeof input === 'string') chars += input.length;
  else if (Array.isArray(input)) for (const item of input) chars += estimateInputItemChars(item);
  return chars;
}

const calibration = new Map<string, number>();
const families = new Map<string, string>();

function touch<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_KEYS) {
    const oldest = map.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

export function charsPerToken(key: string | undefined): number {
  return (key !== undefined && calibration.get(key)) || DEFAULT_CHARS_PER_TOKEN;
}

export function recordUsageCalibration(key: string | undefined, sentChars: number, inputTokens: number): void {
  if (key === undefined || !(inputTokens >= MIN_CALIBRATION_TOKENS) || !(sentChars > 0)) return;
  const ratio = Math.min(MAX_CHARS_PER_TOKEN, Math.max(MIN_CHARS_PER_TOKEN, sentChars / inputTokens));
  touch(calibration, key, ratio);
}

export function estimateTokens(chars: number, key?: string): number {
  return Math.ceil(chars / charsPerToken(key));
}

const num = (s: string | undefined): number | undefined => (s === undefined ? undefined : Number(s));

/** Recognises provider "too many tokens" refusals; returns the counts when stated. */
export function parseContextOverflow(message: string): { actualTokens?: number; maxTokens?: number } | undefined {
  const anthropic = message.match(/prompt is too long:\s*(\d+)\s*tokens\s*>\s*(\d+)\s*maximum/i);
  if (anthropic) return { actualTokens: num(anthropic[1]), maxTokens: num(anthropic[2]) };
  const openai = message.match(/maximum context length is (\d+) tokens[\s\S]*?(\d+) tokens/i);
  if (openai) return { maxTokens: num(openai[1]), actualTokens: num(openai[2]) };
  const gemini = message.match(/input token count \((\d+)\) exceeds the maximum number of tokens allowed \((\d+)\)/i);
  if (gemini) return { actualTokens: num(gemini[1]), maxTokens: num(gemini[2]) };
  if (/context_length_exceeded|exceeds the maximum number of tokens|input is too long|exceeds the context window|prompt is too long/i.test(message)) {
    return {};
  }
  return undefined;
}

export function conversationKey(conversationId: string | undefined, fallback: string): string {
  return conversationId ?? fallback;
}

/** Records the model family serving this conversation and returns the one before it. */
export function noteModelFamily(key: string, family: string): { previous?: string } {
  const previous = families.get(key);
  touch(families, key, family);
  return previous === undefined ? {} : { previous };
}

export function __resetContextBudgetForTests(): void {
  calibration.clear();
  families.clear();
}
