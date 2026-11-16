import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  autoSummarizeMode,
  toUnits,
  splitForSummary,
  hoistToolDefinitions,
  renderTranscript,
  applySummaryCheckpoint,
  buildSummaryParams,
  __resetAutoSummarizeForTests,
} from '../src/codex-auto-summarize.js';
import { decodeCompactionContent, type ResponsesInputItem } from '../src/codex-responses-adapter.js';

const user = (text: string): ResponsesInputItem => ({ type: 'message', role: 'user', content: [{ type: 'input_text', text }] });
const dev = (text: string): ResponsesInputItem => ({ type: 'message', role: 'developer', content: [{ type: 'input_text', text }] });
const asst = (text: string): ResponsesInputItem => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const call = (id: string, args = '{}'): ResponsesInputItem => ({ type: 'function_call', call_id: id, name: 'shell', arguments: args });
const out = (id: string, output = 'ok'): ResponsesInputItem => ({ type: 'function_call_output', call_id: id, output });
const reasoning = (text: string): ResponsesInputItem => ({ type: 'reasoning', summary: [{ type: 'summary_text', text }] });

const callIds = (items: ResponsesInputItem[], type: string) => new Set(items.filter(i => i.type === type).map(i => (i as { call_id: string }).call_id));

beforeEach(() => __resetAutoSummarizeForTests());

describe('autoSummarizeMode', () => {
  it('reads the env switch', () => {
    expect(autoSummarizeMode({})).toBe('all');
    expect(autoSummarizeMode({ RELAY_AI_AUTO_SUMMARIZE: 'off' })).toBe('off');
    expect(autoSummarizeMode({ RELAY_AI_AUTO_SUMMARIZE: 'overflow' })).toBe('overflow');
    expect(autoSummarizeMode({ RELAY_AI_AUTO_SUMMARIZE: 'bogus' })).toBe('all');
  });
});

describe('toUnits', () => {
  it('keeps a user message typed during a tool batch inside that batch', () => {
    const units = toUnits([user('go'), call('c1'), call('c2'), out('c1'), user('wait'), out('c2'), asst('done')]);
    const batch = units.find(u => u.some(i => i.type === 'function_call'))!;
    expect(batch.map(i => i.type === 'message' ? (i as { role: string }).role : i.type))
      .toEqual(['function_call', 'function_call', 'function_call_output', 'user', 'function_call_output']);
  });
});

describe('splitForSummary', () => {
  it('never leaves a tool output in the tail without its call', () => {
    const input = [user('go'), call('c1', 'x'.repeat(2000)), call('c2'), out('c1'), user('wait'), out('c2'), user('next'), asst('a')];
    const split = splitForSummary(input, { tailCharBudget: 400 })!;
    expect(callIds(split.tail, 'function_call_output')).toEqual(callIds(split.tail, 'function_call'));
  });

  it('can cut inside a long single-prompt tool loop', () => {
    const input: ResponsesInputItem[] = [user('do everything')];
    for (let i = 0; i < 120; i++) input.push(reasoning(`step ${i}`), call(`c${i}`, 'a'.repeat(200)), out(`c${i}`, 'b'.repeat(400)));
    const split = splitForSummary(input, { tailCharBudget: 10_000 })!;
    expect(split.head.length).toBeGreaterThan(0);
    expect(split.tail[0]!.type).toBe('reasoning');
    expect(callIds(split.tail, 'function_call_output')).toEqual(callIds(split.tail, 'function_call'));
  });

  it('pins host context but not the first real prompt', () => {
    const input = [dev('rules'), user('# AGENTS.md instructions for /x'), user('<environment_context>cwd</environment_context>'), user('q1 '.repeat(500)), asst('a1'), user('q2'), asst('a2')];
    const split = splitForSummary(input, { tailCharBudget: 50 })!;
    expect(split.pinned).toEqual(input.slice(0, 3));
    expect(split.head).toContainEqual(input[3]);
  });

  it('keeps chronology on a second summary', () => {
    const compaction = { type: 'compaction', id: 'cmp_1', encrypted_content: Buffer.from(JSON.stringify({ v: 1, summary: 'old' })).toString('base64') } as ResponsesInputItem;
    const input = [user('<environment_context>c</environment_context>'), compaction, user('q50'), reasoning('r'), asst('a50'), user('q51'), asst('a51')];
    const split = splitForSummary(input, { tailCharBudget: 60 })!;
    expect(split.pinned).toEqual([input[0]]);
    expect(split.head[0]).toBe(compaction);
    expect(split.head).toContainEqual(input[2]);
  });

  it('clips an oversized last unit instead of failing', () => {
    const input = [user('q'), asst('a'), user('big'), call('c1'), out('c1', 'z'.repeat(500_000))];
    const split = splitForSummary(input, { tailCharBudget: 50_000 })!;
    const output = (split.tail.find(i => i.type === 'function_call_output') as { output: string }).output;
    expect(output.length).toBeLessThanOrEqual(50_000);
  });
});

describe('hoistToolDefinitions', () => {
  it('keeps tools that only exist in history, namespaces intact', () => {
    const ns = { type: 'namespace', name: 'mcp__github', tools: [{ type: 'function', name: 'create_issue' }] };
    const head = [
      { type: 'additional_tools', tools: [{ type: 'function', name: 'exec' }] },
      { type: 'tool_search_call', call_id: 's1' },
      { type: 'tool_search_output', call_id: 's1', tools: [ns] },
    ] as ResponsesInputItem[];
    expect(hoistToolDefinitions(head).tools).toEqual([{ type: 'function', name: 'exec' }, ns]);
  });
});

describe('renderTranscript', () => {
  it('renders plain text with no tool wire blocks and no base64', () => {
    const text = renderTranscript([user('hi'), call('c1', '{"cmd":"ls"}'), { type: 'function_call_output', call_id: 'c1', output: [{ type: 'input_image', image_url: 'data:image/png;base64,AAAA' }] } as ResponsesInputItem, asst('done')]);
    expect(text).toContain('USER: hi');
    expect(text).toContain('shell');
    expect(text).toContain('[image]');
    expect(text).not.toContain('base64');
    expect(buildSummaryParams(text).tools).toBeUndefined();
    expect(buildSummaryParams(text).providerOptions).toBeUndefined();
    expect(buildSummaryParams(text).messages).toHaveLength(1);
  });
});

describe('applySummaryCheckpoint', () => {
  const history = (n: number): ResponsesInputItem[] => {
    const items: ResponsesInputItem[] = [user('<environment_context>c</environment_context>')];
    for (let i = 0; i < n; i++) items.push(user(`q${i} ${'x'.repeat(1000)}`), asst(`a${i} ${'y'.repeat(1000)}`));
    return items;
  };
  const base = { key: 'conv', budgetChars: 30_000, targetChars: 18_000, chunkChars: 1_000_000, summaryReserveChars: 2_000, reason: 'overflow' as const };

  it('throws on an empty summary and caches nothing', async () => {
    const summarize = vi.fn().mockResolvedValue('   ');
    await expect(applySummaryCheckpoint({ ...base, input: history(30), summarize })).rejects.toThrow(/empty/i);
    const ok = vi.fn().mockResolvedValue('S1');
    await applySummaryCheckpoint({ ...base, input: history(30), summarize: ok });
    expect(ok).toHaveBeenCalled();
  });

  it('reuses the checkpoint with zero calls and identical bytes', async () => {
    const summarize = vi.fn().mockResolvedValue('S1');
    const first = await applySummaryCheckpoint({ ...base, input: history(30), summarize });
    const second = await applySummaryCheckpoint({ ...base, input: [...history(30), user('next')], summarize });
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(second.reused).toBe(true);
    expect(second.input[1]).toEqual(first.input[1]);
    expect(decodeCompactionContent((second.input[1] as { encrypted_content: string }).encrypted_content)).toBe('S1');
  });

  it('extends the summary with only the new part when history outgrows it', async () => {
    const summarize = vi.fn().mockResolvedValueOnce('S1').mockResolvedValueOnce('S2');
    await applySummaryCheckpoint({ ...base, input: history(30), summarize });
    const grown = await applySummaryCheckpoint({ ...base, input: history(60), summarize });
    expect(summarize).toHaveBeenCalledTimes(2);
    expect(summarize.mock.calls[1]![1]).toBe('S1');
    expect(summarize.mock.calls[1]![0]).not.toContain('q0 ');
    expect(grown.summarized).toBe(true);
  });

  it('shares one in-flight summary between concurrent calls', async () => {
    let release!: (s: string) => void;
    const summarize = vi.fn().mockImplementation(() => new Promise<string>(r => { release = r; }));
    const a = applySummaryCheckpoint({ ...base, input: history(30), summarize });
    const b = applySummaryCheckpoint({ ...base, input: history(30), summarize });
    await new Promise(r => setTimeout(r, 0));
    release('S1');
    const [ra, rb] = await Promise.all([a, b]);
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(rb.input[1]).toEqual(ra.input[1]);
  });

  it('returns hoisted tools on every turn, including reuse', async () => {
    const ns = { type: 'namespace', name: 'mcp__x', tools: [{ type: 'function', name: 't' }] };
    const input = [user('<environment_context>c</environment_context>'), { type: 'tool_search_call', call_id: 's1' } as ResponsesInputItem, { type: 'tool_search_output', call_id: 's1', tools: [ns] } as ResponsesInputItem, ...history(30).slice(1)];
    const summarize = vi.fn().mockResolvedValue('S1');
    const first = await applySummaryCheckpoint({ ...base, input, summarize });
    const again = await applySummaryCheckpoint({ ...base, input, summarize });
    expect(first.hoistedTools).toEqual([ns]);
    expect(again.hoistedTools).toEqual([ns]);
  });
});

describe('review fixes: checkpoint matching', () => {
  const hist = (n: number): ResponsesInputItem[] => {
    const items: ResponsesInputItem[] = [user('<environment_context>c</environment_context>')];
    for (let i = 0; i < n; i++) items.push(user(`q${i} ${'x'.repeat(1000)}`), asst(`a${i} ${'y'.repeat(1000)}`));
    return items;
  };
  const base = { key: 'm', budgetChars: 30_000, targetChars: 18_000, chunkChars: 1_000_000, summaryReserveChars: 2_000, reason: 'overflow' as const };

  it('hasMatchingCheckpoint is false for a rewound or edited history and drops the stale checkpoint', async () => {
    const { hasMatchingCheckpoint } = await import('../src/codex-auto-summarize.js');
    await applySummaryCheckpoint({ ...base, input: hist(30), summarize: vi.fn().mockResolvedValue('S1') });
    expect(hasMatchingCheckpoint('m', [...hist(30), user('more')])).toBe(true);
    const edited = hist(30);
    edited[1] = user('edited first prompt');
    expect(hasMatchingCheckpoint('m', edited)).toBe(false);
    expect(hasMatchingCheckpoint('m', [...hist(30), user('more')])).toBe(false);
  });

  it('matches items that differ only in id, status or empty annotations', async () => {
    const summarize = vi.fn().mockResolvedValue('S1');
    const withIds = hist(30).map((item, i) => (i % 2 ? { ...item, id: `msg_${i}`, status: 'completed' } : item)) as ResponsesInputItem[];
    await applySummaryCheckpoint({ ...base, input: withIds, summarize });
    const reshaped = hist(30).map((item, i) => (i % 2 ? { ...item, id: `other_${i}` } : item)) as ResponsesInputItem[];
    const again = await applySummaryCheckpoint({ ...base, input: [...reshaped, user('next')], summarize });
    expect(again.reused).toBe(true);
    expect(summarize).toHaveBeenCalledTimes(1);
  });
});
