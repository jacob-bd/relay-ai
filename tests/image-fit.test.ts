import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { fitImagesInInput, imagePolicyForRoute, __resetImageFitForTests, type ImageFitPolicy } from '../src/image-fit.js';
import { parseImageTooLarge } from '../src/codex-context-budget.js';

const CAP = 10_485_760 - 64 * 1024;
const policy: ImageFitPolicy = { maxLongEdge: 2576, maxBase64Bytes: CAP };
let bigNoisy: string;   // ~2600x1500 noise PNG, base64 well over the cap
let wide: string;       // 4000x1000 noise PNG, over the cap, fits after resize
let small: string;
const noisePng = async (width: number, height: number) =>
  'data:image/png;base64,' + (await sharp({ create: { width, height, channels: 3, background: '#000', noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).png().toBuffer()).toString('base64');
const b64len = (url: string) => url.length - url.indexOf(',') - 1;
const userImage = (url: string) => ({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'look' }, { type: 'input_image', image_url: url }] });
const urlOf = (item: unknown) => ((item as { content: Array<{ image_url?: string }> }).content[1]!.image_url)!;

beforeAll(async () => {
  bigNoisy = await noisePng(2600, 1500);
  wide = await noisePng(4000, 1000);
  small = await noisePng(64, 64);
}, 60_000);
beforeEach(() => { __resetImageFitForTests(); delete process.env.RELAY_AI_DISABLE_SHARP; });

describe('fitImagesInInput', () => {
  it('shrinks an over-cap image under the cap, long edge 2576, aspect kept', async () => {
    expect(b64len(wide)).toBeGreaterThan(CAP);
    const { input, resized } = await fitImagesInInput([userImage(wide)] as never, policy);
    expect(resized).toBe(1);
    const url = urlOf(input[0]);
    expect(b64len(url)).toBeLessThanOrEqual(CAP);
    const meta = await sharp(Buffer.from(url.split(',')[1]!, 'base64')).metadata();
    expect(meta.width).toBe(2576);
    expect(meta.height).toBe(644);
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
  }, 60_000);

  it('falls back to JPEG when PNG is still over the cap', async () => {
    expect(b64len(bigNoisy)).toBeGreaterThan(CAP);
    const { input } = await fitImagesInInput([userImage(bigNoisy)] as never, policy);
    const url = urlOf(input[0]);
    expect(b64len(url)).toBeLessThanOrEqual(CAP);
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
  }, 60_000);

  it('returns under-cap images byte-identical', async () => {
    const item = userImage(small);
    const { input, resized } = await fitImagesInInput([item] as never, policy);
    expect(resized).toBe(0);
    expect(input[0]).toBe(item);
  });

  it('is deterministic and cached across turns', async () => {
    const a = urlOf((await fitImagesInInput([userImage(wide)] as never, policy)).input[0]);
    const b = urlOf((await fitImagesInInput([userImage(wide)] as never, policy)).input[0]);
    expect(b).toBe(a);
    __resetImageFitForTests();
    const c = urlOf((await fitImagesInInput([userImage(wide)] as never, policy)).input[0]);
    expect(c).toBe(a);
  }, 60_000);

  it('replaces the image with a note when the image library is unavailable', async () => {
    process.env.RELAY_AI_DISABLE_SHARP = '1';
    const { input, omitted } = await fitImagesInInput([userImage(wide)] as never, policy);
    expect(omitted).toBe(1);
    const part = (input[0] as { content: Array<{ type: string; text?: string }> }).content[1]!;
    expect(part).toEqual({ type: 'input_text', text: "[image omitted: 4000x1000 image exceeds this model's size limit]" });
  });

  it('handles images inside tool outputs and leaves remote URLs alone', async () => {
    const tool = { type: 'function_call_output', call_id: 'c', output: [{ type: 'input_image', image_url: wide }] };
    const remote = userImage('https://example.com/a.png');
    const { input, resized } = await fitImagesInInput([tool, remote] as never, policy);
    expect(resized).toBe(1);
    expect(b64len((input[0] as { output: Array<{ image_url: string }> }).output[0]!.image_url)).toBeLessThanOrEqual(CAP);
    expect(input[1]).toBe(remote);
  }, 60_000);
});

describe('imagePolicyForRoute', () => {
  it('uses 2576 for new Claude models, 1568 for older, none for non-Anthropic', () => {
    expect(imagePolicyForRoute({ npm: '@ai-sdk/google-vertex/anthropic', modelId: 'vertex-anthropic__claude-opus-5-5' })).toEqual({ maxLongEdge: 2576, maxBase64Bytes: CAP });
    expect(imagePolicyForRoute({ npm: '@ai-sdk/anthropic', modelId: 'claude-sonnet-4-6' })?.maxLongEdge).toBe(1568);
    expect(imagePolicyForRoute({ npm: '@ai-sdk/anthropic', modelId: 'claude-sonnet-5' })?.maxLongEdge).toBe(2576);
    expect(imagePolicyForRoute({ npm: '@ai-sdk/openai', modelId: 'gpt-6.1-sol' })).toBeUndefined();
  });
});

describe('parseImageTooLarge', () => {
  it('recognises provider image-size refusals', () => {
    expect(parseImageTooLarge('messages.20.content.2.image.source.base64: image exceeds 10 MB maximum: 11052444 bytes > 10485760 bytes')).toBe(true);
    expect(parseImageTooLarge('image dimensions exceed max allowed size: 8000 pixels')).toBe(true);
    expect(parseImageTooLarge('prompt is too long')).toBe(false);
  });
});

describe('review fix: dimension refusals', () => {
  it('resizes over-wide images on a forced retry even when under the byte cap', async () => {
    const tiny = 'data:image/png;base64,' + (await sharp({ create: { width: 9000, height: 400, channels: 3, background: '#336699' } }).png().toBuffer()).toString('base64');
    expect(b64len(tiny)).toBeLessThan(CAP);
    const { input, resized } = await fitImagesInInput([userImage(tiny)] as never, policy, { resizeOversizedDimensions: true });
    expect(resized).toBe(1);
    const meta = await sharp(Buffer.from(urlOf(input[0]).split(',')[1]!, 'base64')).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(2576);
    const untouched = await fitImagesInInput([userImage(tiny)] as never, policy);
    expect(untouched.resized).toBe(0);
  }, 60_000);
});
