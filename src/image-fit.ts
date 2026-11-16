/**
 * Shrinks oversized inline images instead of failing the whole turn.
 *
 * Observed: a 4318x2368 Retina screenshot (base64 11,052,444 bytes) made Vertex
 * answer `image exceeds 10 MB maximum` (HTTP 400) and Codex retried 5 times.
 * Claude only uses up to 2576 px on the long edge (Opus 4.7+/Sonnet 5+; 1568 px
 * before), so resizing there loses nothing the model would see.
 *
 * Non-Claude routes get a generic policy too: a self-hosted OpenAI-compatible
 * gateway answered a 24 MB Codex turn (two screenshots) with `400 Invalid JSON
 * body` — probing it showed 8 MB bodies pass and 12 MB fail. Most vision models
 * downscale to ~2048 px internally anyway. That limit is a guess for any given
 * server, so without `sharp` the generic policy leaves images untouched.
 *
 * Output is deterministic and cached by input hash: the same history image must
 * produce identical bytes every turn, or the prompt cache and preserved thinking
 * break. `sharp` is an optional dependency; without it the image becomes a note
 * (Claude's hard limit) or stays as-is (generic policy).
 */
import { createHash } from 'node:crypto';
import { VERTEX_ANTHROPIC_NPM } from './constants.js';
import type { ResponsesInputItem } from './codex-responses-adapter.js';

export interface ImageFitPolicy {
  maxLongEdge: number;
  maxBase64Bytes: number;
  /** Cap on all inline images in one request together (base64 bytes). */
  maxTotalBase64Bytes?: number;
  /** The limit is a guess, not a documented hard cap: keep an image we cannot shrink. */
  soft?: boolean;
}

export const ANTHROPIC_IMAGE_BASE64_LIMIT = 10_485_760;
const HEADROOM = 64 * 1024;
const CAP = ANTHROPIC_IMAGE_BASE64_LIMIT - HEADROOM;
/** Used after any provider rejects an image, whatever the route. */
export const REACTIVE_IMAGE_POLICY: ImageFitPolicy = { maxLongEdge: 2576, maxBase64Bytes: CAP };
const MB = 1024 * 1024;
/** Non-Claude routes, every turn: keeps a whole request well under ~10 MB gateway body caps. */
export const GENERIC_IMAGE_POLICY: ImageFitPolicy = { maxLongEdge: 2048, maxBase64Bytes: 3 * MB, maxTotalBase64Bytes: 7 * MB, soft: true };
/** Non-Claude routes, after the provider refused the request size: tighter, one retry. */
export const GENERIC_REACTIVE_IMAGE_POLICY: ImageFitPolicy = { maxLongEdge: 1568, maxBase64Bytes: 1.5 * MB, maxTotalBase64Bytes: 4 * MB, soft: true };
/** Floor for the per-image share when many images split the total budget. */
const MIN_IMAGE_SHARE = 256 * 1024;
const CACHE_LIMIT = 64;

function claudeLongEdge(modelId: string): number {
  const sep = modelId.lastIndexOf('__');
  const id = (sep >= 0 ? modelId.slice(sep + 2) : modelId).toLowerCase();
  if (id.includes('fable') || id.includes('mythos')) return 2576;
  const m = id.match(/claude-(opus|sonnet|haiku)-(\d+)(?:-(\d+))?/);
  if (!m) return 1568;
  const version = Number(m[2]) + (m[3] !== undefined && m[3].length <= 2 ? Number(m[3]) / 10 : 0);
  const min = m[1] === 'opus' ? 4.7 : m[1] === 'sonnet' ? 5 : 5.5;
  return version >= min ? 2576 : 1568;
}

type ImageRoute = { npm?: string; upstreamModelId?: string; modelId: string };

function isClaudeImageRoute(route: ImageRoute): boolean {
  return route.npm === '@ai-sdk/anthropic' || route.npm === VERTEX_ANTHROPIC_NPM;
}

export function imagePolicyForRoute(route: ImageRoute): ImageFitPolicy {
  if (!isClaudeImageRoute(route)) return GENERIC_IMAGE_POLICY;
  return { maxLongEdge: claudeLongEdge(route.upstreamModelId ?? route.modelId), maxBase64Bytes: CAP };
}

/** Policy for the single retry after a provider refused an image or the request size. */
export function reactiveImagePolicyForRoute(route: ImageRoute): ImageFitPolicy {
  return isClaudeImageRoute(route) ? REACTIVE_IMAGE_POLICY : GENERIC_REACTIVE_IMAGE_POLICY;
}

type SharpFn = typeof import('sharp').default;
let sharpLoader: Promise<SharpFn | undefined> | undefined;
async function loadSharp(): Promise<SharpFn | undefined> {
  if (process.env.RELAY_AI_DISABLE_SHARP === '1') return undefined;
  sharpLoader ??= import('sharp').then(m => (m.default ?? m) as unknown as SharpFn).catch(() => undefined);
  return sharpLoader;
}

const cache = new Map<string, string>();

function headerSize(buf: Buffer): { width: number; height: number } | undefined {
  const dims = headerDimensions(buf);
  const m = dims.match(/^(\d+)x(\d+)$/);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : undefined;
}

function headerDimensions(buf: Buffer): string {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1]!;
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return `${buf.readUInt16BE(i + 7)}x${buf.readUInt16BE(i + 5)}`;
      i += 2 + len;
    }
  }
  return 'large';
}

async function shrink(dataUrl: string, policy: ImageFitPolicy): Promise<string | undefined> {
  const comma = dataUrl.indexOf(',');
  const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
  const input = Buffer.from(dataUrl.slice(comma + 1), 'base64');
  const sharp = await loadSharp();
  if (!sharp) return undefined;
  try {
    const meta = await sharp(input).metadata();
    let longEdge = Math.min(policy.maxLongEdge, Math.max(meta.width ?? 0, meta.height ?? 0) || policy.maxLongEdge);
    for (let round = 0; round < 6; round++) {
      const resized = sharp(input).rotate().resize({ width: longEdge, height: longEdge, fit: 'inside', withoutEnlargement: true });
      const tries: Array<[string, () => Promise<Buffer>]> = mime === 'image/png' && round === 0
        ? [['image/png', () => resized.clone().png({ compressionLevel: 9 }).toBuffer()], ['image/jpeg', () => resized.clone().jpeg({ quality: 85, mozjpeg: false }).toBuffer()]]
        : [['image/jpeg', () => resized.clone().jpeg({ quality: round === 0 ? 85 : 75, mozjpeg: false }).toBuffer()]];
      for (const [outMime, encode] of tries) {
        const out = await encode();
        if (Math.ceil(out.length / 3) * 4 <= policy.maxBase64Bytes) return `data:${outMime};base64,${out.toString('base64')}`;
      }
      longEdge = Math.floor(longEdge * 0.75);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function remember(key: string, value: string): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

type Part = Record<string, unknown>;

export interface FitOptions {
  /** After a provider refused image dimensions: also shrink images whose long edge exceeds the policy. */
  resizeOversizedDimensions?: boolean;
}

async function fitPart(part: Part, policy: ImageFitPolicy, counts: { resized: number; omitted: number }, opts: FitOptions): Promise<Part> {
  if (part['type'] !== 'input_image' || typeof part['image_url'] !== 'string') return part;
  const url = part['image_url'] as string;
  if (!url.startsWith('data:image/')) return part;
  const b64 = url.length - url.indexOf(',') - 1;
  if (b64 <= policy.maxBase64Bytes) {
    if (!opts.resizeOversizedDimensions) return part;
    const size = headerSize(Buffer.from(url.slice(url.indexOf(',') + 1, url.indexOf(',') + 1 + 65_536), 'base64'));
    if (!size || Math.max(size.width, size.height) <= policy.maxLongEdge) return part;
  }
  const key = createHash('sha256').update(`${policy.maxLongEdge}:${policy.maxBase64Bytes}:`).update(url).digest('hex');
  let fitted = cache.get(key);
  if (!fitted) {
    fitted = await shrink(url, policy);
    if (fitted) remember(key, fitted);
  }
  if (fitted) {
    counts.resized++;
    return { ...part, image_url: fitted };
  }
  if (policy.soft) return part;
  counts.omitted++;
  return omittedNote(url);
}

function omittedNote(url: string): Part {
  const dims = headerDimensions(Buffer.from(url.slice(url.indexOf(',') + 1, url.indexOf(',') + 1 + 4096), 'base64'));
  return { type: 'input_text', text: `[image omitted: ${dims} image exceeds this model's size limit]` };
}

async function fitParts(parts: unknown[], policy: ImageFitPolicy, counts: { resized: number; omitted: number }, opts: FitOptions): Promise<unknown[] | undefined> {
  let changed = false;
  const out: unknown[] = [];
  for (const p of parts) {
    const next = p && typeof p === 'object' ? await fitPart(p as Part, policy, counts, opts) : p;
    if (next !== p) changed = true;
    out.push(next);
  }
  return changed ? out : undefined;
}

type FitResult = { input: ResponsesInputItem[]; resized: number; omitted: number };

/** Every inline image part, in conversation order (oldest first). */
function imageParts(input: ResponsesInputItem[]): Array<{ item: number; field: 'content' | 'output'; part: number; url: string }> {
  const out: Array<{ item: number; field: 'content' | 'output'; part: number; url: string }> = [];
  input.forEach((entry, item) => {
    const it = entry as unknown as Record<string, unknown>;
    const field = Array.isArray(it['content']) ? 'content' : Array.isArray(it['output']) ? 'output' : undefined;
    if (!field) return;
    (it[field] as unknown[]).forEach((p, part) => {
      const rec = p as Part | null;
      if (rec && rec['type'] === 'input_image' && typeof rec['image_url'] === 'string' && (rec['image_url'] as string).startsWith('data:image/')) {
        out.push({ item, field, part, url: rec['image_url'] as string });
      }
    });
  });
  return out;
}

function base64Bytes(url: string): number {
  return url.length - url.indexOf(',') - 1;
}

/**
 * Fits each image to the policy, then — when the policy caps the whole request —
 * re-fits every image to an even share of that cap, and as a last resort turns
 * the oldest images into notes. Each step depends only on the input, so a given
 * history always produces the same bytes.
 */
export async function fitImagesInInput(
  input: ResponsesInputItem[],
  policy: ImageFitPolicy,
  opts: FitOptions = {},
): Promise<FitResult> {
  const first = await fitEachImage(input, policy, opts);
  const cap = policy.maxTotalBase64Bytes;
  if (!cap) return first;
  const total = (r: FitResult) => imageParts(r.input).reduce((n, img) => n + base64Bytes(img.url), 0);
  if (total(first) <= cap) return first;
  // Without sharp nothing can shrink; a soft (guessed) limit must not drop images.
  if (policy.soft && !(await loadSharp())) return first;

  const originals = imageParts(input);
  const share = Math.max(MIN_IMAGE_SHARE, Math.floor(cap / Math.max(1, originals.length)));
  let result = share < policy.maxBase64Bytes
    ? await fitEachImage(input, { ...policy, maxBase64Bytes: share, maxTotalBase64Bytes: undefined }, opts)
    : first;
  let size = total(result);
  if (size <= cap) return result;

  const out = result.input.slice();
  let { resized, omitted } = result;
  for (const img of imageParts(result.input)) {
    if (size <= cap) break;
    const original = originals.find(o => o.item === img.item && o.field === img.field && o.part === img.part);
    const entry = { ...(out[img.item] as unknown as Record<string, unknown>) };
    const parts = (entry[img.field] as unknown[]).slice();
    parts[img.part] = omittedNote(original?.url ?? img.url);
    entry[img.field] = parts;
    out[img.item] = entry as unknown as ResponsesInputItem;
    size -= base64Bytes(img.url);
    omitted++;
    if (original && original.url !== img.url) resized--;
  }
  return { input: out, resized, omitted };
}

async function fitEachImage(
  input: ResponsesInputItem[],
  policy: ImageFitPolicy,
  opts: FitOptions,
): Promise<FitResult> {
  const counts = { resized: 0, omitted: 0 };
  let changed = false;
  const out: ResponsesInputItem[] = [];
  for (const item of input) {
    const it = item as unknown as Record<string, unknown>;
    let next: ResponsesInputItem = item;
    if (Array.isArray(it['content'])) {
      const parts = await fitParts(it['content'] as unknown[], policy, counts, opts);
      if (parts) next = { ...it, content: parts } as unknown as ResponsesInputItem;
    } else if (Array.isArray(it['output'])) {
      const parts = await fitParts(it['output'] as unknown[], policy, counts, opts);
      if (parts) next = { ...it, output: parts } as unknown as ResponsesInputItem;
    }
    if (next !== item) changed = true;
    out.push(next);
  }
  return { input: changed ? out : input, ...counts };
}

export const IMAGE_REMOVED_NOTE = "[image removed: this model can't read images]";

/** Replaces every image part (inline or remote) with a short note, for text-only models. */
export function stripImagesInInput(input: ResponsesInputItem[]): { input: ResponsesInputItem[]; removed: number } {
  let removed = 0;
  const strip = (parts: unknown[]): unknown[] | undefined => {
    let changed = false;
    const out = parts.map(p => {
      if (p && typeof p === 'object' && (p as Part)['type'] === 'input_image') {
        changed = true;
        removed++;
        return { type: 'input_text', text: IMAGE_REMOVED_NOTE };
      }
      return p;
    });
    return changed ? out : undefined;
  };
  let changed = false;
  const out = input.map(item => {
    const it = item as unknown as Record<string, unknown>;
    const field = Array.isArray(it['content']) ? 'content' : Array.isArray(it['output']) ? 'output' : undefined;
    if (!field) return item;
    const parts = strip(it[field] as unknown[]);
    if (!parts) return item;
    changed = true;
    return { ...it, [field]: parts } as unknown as ResponsesInputItem;
  });
  return { input: changed ? out : input, removed };
}

export function __resetImageFitForTests(): void {
  cache.clear();
}
