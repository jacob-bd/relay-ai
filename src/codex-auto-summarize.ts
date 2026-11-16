/**
 * Relay-side auto-summarize for Codex routes (#94, #95).
 *
 * Codex never sees the summary: it keeps resending its full history. So the
 * summary is stored as a per-conversation checkpoint and reused byte-for-byte
 * while the request still fits, which keeps the provider's prompt cache warm.
 * Splits only happen between atomic units, so a tool call is never separated
 * from its result (providers reject that with HTTP 400).
 */
import { createHash } from 'node:crypto';
import {
  COMPACTION_SUMMARY_INSTRUCTION,
  decodeCompactionContent,
  makeCompactionItem,
  type CodexSdkCallParams,
  type ResponsesInputItem,
  type ResponsesTool,
} from './codex-responses-adapter.js';
import { estimateInputItemChars } from './codex-context-budget.js';

export type AutoSummarizeMode = 'all' | 'overflow' | 'off';

export function autoSummarizeMode(env: NodeJS.ProcessEnv = process.env): AutoSummarizeMode {
  const v = env.RELAY_AI_AUTO_SUMMARIZE?.trim().toLowerCase();
  return v === 'off' || v === 'overflow' ? v : 'all';
}

const CALL_TYPES = new Set(['function_call', 'custom_tool_call', 'tool_search_call']);
const OUTPUT_TYPES = new Set(['function_call_output', 'custom_tool_call_output', 'tool_search_output']);
const HOST_CONTEXT_MARKERS = ['# AGENTS.md instructions', '<environment_context>', '<user_instructions>', '<permissions instructions>', '<collaboration_mode>'];
const PER_ITEM_TRANSCRIPT_CAP = 20_000;
const CHECKPOINT_LIMIT = 64;

type Item = ResponsesInputItem & Record<string, unknown>;

const role = (item: ResponsesInputItem): string | undefined => ('role' in item ? (item as { role?: string }).role : undefined);
const callId = (item: ResponsesInputItem): string | undefined => (item as { call_id?: string }).call_id;
const isUserMessage = (item: ResponsesInputItem) => role(item) === 'user' && (item.type === undefined || item.type === 'message');
const isCompaction = (item: ResponsesInputItem) => item.type === 'compaction' || item.type === 'context_compaction';

function isHistoryItem(item: ResponsesInputItem): boolean {
  return CALL_TYPES.has(item.type ?? '') || role(item) === 'assistant' || item.type === 'reasoning' || isCompaction(item);
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(p => {
    const part = p as { type?: string; text?: string };
    if (typeof part.text === 'string') return part.text;
    if (part.type === 'input_image' || part.type === 'image') return '[image]';
    return '';
  }).join('');
}

function isPinned(item: ResponsesInputItem, inPreamble: boolean): boolean {
  if (role(item) === 'developer') return true;
  if (!inPreamble || !isUserMessage(item)) return false;
  const text = messageText((item as { content?: unknown }).content).trimStart();
  return HOST_CONTEXT_MARKERS.some(m => text.startsWith(m));
}

function partitionPinned(input: ResponsesInputItem[]): { pinned: ResponsesInputItem[]; rest: ResponsesInputItem[] } {
  const pinned: ResponsesInputItem[] = [];
  const rest: ResponsesInputItem[] = [];
  let inPreamble = true;
  for (const item of input) {
    if (isHistoryItem(item)) inPreamble = false;
    (isPinned(item, inPreamble) ? pinned : rest).push(item);
  }
  return { pinned, rest };
}

/** Atomic units: never split inside one. */
export function toUnits(input: ResponsesInputItem[]): ResponsesInputItem[][] {
  const units: ResponsesInputItem[][] = [];
  let current: ResponsesInputItem[] | undefined;
  let currentKind: 'message' | 'assistant' | undefined;
  const open = new Set<string>();
  for (const item of input) {
    const type = item.type ?? 'message';
    if (open.size > 0) {
      current!.push(item);
      const id = callId(item);
      if (OUTPUT_TYPES.has(type) && id) open.delete(id);
      else if (CALL_TYPES.has(type) && id) open.add(id);
      continue;
    }
    const messageLike = (type === 'message' && role(item) !== 'assistant') || type === 'additional_tools' || isCompaction(item);
    if (messageLike) {
      current = [item];
      currentKind = 'message';
      units.push(current);
      continue;
    }
    const lastType = current?.[current.length - 1]?.type ?? '';
    if (currentKind !== 'assistant' || OUTPUT_TYPES.has(lastType)) {
      current = [];
      currentKind = 'assistant';
      units.push(current);
    }
    current!.push(item);
    const id = callId(item);
    if (CALL_TYPES.has(type) && id) open.add(id);
  }
  return units;
}

const unitChars = (unit: ResponsesInputItem[]) => unit.reduce((n, i) => n + estimateInputItemChars(i), 0);

function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  const marker = `\n[... ${text.length - max} chars clipped ...]\n`;
  const edge = Math.max(1, Math.floor((max - marker.length) / 2));
  return text.slice(0, edge) + marker + text.slice(-edge);
}

/** Shrinks the large text fields of one unit so it fits `budget` chars. */
function clipUnit(unit: ResponsesInputItem[], budget: number): ResponsesInputItem[] {
  const total = unitChars(unit);
  if (total <= budget) return unit;
  return unit.map(item => {
    const it = item as Item;
    const share = Math.max(1_000, Math.floor(budget * (estimateInputItemChars(item) / total)));
    if (typeof it.output === 'string') return { ...it, output: clipText(it.output, share) } as ResponsesInputItem;
    if (typeof it.arguments === 'string') return { ...it, arguments: clipText(it.arguments, share) } as ResponsesInputItem;
    if (Array.isArray(it.content)) {
      return { ...it, content: (it.content as Array<{ text?: string }>).map(p => (typeof p.text === 'string' ? { ...p, text: clipText(p.text, share) } : p)) } as ResponsesInputItem;
    }
    return item;
  });
}

export function splitForSummary(
  input: ResponsesInputItem[],
  opts: { tailCharBudget: number },
): { pinned: ResponsesInputItem[]; head: ResponsesInputItem[]; tail: ResponsesInputItem[] } | undefined {
  const { pinned, rest } = partitionPinned(input);
  const split = splitUnpinned(rest, opts.tailCharBudget);
  return split && { pinned, ...split };
}

function splitUnpinned(rest: ResponsesInputItem[], tailCharBudget: number): { head: ResponsesInputItem[]; tail: ResponsesInputItem[] } | undefined {
  const opts = { tailCharBudget };
  const units = toUnits(rest);
  if (units.length < 2) return undefined;
  let used = 0;
  let start = units.length;
  for (let i = units.length - 1; i >= 0; i--) {
    const c = unitChars(units[i]!);
    if (start < units.length && used + c > opts.tailCharBudget) break;
    used += c;
    start = i;
  }
  if (start === 0) return undefined;
  const tailUnits = units.slice(start);
  if (tailUnits.length === 1) tailUnits[0] = clipUnit(tailUnits[0]!, opts.tailCharBudget);
  return { head: units.slice(0, start).flat(), tail: tailUnits.flat() };
}

export function hoistToolDefinitions(head: ResponsesInputItem[]): { tools: ResponsesTool[] } {
  const tools: ResponsesTool[] = [];
  for (const item of head) {
    if ((item.type === 'additional_tools' || item.type === 'tool_search_output') && Array.isArray((item as { tools?: unknown }).tools)) {
      tools.push(...((item as { tools: ResponsesTool[] }).tools));
    }
  }
  return { tools };
}

function renderItem(item: ResponsesInputItem): string {
  const it = item as Item;
  const type = item.type ?? 'message';
  if (isCompaction(item)) return `[Earlier summary]\n${decodeCompactionContent(it.encrypted_content as string | undefined) ?? ''}`;
  if (type === 'message' || type === 'agent_message') return `${(role(item) ?? 'assistant').toUpperCase()}: ${messageText(it.content)}`;
  if (type === 'reasoning') return `ASSISTANT (thinking): ${messageText(it.summary)}`;
  if (type === 'function_call') return `ASSISTANT called tool ${it.namespace ? `${String(it.namespace)}.` : ''}${String(it.name)}(${String(it.arguments ?? '')})`;
  if (type === 'custom_tool_call') return `ASSISTANT called tool ${String(it.name)}: ${typeof it.input === 'string' ? it.input : JSON.stringify(it.input ?? '')}`;
  if (type === 'tool_search_call') return 'ASSISTANT searched for tools';
  if (type === 'tool_search_output') return `TOOL SEARCH returned ${Array.isArray(it.tools) ? it.tools.length : 0} tool group(s)`;
  if (type === 'additional_tools') return '[tools were added]';
  if (OUTPUT_TYPES.has(type)) {
    const output = it.output;
    const text = typeof output === 'string' ? output : Array.isArray(output) ? messageText(output) : JSON.stringify(output ?? '');
    return `TOOL RESULT: ${text}`;
  }
  return `[${type}]`;
}

/** Plain-text transcript: no tool wire blocks, so any provider accepts it. */
export function renderTranscript(items: ResponsesInputItem[]): string {
  return items
    .map(item => clipText(renderItem(item), PER_ITEM_TRANSCRIPT_CAP).replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, '[image]'))
    .join('\n\n');
}

export function buildSummaryParams(transcript: string, previousSummary?: string): CodexSdkCallParams {
  const prefix = previousSummary ? `Summary of the conversation so far:\n${previousSummary}\n\nLater conversation to fold into the summary:\n` : 'Conversation to summarize:\n';
  return {
    messages: [{ role: 'user', content: [{ type: 'text', text: `${prefix}${transcript}\n\n${COMPACTION_SUMMARY_INSTRUCTION}` }] }],
    maxOutputTokens: 4_000,
  } as CodexSdkCallParams;
}

interface Checkpoint {
  headLength: number;
  headHash: string;
  summary: string;
  hoistedTools: ResponsesTool[];
}

const checkpoints = new Map<string, Checkpoint>();
const inFlight = new Map<string, Promise<Checkpoint>>();

function chainHashes(items: ResponsesInputItem[]): string[] {
  const out: string[] = [];
  let h = '';
  for (const item of items) {
    h = createHash('sha256').update(h).update(JSON.stringify(item)).digest('hex');
    out.push(h);
  }
  return out;
}

function remember(key: string, cp: Checkpoint): void {
  checkpoints.delete(key);
  checkpoints.set(key, cp);
  while (checkpoints.size > CHECKPOINT_LIMIT) {
    const oldest = checkpoints.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    checkpoints.delete(oldest);
  }
}

function assemble(pinned: ResponsesInputItem[], cp: Checkpoint, after: ResponsesInputItem[]): ResponsesInputItem[] {
  const item = makeCompactionItem(cp.summary, `cmp_${cp.headHash.slice(0, 24)}`) as unknown as ResponsesInputItem;
  return [...pinned, item, ...after];
}

const charsOf = (items: ResponsesInputItem[]) => items.reduce((n, i) => n + estimateInputItemChars(i), 0);

export interface ApplySummaryArgs {
  input: ResponsesInputItem[];
  key: string;
  /** Max chars of input (excluding instructions/tools) that may be sent. */
  budgetChars: number;
  /** Input size to aim for after a new summary. */
  targetChars: number;
  /** Max transcript chars per summary call. */
  chunkChars: number;
  summaryReserveChars: number;
  reason: 'overflow' | 'switch';
  summarize: (transcript: string, previousSummary?: string) => Promise<string>;
}

export interface ApplySummaryResult {
  input: ResponsesInputItem[];
  hoistedTools: ResponsesTool[];
  summarized: boolean;
  reused: boolean;
  summarizedItems: number;
}

export async function applySummaryCheckpoint(args: ApplySummaryArgs): Promise<ApplySummaryResult> {
  const { pinned, rest } = partitionPinned(args.input);
  const hashes = chainHashes(rest);
  const existing = checkpoints.get(args.key);
  const matches = existing && existing.headLength <= rest.length && hashes[existing.headLength - 1] === existing.headHash;

  if (existing && matches) {
    const reused = assemble(pinned, existing, rest.slice(existing.headLength));
    if (charsOf(reused) <= args.budgetChars) {
      remember(args.key, existing);
      return { input: reused, hoistedTools: existing.hoistedTools, summarized: false, reused: true, summarizedItems: 0 };
    }
  }

  const base = existing && matches ? existing : undefined;
  const covered = base?.headLength ?? 0;
  const remainder = rest.slice(covered);
  const tailBudget = Math.max(1, args.targetChars - charsOf(pinned) - args.summaryReserveChars);
  const split = splitUnpinned(remainder, tailBudget);
  if (!split || split.head.length === 0) {
    if (base) return { input: assemble(pinned, base, remainder), hoistedTools: base.hoistedTools, summarized: false, reused: true, summarizedItems: 0 };
    return { input: args.input, hoistedTools: [], summarized: false, reused: false, summarizedItems: 0 };
  }

  const headLength = covered + split.head.length;
  const headHash = hashes[headLength - 1]!;
  const flightKey = `${args.key}\u0000${headHash}`;
  let pending = inFlight.get(flightKey);
  if (!pending) {
    pending = (async () => {
      let summary = base?.summary;
      let chunk: ResponsesInputItem[] = [];
      let chunkLen = 0;
      const flush = async () => {
        if (chunk.length === 0) return;
        const next = await args.summarize(renderTranscript(chunk), summary);
        if (!next.trim()) throw new Error('auto-summarize: provider returned an empty summary');
        summary = next;
        chunk = [];
        chunkLen = 0;
      };
      for (const item of split.head) {
        const c = Math.min(estimateInputItemChars(item), PER_ITEM_TRANSCRIPT_CAP);
        if (chunkLen + c > args.chunkChars) await flush();
        chunk.push(item);
        chunkLen += c;
      }
      await flush();
      const cp: Checkpoint = {
        headLength,
        headHash,
        summary: summary!,
        hoistedTools: [...(base?.hoistedTools ?? []), ...hoistToolDefinitions(split.head).tools],
      };
      remember(args.key, cp);
      return cp;
    })();
    inFlight.set(flightKey, pending);
    pending.then(() => inFlight.delete(flightKey), () => inFlight.delete(flightKey));
  }
  const cp = await pending;
  return { input: assemble(pinned, cp, split.tail), hoistedTools: cp.hoistedTools, summarized: true, reused: false, summarizedItems: split.head.length };
}

export function __resetAutoSummarizeForTests(): void {
  checkpoints.clear();
  inFlight.clear();
}
