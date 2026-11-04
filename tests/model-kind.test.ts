import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleUiApiRequest } from '../src/ui/api.js';
import * as env from '../src/env.js';
import { loadRegistry, saveRegistry } from '../src/registry/io.js';
import { setModelKindOverride, setModelNotChat, setModelsHidden } from '../src/registry/crud.js';
import { modelsDevModelKind, type ModelsDevCacheFile } from '../src/registry/models-dev.js';
import { isNotChatRefusal } from '../src/test-model.js';
import { guessModelKindFromName } from '../src/registry/model-kind.js';
import { createMockRequest, createMockResponse } from './helpers/ui-api-test-utils.js';

describe('isNotChatRefusal', () => {
  it('counts a bare 404 from the chat address (embedding models on vLLM gateways)', () => {
    expect(isNotChatRefusal({ statusCode: 404, responseBody: '{"detail":"Not Found"}' })).toBe(true);
  });
  it('counts servers that say it is not a chat model', () => {
    expect(isNotChatRefusal({ statusCode: 400, message: 'This is not a chat model and thus not supported in the v1/chat/completions endpoint.' })).toBe(true);
  });
  it('does not count a 404 that names another reason (model served elsewhere, e.g. a gateway Claude-style endpoint)', () => {
    expect(isNotChatRefusal({ statusCode: 404, message: 'Not Found', responseBody: '{"error": "unsupported_path", "message": "/gpt-oss-120b/v1/messages is not an OpenAI surface this broker proxies"}' })).toBe(false);
  });
  it('counts a bare "Not Found" message plus body', () => {
    expect(isNotChatRefusal({ statusCode: 404, message: 'Not Found', responseBody: '{"detail":"Not Found"}' })).toBe(true);
  });
  it('does not count "model not found" style errors', () => {
    expect(isNotChatRefusal({ statusCode: 404, message: 'The model `foo` does not exist or you do not have access to it.' })).toBe(false);
    expect(isNotChatRefusal({ statusCode: 400, message: 'Unknown model: foo' })).toBe(false);
    expect(isNotChatRefusal({ statusCode: 500, message: 'oops' })).toBe(false);
  });
});

describe('guessModelKindFromName', () => {
  it.each([
    ['Qwen3-Reranker-4B', 'reranking'],
    ['granite-embedding-125m-english', 'embedding'],
    ['Nemotron-3.5-Embed-1B-BF16', 'embedding'],
    ['nomic-embed-text-v1-5', 'embedding'],
    ['bge-m3', 'embedding'],
    ['granite-guardian-3-3-8b', 'classifier'],
    ['whisper-large-v3', 'audio'],
    ['gpt-4o-mini-tts', 'audio'],
    ['flux-1-schnell', 'image'],
    ['gemini-2.5-flash-image', 'image'],
    ['veo-3', 'video'],
    ['granite-3.3-8b-instruct', 'chat'],
    ['gemma-4-31b-it', 'chat'],
    ['diffusiongemma-26B-A4B-it-FP8-dynamic', 'chat'],
    ['Qwen3.8-27B-FP8', 'chat'],
    ['deepseek-4-1-flash', 'chat'],
    ['glm-5-3', 'chat'],
    ['NVIDIA-Nemotron-3-Super-120B-A12B-BF16', 'chat'],
  ])('%s → %s', (id, kind) => {
    expect(guessModelKindFromName(id)).toBe(kind);
  });
  it.each(['Nemotron-3.5-Parse', 'auto-vertex-ai', 'mystery-model'])('%s stays unknown', id => {
    expect(guessModelKindFromName(id)).toBeUndefined();
  });
});

describe('modelsDevModelKind', () => {
  const cache = {
    vendor: { id: 'vendor', models: {
      'text-embedding-3-small': { id: 'text-embedding-3-small', type: 'embedding', modalities: { input: ['text'], output: ['text'] } },
      'bge-reranker': { id: 'bge-reranker', type: 'reranking' },
      'img-gen': { id: 'img-gen', modalities: { input: ['text'], output: ['image'] } },
      'tts-1': { id: 'tts-1', type: 'speech' },
      'chatty-4.5': { id: 'chatty-4.5', modalities: { input: ['text'], output: ['text'] } },
    } },
  } as unknown as ModelsDevCacheFile;
  it.each([
    ['text-embedding-3-small', 'embedding'],
    ['bge-reranker', 'reranking'],
    ['img-gen', 'image'],
    ['tts-1', 'audio'],
    ['Chatty-4.5', 'chat'],
  ])('%s → %s', (id, kind) => {
    expect(modelsDevModelKind('custom-gw', id, cache)).toBe(kind);
  });
  it('unknown model → undefined', () => {
    expect(modelsDevModelKind('custom-gw', 'mxbai-embed-large-v1', cache)).toBeUndefined();
  });
});

async function call(method: string, url: string, body?: unknown) {
  const response = createMockResponse();
  handleUiApiRequest(createMockRequest(method, url, body === undefined ? undefined : JSON.stringify(body)), response.res);
  await vi.waitFor(() => expect(response.result.data).not.toBe(''));
  return { code: response.result.code, json: JSON.parse(response.result.data) };
}

describe('model type and bulk hide', () => {
  let tempHome: string;
  let previousRelayHome: string | undefined;
  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'relay-ai-kind-'));
    previousRelayHome = process.env['RELAY_AI_HOME'];
    process.env['RELAY_AI_HOME'] = join(tempHome, 'relay-home');
    vi.spyOn(env, 'resolveProviderCredential').mockResolvedValue('key');
    saveRegistry({ schemaVersion: 1, providers: [{
      id: 'custom-gw', templateId: 'custom-openai', name: 'GW', enabled: true,
      api: { npm: '@ai-sdk/openai-compatible', url: 'https://gw.example.com/v1' },
      authRef: 'keyring:provider:custom-gw', addedAt: '2026-11-03T00:00:00Z',
      modelsCache: { fetchedAt: '2026-11-03T00:00:00Z', models: [
        { id: 'mxbai-embed-large-v1', name: 'mxbai', upstreamModelId: 'mxbai-embed-large-v1', modelFormat: 'openai' },
        { id: 'granite-guardian-4.1-8b', name: 'guardian', upstreamModelId: 'granite-guardian-4.1-8b', modelFormat: 'openai' },
        { id: 'gpt-oss-120b', name: 'gpt-oss', upstreamModelId: 'gpt-oss-120b', modelFormat: 'openai' },
      ] },
    }] } as never);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempHome, { recursive: true, force: true });
    if (previousRelayHome === undefined) delete process.env['RELAY_AI_HOME'];
    else process.env['RELAY_AI_HOME'] = previousRelayHome;
  });

  const kinds = async () => Object.fromEntries((await call('GET', '/api/models')).json.providers[0].models
    .map((m: { id: string; kind?: string; kindSource?: string }) => [m.id, [m.kind ?? null, m.kindSource ?? null]]));

  it('shows models.dev types, test results and manual types, in that order of priority', async () => {
    setModelNotChat('custom-gw', 'mxbai-embed-large-v1', true);
    setModelKindOverride('custom-gw', 'granite-guardian-4.1-8b', 'classifier');
    expect(await kinds()).toEqual({
      'mxbai-embed-large-v1': ['not-chat', 'test'],
      'granite-guardian-4.1-8b': ['classifier', 'manual'],
      'gpt-oss-120b': ['chat', 'models.dev'],
    });
    setModelKindOverride('custom-gw', 'mxbai-embed-large-v1', 'embedding');
    expect((await kinds())['mxbai-embed-large-v1']).toEqual(['embedding', 'manual']);
  });

  it('a later successful chat clears "not chat" and records chat', () => {
    setModelNotChat('custom-gw', 'gpt-oss-120b', true);
    setModelNotChat('custom-gw', 'gpt-oss-120b', false);
    expect(loadRegistry().providers[0]!.nonChatModelIds).toBeUndefined();
    expect(loadRegistry().providers[0]!.chatModelIds).toEqual(['gpt-oss-120b']);
    setModelNotChat('custom-gw', 'gpt-oss-120b', true);
    expect(loadRegistry().providers[0]!.chatModelIds).toBeUndefined();
  });

  it('a chat reply shows as tested chat, but a safety name keeps its guessed type', async () => {
    setModelNotChat('custom-gw', 'gpt-oss-120b', false);
    setModelNotChat('custom-gw', 'granite-guardian-4.1-8b', false);
    const result = await kinds();
    expect(result['gpt-oss-120b']).toEqual(['chat', 'test']);
    expect(result['granite-guardian-4.1-8b']).toEqual(['classifier', 'name']);
  });

  it('saves and resets a manual type through the UI route, survives reload', async () => {
    expect((await call('POST', '/api/providers/models/kind', { providerId: 'custom-gw', modelId: 'gpt-oss-120b', kind: 'classifier' })).code).toBe(200);
    expect(loadRegistry().providers[0]!.modelKindOverrides).toEqual({ 'gpt-oss-120b': 'classifier' });
    expect((await call('POST', '/api/providers/models/kind', { providerId: 'custom-gw', modelId: 'gpt-oss-120b', kind: null })).code).toBe(200);
    expect(loadRegistry().providers[0]!.modelKindOverrides).toBeUndefined();
    expect((await call('POST', '/api/providers/models/kind', { providerId: 'custom-gw', modelId: 'gpt-oss-120b', kind: 'banana' })).code).toBe(400);
  });

  it('bulk hides and unhides in one save, skipping unknown ids', async () => {
    const hide = await call('POST', '/api/providers/models/hide-many', { providerId: 'custom-gw', modelIds: ['mxbai-embed-large-v1', 'granite-guardian-4.1-8b', 'nope'], hidden: true });
    expect(hide.json).toEqual({ ok: true, changed: 2 });
    expect(loadRegistry().providers[0]!.hiddenModelIds?.sort()).toEqual(['granite-guardian-4.1-8b', 'mxbai-embed-large-v1']);
    expect(setModelsHidden('custom-gw', ['mxbai-embed-large-v1', 'granite-guardian-4.1-8b'], false)).toEqual({ ok: true, changed: 2 });
    expect(loadRegistry().providers[0]!.hiddenModelIds).toBeUndefined();
  });
});
