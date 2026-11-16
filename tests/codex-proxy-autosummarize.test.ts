import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { WebSocket } from 'ws';
import { createLanguageModel } from '../src/provider-factory.js';
import { startCodexProxy, type CodexProxyHandle } from '../src/codex-proxy.js';
import { COMPACTION_SUMMARY_INSTRUCTION } from '../src/codex-responses-adapter.js';
import { __resetContextBudgetForTests, noteModelFamily } from '../src/codex-context-budget.js';
import { __resetAutoSummarizeForTests } from '../src/codex-auto-summarize.js';

vi.mock('../src/provider-factory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/provider-factory.js')>();
  return { ...actual, createLanguageModel: vi.fn() };
});

type Prompt = Array<{ role: string; content: unknown }>;
const textOf = (prompt: Prompt) => JSON.stringify(prompt);
const finish = { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } } as LanguageModelV4StreamPart;
const textStream = (text: string) => simulateReadableStream({
  chunks: [{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: text }, { type: 'text-end', id: 't' }, finish] as LanguageModelV4StreamPart[],
  initialDelayInMs: null, chunkDelayInMs: null,
});
const overflow = () => Object.assign(new Error('prompt is too long: 30000 tokens > 20000 maximum'), { statusCode: 400 });

interface Recorder { main: Prompt[]; summary: Prompt[]; tools: unknown[] }

function fakeModel(behavior: { mainFails?: number | 'always'; summaryFails?: boolean } = {}): { model: MockLanguageModelV4; rec: Recorder } {
  const rec: Recorder = { main: [], summary: [], tools: [] };
  let mainCalls = 0;
  const model = new MockLanguageModelV4({
    doStream: async (opts: { prompt: Prompt; tools?: unknown }) => {
      if (textOf(opts.prompt).includes('CONTEXT CHECKPOINT COMPACTION') && !textOf(opts.prompt).includes('[Summary of earlier conversation]')) {
        rec.summary.push(opts.prompt);
        if (behavior.summaryFails) throw Object.assign(new Error('summary upstream down'), { statusCode: 500 });
        return { stream: textStream(`SUMMARY-${rec.summary.length}`) };
      }
      rec.main.push(opts.prompt);
      rec.tools.push(opts.tools);
      mainCalls++;
      if (behavior.mainFails === 'always' || (typeof behavior.mainFails === 'number' && mainCalls <= behavior.mainFails)) throw overflow();
      return { stream: textStream('answer') };
    },
  } as never);
  return { model, rec };
}

const route = { modelId: 'vertex-anthropic__claude-opus-5-5', npm: '@ai-sdk/google-vertex/anthropic', apiKey: 'x', upstreamModelId: 'claude-opus-5-5', providerId: 'vertex-anthropic', contextWindow: 20_000 };
const env = { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }] };
function history(pairs: number, size = 1_000) {
  const items: unknown[] = [env];
  for (let i = 0; i < pairs; i++) {
    items.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: `q${i} ${'x'.repeat(size)}` }] });
    items.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `a${i} ${'y'.repeat(size)}` }] });
  }
  return items;
}

function parseSse(raw: string) {
  return raw.split('\n\n').filter(Boolean).map(block => {
    const lines = block.split('\n');
    const event = lines.find(l => l.startsWith('event: '))?.slice(7) ?? '';
    const data = lines.find(l => l.startsWith('data: '))?.slice(6);
    return { event, data: data ? JSON.parse(data) : undefined };
  });
}

let handle: CodexProxyHandle | undefined;
beforeEach(() => { __resetContextBudgetForTests(); __resetAutoSummarizeForTests(); });
afterEach(() => { handle?.close(); handle = undefined; delete process.env.RELAY_AI_AUTO_SUMMARIZE; vi.mocked(createLanguageModel).mockReset(); });

async function start(model: MockLanguageModelV4) {
  vi.mocked(createLanguageModel).mockResolvedValue(model as never);
  handle = await startCodexProxy([route as never], { requireAuth: false });
}

async function post(input: unknown[], extra: Record<string, unknown> = {}, session = 'conv-1') {
  const res = await fetch(`http://127.0.0.1:${handle!.port}/v1/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', session_id: session },
    body: JSON.stringify({ model: route.modelId, input, stream: true, ...extra }),
  });
  return parseSse(await res.text());
}

describe('Codex proxy auto-summarize (#94/#95)', () => {
  it('summarizes oversized history before sending', async () => {
    const { model, rec } = fakeModel();
    await start(model);
    const events = await post(history(40));
    expect(rec.summary.length).toBeGreaterThanOrEqual(1);
    expect(textOf(rec.main[0]!)).toContain('[Summary of earlier conversation]');
    expect(textOf(rec.main[0]!)).toContain('<environment_context>');
    expect(events.filter(e => e.event === 'response.completed')).toHaveLength(1);
  });

  it('retries once after a provider overflow with a single response.created', async () => {
    const { model, rec } = fakeModel({ mainFails: 1 });
    await start(model);
    const events = await post(history(20));
    expect(rec.main).toHaveLength(2);
    expect(events.filter(e => e.event === 'response.created')).toHaveLength(1);
    expect(events.filter(e => e.event === 'response.failed')).toHaveLength(0);
    expect(events.filter(e => e.event === 'response.completed')).toHaveLength(1);
    expect(textOf(rec.main[1]!)).toContain('[Summary of earlier conversation]');
  });

  it('gives up after one retry with context_length_exceeded', async () => {
    const { model, rec } = fakeModel({ mainFails: 'always' });
    await start(model);
    const events = await post(history(20));
    expect(rec.main).toHaveLength(2);
    const failed = events.filter(e => e.event === 'response.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.data.response.error.code).toBe('context_length_exceeded');
  });

  it('falls through to the original body when summarizing fails', async () => {
    const { model, rec } = fakeModel({ summaryFails: true });
    await start(model);
    const events = await post(history(40));
    expect(rec.main.length).toBeGreaterThanOrEqual(1);
    expect(textOf(rec.main[0]!)).not.toContain('[Summary of earlier conversation]');
    expect(events.some(e => e.event === 'response.completed' || e.event === 'response.failed')).toBe(true);
  });

  it('reuses the checkpoint on the next full-history turn', async () => {
    const { model, rec } = fakeModel();
    await start(model);
    await post(history(40));
    const firstSummaryCalls = rec.summary.length;
    await post([...history(40), { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'next' }] }]);
    expect(rec.summary.length).toBe(firstSummaryCalls);
    expect(textOf(rec.main[1]!)).toContain(`SUMMARY-${firstSummaryCalls}`);
  });

  it('summarizes on a model-family switch only', async () => {
    const { model, rec } = fakeModel();
    await start(model);
    await post(history(13, 1_200), {}, 'fresh');
    expect(rec.summary).toHaveLength(0);
    noteModelFamily('switched', 'openai-native');
    await post(history(13, 1_200), {}, 'switched');
    expect(rec.summary.length).toBeGreaterThanOrEqual(1);
  });

  it('respects RELAY_AI_AUTO_SUMMARIZE=overflow for switches', async () => {
    process.env.RELAY_AI_AUTO_SUMMARIZE = 'overflow';
    const { model, rec } = fakeModel();
    await start(model);
    noteModelFamily('switched', 'openai-native');
    await post(history(13, 1_200), {}, 'switched');
    expect(rec.summary).toHaveLength(0);
  });

  it('keeps tools discovered earlier in history', async () => {
    const { model, rec } = fakeModel();
    await start(model);
    const ns = { type: 'namespace', name: 'mcp__github', tools: [{ type: 'function', name: 'create_issue', parameters: { type: 'object', properties: {} } }] };
    const items = history(40);
    items.splice(1, 0, { type: 'tool_search_call', call_id: 's1', arguments: '{}' }, { type: 'tool_search_output', call_id: 's1', tools: [ns] });
    await post(items);
    expect(JSON.stringify(rec.tools[0])).toContain('create_issue');
  });

  it('WS follow-up turn reuses the summary', async () => {
    const { model, rec } = fakeModel();
    await start(model);
    const client = new WebSocket(`ws://127.0.0.1:${handle!.port}/v1/responses`, { headers: { session_id: 'ws-conv' } });
    await new Promise(r => client.once('open', r));
    const completed = () => new Promise<Record<string, unknown>>(resolve => {
      const onMessage = (data: unknown) => {
        const evt = JSON.parse(String(data));
        if (evt.type === 'response.completed') { client.off('message', onMessage); resolve(evt.response); }
      };
      client.on('message', onMessage);
    });
    let done = completed();
    client.send(JSON.stringify({ type: 'response.create', model: route.modelId, input: history(40) }));
    const first = await done;
    const summaryCalls = rec.summary.length;
    expect(summaryCalls).toBeGreaterThanOrEqual(1);
    done = completed();
    client.send(JSON.stringify({ type: 'response.create', model: route.modelId, previous_response_id: first.id, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'follow-up' }] }] }));
    await done;
    expect(rec.summary.length).toBe(summaryCalls);
    expect(textOf(rec.main[rec.main.length - 1]!)).toContain('[Summary of earlier conversation]');
    client.terminate();
  }, 20_000);
});

describe('native → relay model switch (#94)', () => {
  it('summarizes when a native GPT conversation switches to a relay Claude route', async () => {
    const { model, rec } = fakeModel();
    vi.mocked(createLanguageModel).mockResolvedValue(model as never);
    const capability = 'C'.repeat(43);
    const nativeFetch = vi.fn(async () => new Response('native-sse', { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    handle = await startCodexProxy([route as never], {
      requireAuth: false,
      mixedNative: { nativeModelIds: new Set(['gpt-6.1-sol']), capability, nativeFetchImpl: nativeFetch as typeof fetch },
    });
    const url = `http://127.0.0.1:${handle.port}/_relay-codex/${capability}/v1/responses`;
    const headers = { 'Content-Type': 'application/json', session_id: 'mixed-conv', authorization: 'Bearer native' };
    await (await fetch(url, { method: 'POST', headers, body: JSON.stringify({ model: 'gpt-6.1-sol', input: history(13, 1_200), stream: true }) })).text();
    expect(nativeFetch).toHaveBeenCalledOnce();
    expect(rec.summary).toHaveLength(0);
    await (await fetch(url, { method: 'POST', headers, body: JSON.stringify({ model: route.modelId, input: history(13, 1_200), stream: true }) })).text();
    expect(rec.summary.length).toBeGreaterThanOrEqual(1);
  });
});
