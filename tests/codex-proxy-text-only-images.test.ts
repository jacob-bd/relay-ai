import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateResponsesResponse } from '../src/codex-responses-adapter.js';
import { startCodexProxy, relayRetryKind, __resetTextOnlyModelsForTests, type CodexProxyHandle } from '../src/codex-proxy.js';
import { IMAGE_REMOVED_NOTE, stripImagesInInput } from '../src/image-fit.js';
import { parseImageUnsupported } from '../src/codex-context-budget.js';

vi.mock('../src/provider-factory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/provider-factory.js')>();
  return { ...actual, createLanguageModel: vi.fn().mockResolvedValue({}) };
});
vi.mock('../src/codex-responses-adapter.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/codex-responses-adapter.js')>();
  return { ...actual, generateResponsesResponse: vi.fn() };
});

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const imageTurn = (text: string) => [{ type: 'message', role: 'user', content: [{ type: 'input_text', text }, { type: 'input_image', image_url: PNG }] }];
const okResponse = { id: 'resp_x', object: 'response', model: 'm', created_at: 0, status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
const hasImage = (params: unknown) => JSON.stringify(params).includes('iVBORw0KGgo');
const hasNote = (params: unknown) => JSON.stringify(params).includes("this model can't read images");

describe('text-only models: images removed and remembered', () => {
  let handle: CodexProxyHandle | undefined;
  afterEach(() => { handle?.close(); handle = undefined; vi.mocked(generateResponsesResponse).mockReset(); __resetTextOnlyModelsForTests(); });

  it('retries once without images, then drops images up front on later turns', async () => {
    vi.mocked(generateResponsesResponse).mockImplementation(async (_m, params) => {
      if (hasImage(params)) throw Object.assign(new Error('Bad Request'), { statusCode: 400, responseBody: '{"errors":[{"code":"invalid_request","message":"Hosted_vllmException - zai-org/GLM-5.3 is not a multimodal model"}]}' });
      return okResponse as never;
    });
    handle = await startCodexProxy([{ modelId: 'm', npm: '@ai-sdk/openai-compatible', apiKey: 'x', upstreamModelId: 'glm-5-3', providerId: 'custom-x' } as never], { requireAuth: false });
    const post = (input: unknown) => fetch(`http://127.0.0.1:${handle!.port}/v1/responses`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'm', input, stream: false }),
    });

    const first = await post(imageTurn('what is this?'));
    expect(first.status).toBe(200);
    const calls = vi.mocked(generateResponsesResponse).mock.calls;
    expect(calls).toHaveLength(2);
    expect(hasImage(calls[0]![1])).toBe(true);
    expect(hasImage(calls[1]![1])).toBe(false);
    expect(hasNote(calls[1]![1])).toBe(true);

    const second = await post(imageTurn('and this?'));
    expect(second.status).toBe(200);
    expect(calls).toHaveLength(3);
    expect(hasImage(calls[2]![1])).toBe(false);
  });

  it('does not strip images for an unrelated error', async () => {
    vi.mocked(generateResponsesResponse).mockRejectedValue(Object.assign(new Error('Bad Request'), { statusCode: 400, responseBody: '{"errors":[{"message":"invalid tool schema"}]}' }));
    handle = await startCodexProxy([{ modelId: 'm', npm: '@ai-sdk/openai-compatible', apiKey: 'x', upstreamModelId: 'glm-5-3', providerId: 'custom-x' } as never], { requireAuth: false });
    const res = await fetch(`http://127.0.0.1:${handle.port}/v1/responses`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'm', input: imageTurn('hi'), stream: false }),
    });
    expect(res.status).toBe(400);
    expect(vi.mocked(generateResponsesResponse).mock.calls).toHaveLength(1);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe('invalid tool schema (HTTP 400)');
  });
});

describe('image refusal classification', () => {
  it('recognises text-only refusals', () => {
    expect(parseImageUnsupported('zai-org/GLM-5.3 is not a multimodal model')).toBe(true);
    expect(parseImageUnsupported('This model does not support image input')).toBe(true);
    expect(parseImageUnsupported('No endpoints found that support image input')).toBe(true);
    expect(parseImageUnsupported('Image input is not supported for this model')).toBe(true);
    expect(parseImageUnsupported('image exceeds 10 MB maximum')).toBe(false);
  });

  it('picks the retry kind: overflow > text-only > too large', () => {
    expect(relayRetryKind('prompt is too long: 10 tokens > 5 maximum')).toBe('context');
    expect(relayRetryKind('x', 'context_length_exceeded')).toBe('context');
    expect(relayRetryKind('GLM-5.3 is not a multimodal model (HTTP 400)')).toBe('no-image');
    expect(relayRetryKind('Invalid JSON body (HTTP 400)')).toBe('image');
    expect(relayRetryKind('Bad Request (HTTP 400)')).toBeUndefined();
  });
});

describe('stripImagesInInput', () => {
  it('replaces inline, remote and tool-output images with a note and keeps other parts', () => {
    const input = [
      ...imageTurn('look'),
      { type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'https://example.com/a.png' }] },
      { type: 'function_call_output', call_id: 'c', output: [{ type: 'input_text', text: 'shot' }, { type: 'input_image', image_url: PNG }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] },
    ];
    const { input: out, removed } = stripImagesInInput(input as never);
    expect(removed).toBe(3);
    expect(JSON.stringify(out)).not.toContain('input_image');
    expect((out[0] as { content: unknown[] }).content).toEqual([{ type: 'input_text', text: 'look' }, { type: 'input_text', text: IMAGE_REMOVED_NOTE }]);
    expect(out[3]).toBe(input[3]);
  });

  it('returns the same array when there are no images', () => {
    const input = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }];
    expect(stripImagesInInput(input as never).input).toBe(input);
  });
});
