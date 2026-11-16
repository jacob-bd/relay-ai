/**
 * Shrinks oversized inline images instead of failing the whole turn.
 *
 * Observed: a 4318x2368 Retina screenshot (base64 11,052,444 bytes) made Vertex
 * answer `image exceeds 10 MB maximum` (HTTP 400) and Codex retried 5 times.
 * Claude only uses up to 2576 px on the long edge (Opus 4.7+/Sonnet 5+; 1568 px
 * before), so resizing there loses nothing the model would see.
 *
 * Output is deterministic and cached by input hash: the same history image must
 * produce identical bytes every turn, or the prompt cache and preserved thinking
 * break. `sharp` is an optional dependency; without it the image becomes a note.
 */
import { createHash } from 'node:crypto';
import { VERTEX_ANTHROPIC_NPM } from './constants.js';
import type { ResponsesInputItem } from './codex-responses-adapter.js';

export interface ImageFitPolicy { maxLongEdge: number; maxBase64Bytes: number }

export const ANTHROPIC_IMAGE_BASE64_LIMIT = 10_485_760;
const HEADROOM = 64 * 1024;
const CAP = ANTHROPIC_IMAGE_BASE64_LIMIT - HEADROOM;
/** Used after any provider rejects an image, whatever the route. */
export const REACTIVE_IMAGE_POLICY: ImageFitPolicy = { maxLongEdge: 2576, maxBase64Bytes: CAP };
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

export function imagePolicyForRoute(route: { npm?: string; upstreamModelId?: string; modelId: string }): ImageFitPolicy | undefined {
  if (route.npm !== '@ai-sdk/anthropic' && route.npm !== VERTEX_ANTHROPIC_NPM) return undefined;
  return { maxLongEdge: claudeLongEdge(route.upstreamModelId ?? route.modelId), maxBase64Bytes: CAP };
}

type SharpFn = typeof import('sharp').default;
let sharpLoader: Promise<SharpFn | undefined> | undefined;
async function loadSharp(): Promise<SharpFn | undefined> {
  if (process.env.RELAY_AI_DISABLE_SHARP === '1') return undefined;
  sharpLoader ??= import('sharp').then(m => (m.default ?? m) as unknown as SharpFn).catch(() => undefined);
  return sharpLoader;
}

const cache = new Map<string, string>();

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

async function fitPart(part: Part, policy: ImageFitPolicy, counts: { resized: number; omitted: number }): Promise<Part> {
  if (part['type'] !== 'input_image' || typeof part['image_url'] !== 'string') return part;
  const url = part['image_url'] as string;
  if (!url.startsWith('data:image/')) return part;
  const b64 = url.length - url.indexOf(',') - 1;
  if (b64 <= policy.maxBase64Bytes) return part;
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
  counts.omitted++;
  const dims = headerDimensions(Buffer.from(url.slice(url.indexOf(',') + 1, url.indexOf(',') + 1 + 4096), 'base64'));
  return { type: 'input_text', text: `[image omitted: ${dims} image exceeds this model's size limit]` };
}

async function fitParts(parts: unknown[], policy: ImageFitPolicy, counts: { resized: number; omitted: number }): Promise<unknown[] | undefined> {
  let changed = false;
  const out: unknown[] = [];
  for (const p of parts) {
    const next = p && typeof p === 'object' ? await fitPart(p as Part, policy, counts) : p;
    if (next !== p) changed = true;
    out.push(next);
  }
  return changed ? out : undefined;
}

export async function fitImagesInInput(
  input: ResponsesInputItem[],
  policy: ImageFitPolicy,
): Promise<{ input: ResponsesInputItem[]; resized: number; omitted: number }> {
  const counts = { resized: 0, omitted: 0 };
  let changed = false;
  const out: ResponsesInputItem[] = [];
  for (const item of input) {
    const it = item as unknown as Record<string, unknown>;
    let next: ResponsesInputItem = item;
    if (Array.isArray(it['content'])) {
      const parts = await fitParts(it['content'] as unknown[], policy, counts);
      if (parts) next = { ...it, content: parts } as unknown as ResponsesInputItem;
    } else if (Array.isArray(it['output'])) {
      const parts = await fitParts(it['output'] as unknown[], policy, counts);
      if (parts) next = { ...it, output: parts } as unknown as ResponsesInputItem;
    }
    if (next !== item) changed = true;
    out.push(next);
  }
  return { input: changed ? out : input, ...counts };
}

export function __resetImageFitForTests(): void {
  cache.clear();
}
