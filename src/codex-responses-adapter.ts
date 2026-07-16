// OpenAI Responses API (/v1/responses) ↔ Vercel AI SDK. One turn per request; Codex owns the tool loop.
import { streamText, generateText, tool, jsonSchema } from 'ai';
import type { LanguageModel, ModelMessage, ToolSet } from 'ai';
import {
  sseChunk,
  encodeToolUseId,
  splitToolUseId,
  serializeToolResultContent,
  parseToolArguments,
  silenceSdkWarnings,
  grabRoundTripSignature,
  parseDsmlToolCalls,
  type FullStreamPart,
} from './proxy-shared.js';
import {
  deepMergeProviderOptions,
  effortProviderOptions,
  thinkingProviderOptions,
  type ReasoningMetadata,
} from './provider-factory.js';
import { formatUpstreamError } from './codex/upstream-error.js';

export { silenceSdkWarnings };

// ── Responses request shapes ─────────────────────────────────────────────────

export interface ResponsesFunctionCallItem {
  type: 'function_call';
  id?: string;
  call_id: string;
  name: string;
  /** Set when this call targets a nested tool inside a `namespace` wrapper (see ResponsesNamespaceTool). */
  namespace?: string;
  arguments?: string;
}

export interface ResponsesFunctionCallOutputItem {
  type: 'function_call_output';
  call_id: string;
  output: string | unknown;
}

export interface ResponsesMessageItem {
  type?: 'message';
  role: 'user' | 'assistant' | 'developer';
  content: string | Array<{ type: string; text?: string }>;
}

export interface ResponsesReasoningItem {
  type: 'reasoning';
  id?: string;
  summary?: Array<{ type: string; text?: string }>;
}

/** Codex's native managed tool-discovery call — see ResponsesToolSearchTool. */
export interface ResponsesToolSearchCallItem {
  type: 'tool_search_call';
  id?: string;
  call_id: string;
  arguments?: string | Record<string, unknown>;
  status?: string;
}

/** The result of a tool_search_call, surfacing deferred tool definitions (possibly namespace-wrapped). */
export interface ResponsesToolSearchOutputItem {
  type: 'tool_search_output';
  call_id: string;
  id?: string;
  tools?: ResponsesTool[];
}

/** Codex's freeform/custom tool call shape — e.g. apply_patch. See ResponsesCustomTool. */
export interface ResponsesCustomToolCallItem {
  type: 'custom_tool_call';
  id?: string;
  call_id: string;
  name: string;
  input?: unknown;
  status?: string;
}

export interface ResponsesCustomToolCallOutputItem {
  type: 'custom_tool_call_output';
  call_id: string;
  id?: string;
  output?: unknown;
}

/**
 * Newer Codex app-server builds send turn-local tool definitions as an input item
 * instead of (or in addition to) the top-level `tools` array. See liftAdditionalToolsInput.
 */
export interface ResponsesAdditionalToolsItem {
  type: 'additional_tools';
  role?: 'user' | 'assistant' | 'developer';
  content?: ResponsesMessageItem['content'];
  tools?: ResponsesTool[];
}

/**
 * A durable compaction summary item. remote compaction v2 stores the one we emit
 * (see buildCompactionResponseBody) and replays it in later turns' history; we decode
 * its encrypted_content back into a readable message. `context_compaction` is the
 * serde alias Codex also accepts. See translateResponsesInput.
 */
export interface ResponsesCompactionItem {
  type: 'compaction' | 'context_compaction';
  id?: string;
  encrypted_content?: string;
}

export type ResponsesInputItem =
  | ResponsesMessageItem
  | ResponsesFunctionCallItem
  | ResponsesFunctionCallOutputItem
  | ResponsesReasoningItem
  | ResponsesToolSearchCallItem
  | ResponsesToolSearchOutputItem
  | ResponsesCustomToolCallItem
  | ResponsesCustomToolCallOutputItem
  | ResponsesAdditionalToolsItem
  | ResponsesCompactionItem;

export interface ResponsesFunctionTool {
  type: 'function';
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

/**
 * Codex App's proprietary wrapper for MCP server tools. The real ChatGPT backend
 * unwraps this server-side before the model ever sees it; custom Responses-API
 * providers (us) receive it as-is and must flatten it themselves, or the model
 * never sees any usable MCP tools. See translateResponsesTools.
 */
export interface ResponsesNamespaceTool {
  type: 'namespace';
  name: string;
  description?: string;
  tools: ResponsesFunctionTool[];
}

/** Codex's freeform/custom tool definition — e.g. apply_patch. Takes a single opaque input, not a JSON schema. */
export interface ResponsesCustomTool {
  type: 'custom';
  name: string;
  description?: string;
}

/**
 * Codex's native managed tool-search tool (lazy tool discovery for large MCP/connector
 * catalogs). Not a callable function by default — most models can't invoke a bare managed
 * tool type, so we rewrite it into a synthetic function tool (see translateResponsesTools)
 * the model CAN call, then translate the resulting function_call back into a native
 * tool_search_call for Codex (see resolveOutputKind).
 */
export interface ResponsesToolSearchTool {
  type: 'tool_search';
  [key: string]: unknown;
}

export type ResponsesTool = ResponsesFunctionTool | ResponsesNamespaceTool | ResponsesCustomTool | ResponsesToolSearchTool;

export interface ResponsesRequest {
  model: string;
  input: string | ResponsesInputItem[];
  stream?: boolean;
  tools?: ResponsesTool[];
  instructions?: string;
  max_output_tokens?: number;
  temperature?: number;
  previous_response_id?: string;
  reasoning?: { effort?: string; summary?: string };
}

/** A namespace-flattened tool's split-back identity, keyed by its flat SDK tool name. */
export interface CodexNamespaceInfo {
  namespace: string;
  name: string;
  parameters?: Record<string, unknown>;
}

/**
 * Per-request context built while translating the Codex request, needed again when
 * translating the model's response back into Codex's tool-call shapes (namespace
 * split, custom/freeform tools). Rebuilt fresh per request — Codex resends tool
 * defs and replays tool_search_output every turn, so no cross-request state is needed.
 */
export interface CodexToolContext {
  namespaceByFlatName: Map<string, CodexNamespaceInfo>;
  customToolNames: Set<string>;
}

export function createCodexToolContext(): CodexToolContext {
  return { namespaceByFlatName: new Map(), customToolNames: new Set() };
}

export interface CodexSdkCallParams {
  system?: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  maxOutputTokens?: number;
  temperature?: number;
  providerOptions?: Record<string, Record<string, unknown>>;
  /** Non-SDK field — strip before spreading params into streamText/generateText. */
  toolContext?: CodexToolContext;
}

export interface TranslateToolOptions {
  maxTools?: number;
}

export const TOOL_SEARCH_NAME = 'tool_search';

function flatNamespaceName(namespace: string, name: string): string {
  return `${namespace}__${name}`;
}

/** Learn namespace splits and custom tool names from a request's tool defs (upfront or deferred). */
function ingestToolDefs(tools: ResponsesTool[] | undefined, ctx: CodexToolContext): void {
  for (const t of tools ?? []) {
    if (!t || typeof t !== 'object') continue;
    if (t.type === 'namespace') {
      for (const sub of t.tools ?? []) {
        if (sub?.name) {
          ctx.namespaceByFlatName.set(flatNamespaceName(t.name, sub.name), {
            namespace: t.name,
            name: sub.name,
            parameters: sub.parameters,
          });
        }
      }
    } else if (t.type === 'custom' && t.name) {
      ctx.customToolNames.add(t.name);
    }
  }
}

function flattenNamespaceTools(ns: ResponsesNamespaceTool): ResponsesFunctionTool[] {
  return (ns.tools ?? [])
    .filter((sub): sub is ResponsesFunctionTool => sub?.type === 'function' && !!sub.name)
    .map(sub => ({ ...sub, name: flatNamespaceName(ns.name, sub.name) }));
}

/**
 * Newer Codex app-server builds send turn-local tool definitions as an input item
 * (`{type:"additional_tools", tools:[...]}`) instead of the top-level `tools` array.
 * The Vercel AI SDK / Responses translation only reads `tools`, so lift them there
 * before the rest of translation runs, or the model never sees them.
 */
function liftAdditionalToolsInput(
  input: ResponsesInputItem[],
  tools: ResponsesTool[],
): { input: ResponsesInputItem[]; tools: ResponsesTool[] } {
  let lifted: ResponsesTool[] = [];
  const keptInput: ResponsesInputItem[] = [];
  let changed = false;
  for (const item of input) {
    if (item && item.type === 'additional_tools') {
      changed = true;
      if (Array.isArray(item.tools)) lifted = lifted.concat(item.tools);
      if (item.content !== undefined) {
        keptInput.push({ role: item.role ?? 'developer', content: item.content } as ResponsesMessageItem);
      }
      continue;
    }
    keptInput.push(item);
  }
  if (!changed) return { input, tools };
  return { input: keptInput, tools: lifted.length ? [...tools, ...lifted] : tools };
}

type WriteFn = (chunk: string) => void;

function messageText(content: ResponsesMessageItem['content'] | undefined): string {
  if (typeof content === 'string') return content;
  return (content ?? [])
    .map(p => (p.type === 'output_text' || p.type === 'input_text' || p.type === 'text' ? p.text ?? '' : ''))
    .join('');
}

function extractDeveloperAndInstructions(
  items: ResponsesInputItem[],
  instructions?: string,
): { system?: string; remaining: ResponsesInputItem[] } {
  const developerParts: string[] = [];
  const remaining: ResponsesInputItem[] = [];
  for (const item of items) {
    if ('role' in item && item.role === 'developer') {
      const text = messageText(item.content);
      if (text.trim()) developerParts.push(text.trim());
    } else {
      remaining.push(item);
    }
  }
  const parts = [...developerParts];
  if (instructions?.trim()) parts.push(instructions.trim());
  const system = parts.length ? parts.join('\n') : undefined;
  return { system, remaining };
}

function annotateToolNamesFromCalls(items: ResponsesInputItem[]): Map<string, string> {
  const nameByCallId = new Map<string, string>();
  for (const item of items) {
    if (item.type === 'function_call') {
      const { rawId } = splitToolUseId(item.call_id);
      nameByCallId.set(rawId, item.namespace ? flatNamespaceName(item.namespace, item.name) : item.name);
    } else if (item.type === 'tool_search_call') {
      const { rawId } = splitToolUseId(item.call_id);
      nameByCallId.set(rawId, TOOL_SEARCH_NAME);
    } else if (item.type === 'custom_tool_call') {
      const { rawId } = splitToolUseId(item.call_id);
      nameByCallId.set(rawId, item.name);
    }
  }
  return nameByCallId;
}

/** Unwrap a custom/freeform tool's model-supplied input into the raw string Codex expects
 *  (e.g. apply_patch's `*** Begin Patch` body). Mirrors the shapes a model may emit: the
 *  raw patch text itself, a JSON string, a `{command:["apply_patch", patch]}` tuple, or
 *  (fallback) the first string value found in an arbitrarily-named single-field object. */
function customToolInputFromArgs(name: string, args: unknown): string {
  if (typeof args === 'string') {
    const trimmed = args.trim();
    if (name === 'apply_patch' && trimmed.startsWith('*** Begin Patch')) return args;
    try {
      return customToolInputFromArgs(name, JSON.parse(trimmed));
    } catch {
      return args;
    }
  }
  if (args && typeof args === 'object') {
    const obj = args as Record<string, unknown>;
    if (Array.isArray(obj.command) && obj.command[0] === 'apply_patch' && typeof obj.command[1] === 'string') {
      return obj.command[1];
    }
    if (typeof obj.input === 'string') return obj.input;
    for (const v of Object.values(obj)) {
      if (typeof v === 'string') return v;
    }
  }
  return serializeToolResultContent(args);
}

function mergeConsecutiveMessages(messages: ModelMessage[]): ModelMessage[] {
  if (messages.length <= 1) return messages;
  const out: ModelMessage[] = [];
  for (const msg of messages) {
    const prev = out[out.length - 1];
    if (prev && prev.role === msg.role) {
      const prevContent = Array.isArray(prev.content) ? prev.content : [{ type: 'text', text: String(prev.content ?? '') }];
      const msgContent = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content ?? '') }];
      prev.content = [...prevContent, ...msgContent] as typeof prev.content;
    } else {
      out.push(msg);
    }
  }
  return out;
}

function ensureUserFirst(messages: ModelMessage[]): ModelMessage[] {
  if (messages.length === 0) return [{ role: 'user', content: [{ type: 'text', text: '(empty input)' }] } as ModelMessage];
  if (messages[0]!.role === 'assistant') {
    return [{ role: 'user', content: [{ type: 'text', text: '(conversation continued)' }] } as ModelMessage, ...messages];
  }
  return messages;
}

function reasoningSummaryText(item: ResponsesReasoningItem): string {
  return (item.summary ?? [])
    .map(part => (part.type === 'summary_text' ? part.text ?? '' : ''))
    .join('');
}

function makeReasoningOutputItem(id: string, text: string): ResponsesReasoningItem {
  return {
    id,
    type: 'reasoning',
    summary: text.trim() ? [{ type: 'summary_text', text }] : [],
  };
}

export function translateResponsesInput(
  input: string | ResponsesInputItem[],
  instructions: string | undefined,
  npm: string,
  toolContext: CodexToolContext = createCodexToolContext(),
): { system?: string; messages: ModelMessage[]; deferredTools: ResponsesTool[] } {
  if (typeof input === 'string') {
    return {
      system: instructions?.trim() || undefined,
      messages: [{ role: 'user', content: [{ type: 'text', text: input }] } as ModelMessage],
      deferredTools: [],
    };
  }

  const { system, remaining } = extractDeveloperAndInstructions(input, instructions);
  const toolNames = annotateToolNamesFromCalls(remaining);
  const messages: ModelMessage[] = [];
  const deferredTools: ResponsesTool[] = [];
  let pendingReasoning = '';

  for (const item of remaining) {
    if (item.type === 'reasoning') {
      pendingReasoning += reasoningSummaryText(item as ResponsesReasoningItem);
      continue;
    }
    if (item.type === 'function_call') {
      const { rawId, thoughtSignature } = splitToolUseId(item.call_id);
      const parts: Record<string, unknown>[] = [];
      if (pendingReasoning.trim()) {
        parts.push({ type: 'reasoning', text: pendingReasoning });
        pendingReasoning = '';
      }
      const toolPart: Record<string, unknown> = {
        type: 'tool-call',
        toolCallId: rawId,
        toolName: item.namespace ? flatNamespaceName(item.namespace, item.name) : item.name,
        input: parseToolArguments(item.arguments),
      };
      if (thoughtSignature && npm === '@ai-sdk/google') {
        toolPart.providerOptions = { google: { thoughtSignature } };
      }
      parts.push(toolPart);
      messages.push({ role: 'assistant', content: parts } as ModelMessage);
    } else if (item.type === 'function_call_output') {
      const { rawId } = splitToolUseId(item.call_id);
      messages.push({
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: rawId,
          toolName: toolNames.get(rawId) ?? 'unknown',
          output: { type: 'text', value: serializeToolResultContent(item.output) },
        }],
      } as ModelMessage);
    } else if (item.type === 'tool_search_call') {
      const { rawId } = splitToolUseId(item.call_id);
      messages.push({
        role: 'assistant',
        content: [{
          type: 'tool-call',
          toolCallId: rawId,
          toolName: TOOL_SEARCH_NAME,
          input: parseToolArguments(item.arguments),
        }],
      } as ModelMessage);
    } else if (item.type === 'tool_search_output') {
      const { rawId } = splitToolUseId(item.call_id);
      const surfacedTools = item.tools ?? [];
      ingestToolDefs(surfacedTools, toolContext);
      for (const t of surfacedTools) {
        if (t.type === 'namespace') deferredTools.push(...flattenNamespaceTools(t));
        else if (t.type === 'function') deferredTools.push(t);
      }
      messages.push({
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: rawId,
          toolName: TOOL_SEARCH_NAME,
          output: { type: 'text', value: serializeToolResultContent(surfacedTools) },
        }],
      } as ModelMessage);
    } else if (item.type === 'custom_tool_call') {
      const { rawId } = splitToolUseId(item.call_id);
      messages.push({
        role: 'assistant',
        content: [{
          type: 'tool-call',
          toolCallId: rawId,
          toolName: item.name,
          input: { input: typeof item.input === 'string' ? item.input : serializeToolResultContent(item.input) },
        }],
      } as ModelMessage);
    } else if (item.type === 'custom_tool_call_output') {
      const { rawId } = splitToolUseId(item.call_id);
      messages.push({
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: rawId,
          toolName: toolNames.get(rawId) ?? 'unknown',
          output: { type: 'text', value: serializeToolResultContent(item.output) },
        }],
      } as ModelMessage);
    } else if (item.type === 'compaction' || item.type === 'context_compaction') {
      // A prior remote-compaction-v2 summary we emitted (buildCompactionResponseBody),
      // now replayed as history. Decode it back into a readable message so the model
      // still has the compacted context. Undecodable content (e.g. a real-backend item)
      // degrades to an empty summary rather than throwing.
      const summary = decodeCompactionContent(item.encrypted_content) ?? '';
      if (summary.trim()) {
        messages.push({ role: 'user', content: [{ type: 'text', text: `[Summary of earlier conversation]\n${summary}` }] } as ModelMessage);
      }
    } else if ('role' in item) {
      const role = item.role === 'assistant' ? 'assistant' : 'user';
      const text = messageText(item.content);
      messages.push({ role, content: [{ type: 'text', text }] } as ModelMessage);
    }
  }

  return {
    system,
    messages: ensureUserFirst(mergeConsecutiveMessages(messages)),
    deferredTools,
  };
}

const TOOL_SEARCH_DESCRIPTION = 'Search the available deferred Codex tools, plugin tools, MCP namespaces, and connectors by query. Use this when a needed tool is not already present in the current tool list. Returns matching tool definitions for a follow-up call.';
const TOOL_SEARCH_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Search query describing the tool or capability needed.' },
    limit: { type: 'number', description: 'Maximum number of matching tools to return. Defaults to 8.' },
  },
  required: ['query'],
  additionalProperties: false,
};

/** apply_patch and other Codex `custom` tools take one opaque string input, not a JSON schema. */
const CUSTOM_TOOL_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: { input: { type: 'string', description: 'Freeform input for this custom tool (e.g. a patch body).' } },
  required: ['input'],
  additionalProperties: false,
};

export function translateResponsesTools(
  tools?: ResponsesTool[],
  options: TranslateToolOptions = {},
): CodexSdkCallParams['tools'] {
  if (!tools?.length) return undefined;
  const out: Record<string, ReturnType<typeof tool>> = {};
  let toolCount = 0;
  const addTool = (name: string, description: string | undefined, parameters: Record<string, unknown> | undefined): void => {
    if (options.maxTools !== undefined && toolCount >= options.maxTools) return;
    out[name] = tool({
      description: description ?? '',
      inputSchema: jsonSchema(parameters ?? { type: 'object', properties: {} }),
    });
    toolCount++;
  };

  for (const t of tools) {
    if (!t || typeof t !== 'object') continue;
    if (t.type === 'namespace') {
      // Flatten "mcp__<server>" + nested "query_docs" -> "mcp__<server>__query_docs" so the
      // model can call it as a plain function. The response side (resolveOutputKind) splits
      // it back into {namespace, name} before handing the call to Codex — Codex's own MCP
      // dispatcher only recognizes the namespaced shape, not the flat joined name.
      for (const nested of t.tools ?? []) {
        if (nested.type !== 'function' || !nested.name) continue;
        addTool(flatNamespaceName(t.name, nested.name), nested.description, nested.parameters);
      }
      continue;
    }
    if (t.type === 'custom') {
      if (!t.name) continue;
      addTool(t.name, t.description, CUSTOM_TOOL_INPUT_SCHEMA);
      continue;
    }
    if (t.type === 'tool_search') {
      addTool(TOOL_SEARCH_NAME, TOOL_SEARCH_DESCRIPTION, TOOL_SEARCH_PARAMETERS);
      continue;
    }
    if (t.type !== 'function' || !t.name) continue;
    addTool(t.name, t.description, t.parameters);
  }
  return Object.keys(out).length ? out : undefined;
}

export function translateResponsesRequest(
  body: ResponsesRequest,
  npm: string,
  metadata?: ReasoningMetadata,
  options: TranslateToolOptions = {},
): CodexSdkCallParams {
  const toolContext = createCodexToolContext();
  let effectiveTools = body.tools ?? [];
  let effectiveInput = body.input;
  if (Array.isArray(effectiveInput)) {
    const lifted = liftAdditionalToolsInput(effectiveInput, effectiveTools);
    effectiveInput = lifted.input;
    effectiveTools = lifted.tools;
  }
  // Learn namespace/custom tool identities from the upfront tool defs before translating
  // input, so replayed history items (function_call{namespace,...}, custom_tool_call) and
  // the eventual response split resolve consistently against the same context.
  ingestToolDefs(effectiveTools, toolContext);

  const { system, messages, deferredTools } = translateResponsesInput(effectiveInput, body.instructions, npm, toolContext);
  const effort = body.reasoning?.effort;
  const providerOptions = deepMergeProviderOptions(
    thinkingProviderOptions(npm),
    effortProviderOptions(npm, effort, metadata?.upstreamModelId ?? body.model, metadata),
  );
  const tools = translateResponsesTools([...effectiveTools, ...deferredTools], options);
  return {
    system,
    messages,
    tools,
    toolContext,
    maxOutputTokens: body.max_output_tokens,
    temperature: body.temperature,
    providerOptions,
  };
}

function newResponseId(): string {
  return `resp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function newItemId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function usageFromPart(part: FullStreamPart): { input_tokens: number; output_tokens: number; total_tokens: number } {
  const input = part.totalUsage?.inputTokens ?? 0;
  const output = part.totalUsage?.outputTokens ?? 0;
  return { input_tokens: input, output_tokens: output, total_tokens: input + output };
}

interface StreamingToolState {
  itemId: string;
  callId: string;
  name: string;
  outputIndex: number;
  args: string;
}

type ToolOutputKind =
  | { kind: 'namespace'; namespace: string; name: string }
  | { kind: 'tool_search' }
  | { kind: 'custom' }
  | { kind: 'plain' };

/** Decide how a model tool-call should be shaped for Codex, based on the request's tool context. */
function resolveOutputKind(flatName: string, ctx?: CodexToolContext): ToolOutputKind {
  if (!ctx) return { kind: 'plain' };
  if (flatName === TOOL_SEARCH_NAME) return { kind: 'tool_search' };
  if (ctx.customToolNames.has(flatName)) return { kind: 'custom' };
  const ns = ctx.namespaceByFlatName.get(flatName);
  if (ns) return { kind: 'namespace', namespace: ns.namespace, name: ns.name };
  return { kind: 'plain' };
}

/**
 * Build the Codex-facing output item for a completed tool call, per resolveOutputKind.
 * This is the fix for relay-ai/relay-ai#21: Codex's own MCP dispatcher only recognizes
 * the {namespace, name} shape, not the flat joined name we ask the model to call —
 * a plain `function_call{name:"mcp__server__tool"}` reply gets rejected with
 * "unsupported call: mcp__server__tool" (confirmed against a live Codex session).
 */
function buildFinalToolItem(
  kind: ToolOutputKind,
  flatName: string,
  callId: string,
  itemId: string,
  argsStr: string,
): Record<string, unknown> {
  switch (kind.kind) {
    case 'namespace':
      return { type: 'function_call', id: itemId, call_id: callId, namespace: kind.namespace, name: kind.name, arguments: argsStr, status: 'completed' };
    case 'tool_search': {
      const args = parseToolArguments(argsStr);
      if (typeof args.limit === 'string' && /^-?\d+$/.test(args.limit)) args.limit = Number(args.limit);
      return { type: 'tool_search_call', id: itemId, call_id: callId, execution: 'client', arguments: args, status: 'completed' };
    }
    case 'custom':
      return { type: 'custom_tool_call', id: itemId, call_id: callId, name: flatName, input: customToolInputFromArgs(flatName, parseToolArguments(argsStr)), status: 'completed' };
    default:
      return { type: 'function_call', id: itemId, call_id: callId, name: flatName, arguments: argsStr, status: 'completed' };
  }
}

export interface ResponsesStreamSummary {
  reasoningChars: number;
  reasoningPreview: string;
  textChars: number;
  toolCallCount: number;
  toolNames: string[];
  /** Set when writeResponsesStream force-stopped the generation early — see REPEAT_TAIL_CHARS. */
  loopDetected?: 'reasoning' | 'text';
  /** Set when leaked DeepSeek DSML tool-call markup was recovered into real function calls. */
  dsmlToolCallsRecovered?: number;
  /** Set when the stream was aborted (idle timeout — upstream stopped sending data). */
  aborted?: boolean;
  /** Set when the stream ended with an upstream error part (e.g. HTTP 4xx/5xx). */
  errorMessage?: string;
}

export interface ResponsesStreamProgress {
  reasoningChars: number;
  reasoningTail: string;
  textChars: number;
  toolCallCount: number;
  elapsedMs: number;
}

/** Minimum time between onProgress calls, so a genuinely runaway/looping generation is
 *  still visible in the trace log before (or instead of) a final onDone summary. */
const PROGRESS_INTERVAL_MS = 3_000;

/**
 * Observed live: xAI grok-4.5 given a large, tools-stripped compaction request can finish
 * reasoning normally, then free-run regenerating an identical block of text forever instead
 * of reaching `finish` (same trailing 200 chars unchanged across dozens of progress checks
 * while textChars kept climbing). Checked on the same cadence as onProgress, independent of
 * whether tracing is enabled — this is a safety mechanism, not a debug feature.
 */
const REPEAT_TAIL_CHARS = 200;
/** Consecutive stale-tail checks (each PROGRESS_INTERVAL_MS apart) before concluding the
 *  model is looping rather than coincidentally producing similar output between checks. */
const REPEAT_STREAK_LIMIT = 3;
const LOOP_NOTICE = '\n\n[relay-ai: generation stopped after detecting a repetition loop]';

interface RepeatTracker {
  tail: string;
  len: number;
  streak: number;
}

const INITIAL_REPEAT_TRACKER: RepeatTracker = { tail: '', len: 0, streak: 0 };

/** Stale tail + substantial continued growth = regenerating the same content, not just
 *  naturally ending on similar words. Requiring both avoids false positives on a stream
 *  that briefly stalls with no new output at all. */
function trackRepetition(current: string, prev: RepeatTracker): RepeatTracker {
  const tail = current.length >= REPEAT_TAIL_CHARS ? current.slice(-REPEAT_TAIL_CHARS) : current;
  const grew = current.length - prev.len >= REPEAT_TAIL_CHARS;
  const stale = tail.length === REPEAT_TAIL_CHARS && tail === prev.tail && grew;
  return { tail, len: current.length, streak: stale ? prev.streak + 1 : 0 };
}

export interface WriteResponsesStreamOptions {
  /** Called when the stream is force-stopped (repetition loop) BEFORE breaking out of
   *  fullStream. Breaking alone does not cancel the SDK's upstream request — the SDK
   *  keeps consuming internally to settle its own promises — so the caller must abort. */
  onForceStop?: (reason: string) => void;
  /** From translateResponsesRequest — resolves namespace/custom/tool_search tool calls back to Codex's shapes. */
  toolContext?: CodexToolContext;
}

export async function writeResponsesStream(
  fullStream: AsyncIterable<FullStreamPart>,
  modelId: string,
  write: WriteFn,
  onDone?: (summary: ResponsesStreamSummary) => void,
  onProgress?: (progress: ResponsesStreamProgress) => void,
  options?: WriteResponsesStreamOptions,
): Promise<void> {
  const emit = (type: string, data: unknown) => write(sseChunk(type, data));
  const responseId = newResponseId();
  const createdAt = Math.floor(Date.now() / 1000);
  let usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

  emit('response.created', {
    type: 'response.created',
    response: {
      id: responseId,
      object: 'response',
      model: modelId,
      created_at: createdAt,
      status: 'in_progress',
      output: [],
    },
  });

  let outputIndex = 0;
  let textItemId: string | null = null;
  let textOutputIndex = 0;
  let textFull = '';
  const toolStates: StreamingToolState[] = [];
  const toolStatesById = new Map<string, StreamingToolState>();
  let currentToolState: StreamingToolState | null = null;
  const streamStartedAt = Date.now();
  let lastProgressAt = streamStartedAt;
  let reasoningItemId: string | null = null;
  let reasoningText = '';
  let reasoningOutputIndex = 0;
  const outputItems: unknown[] = [];
  let reasoningRepeat = INITIAL_REPEAT_TRACKER;
  let textRepeat = INITIAL_REPEAT_TRACKER;
  let loopDetected: 'reasoning' | 'text' | undefined;

  const ensureTextItem = (): string => {
    if (!textItemId) {
      textItemId = newItemId('msg');
      textOutputIndex = outputIndex;
      outputIndex++;
      emit('response.output_item.added', {
        type: 'response.output_item.added',
        output_index: textOutputIndex,
        item: { id: textItemId, type: 'message', role: 'assistant', status: 'in_progress', content: [] },
      });
      emit('response.content_part.added', {
        type: 'response.content_part.added',
        item_id: textItemId,
        output_index: textOutputIndex,
        content_index: 0,
        part: { type: 'output_text', text: '' },
      });
    }
    return textItemId;
  };

  const rememberToolState = (state: StreamingToolState): StreamingToolState => {
    toolStates.push(state);
    toolStatesById.set(state.itemId, state);
    toolStatesById.set(state.callId, state);
    currentToolState = state;
    return state;
  };

  const createToolState = (
    rawId: string | undefined,
    name: string | undefined,
    signature: string | undefined,
  ): StreamingToolState => {
    const itemId = rawId ?? newItemId('fc');
    const state = rememberToolState({
      itemId,
      callId: encodeToolUseId(itemId, signature, false),
      name: name ?? 'unknown',
      outputIndex: outputIndex++,
      args: '',
    });
    emit('response.output_item.added', {
      type: 'response.output_item.added',
      output_index: state.outputIndex,
      item: {
        type: 'function_call',
        id: state.itemId,
        call_id: state.callId,
        name: state.name,
        arguments: '',
        status: 'in_progress',
      },
    });
    return state;
  };

  const findToolState = (part: FullStreamPart): StreamingToolState | null => {
    const key = part.id ?? part.toolCallId;
    if (key) return toolStatesById.get(key) ?? currentToolState;
    return currentToolState;
  };

  const appendToolArgs = (state: StreamingToolState, delta: string): void => {
    if (!delta) return;
    state.args += delta;
    emit('response.function_call_arguments.delta', {
      type: 'response.function_call_arguments.delta',
      item_id: state.itemId,
      output_index: state.outputIndex,
      delta,
    });
  };

  for await (const part of fullStream) {
    switch (part.type) {
      case 'reasoning-start':
        reasoningText = '';
        reasoningItemId = newItemId('rs');
        reasoningOutputIndex = outputIndex++;
        emit('response.output_item.added', {
          type: 'response.output_item.added',
          output_index: reasoningOutputIndex,
          item: { id: reasoningItemId, type: 'reasoning', summary: [] },
        });
        break;

      case 'reasoning-delta':
        if (!reasoningItemId) {
          reasoningItemId = newItemId('rs');
          reasoningOutputIndex = outputIndex++;
          emit('response.output_item.added', {
            type: 'response.output_item.added',
            output_index: reasoningOutputIndex,
            item: { id: reasoningItemId, type: 'reasoning', summary: [] },
          });
        }
        reasoningText += part.text ?? '';
        break;

      case 'reasoning-end':
        break;

      case 'text-start':
        textFull = '';
        ensureTextItem();
        break;

      case 'text-delta':
        ensureTextItem();
        textFull += part.text ?? '';
        emit('response.output_text.delta', {
          type: 'response.output_text.delta',
          item_id: textItemId,
          output_index: textOutputIndex,
          content_index: 0,
          delta: part.text ?? '',
        });
        break;

      case 'tool-input-start': {
        const sig = grabRoundTripSignature(part);
        createToolState(part.id ?? part.toolCallId, part.toolName, sig);
        break;
      }

      case 'tool-input-delta': {
        const state = findToolState(part);
        if (state) appendToolArgs(state, part.delta ?? part.text ?? '');
        break;
      }

      case 'tool-call': {
        const sig = grabRoundTripSignature(part);
        const key = part.toolCallId ?? part.id;
        const state = (key ? toolStatesById.get(key) : undefined)
          ?? createToolState(key, part.toolName, sig);
        if (!state.args) {
          appendToolArgs(state, JSON.stringify(part.input ?? {}));
        }
        break;
      }

      case 'finish':
        if (part.totalUsage) usage = usageFromPart(part);
        break;

      case 'abort': {
        // The SDK ends the stream cleanly after an abort (no throw), so without
        // this case a timed-out request would finalize as status:"completed" and
        // Codex would treat dead-connection silence as a valid empty answer.
        const msg = `stream aborted: ${part.reason ?? 'no data received from provider'}`;
        process.stderr.write(`[relay-ai] ${modelId}: ${msg}\n`);
        onDone?.({
          reasoningChars: reasoningText.length,
          reasoningPreview: reasoningText.slice(0, 200),
          textChars: textFull.length,
          toolCallCount: toolStates.length,
          toolNames: toolStates.map(t => t.name),
          loopDetected,
          aborted: true,
        });
        emit('response.completed', {
          type: 'response.completed',
          response: {
            id: responseId,
            object: 'response',
            model: modelId,
            created_at: createdAt,
            status: 'failed',
            output: [],
            error: { message: msg, type: 'api_error' },
          },
        });
        return;
      }

      case 'error': {
        const msg = formatUpstreamError(part.error);
        const is429 = msg.includes('429') ||
          (part.error && typeof part.error === 'object' &&
            ((part.error as { statusCode?: number }).statusCode === 429 ||
             (part.error as { lastError?: { statusCode?: number } }).lastError?.statusCode === 429));
        process.stderr.write(`[relay-ai] ${modelId}: ${msg}\n`);
        onDone?.({
          reasoningChars: reasoningText.length,
          reasoningPreview: reasoningText.slice(0, 200),
          textChars: textFull.length,
          toolCallCount: toolStates.length,
          toolNames: toolStates.map(t => t.name),
          loopDetected,
          errorMessage: msg,
        });
        if (is429) {
          writeResponsesRateLimitStream(modelId, msg, write);
        } else {
          emit('response.completed', {
            type: 'response.completed',
            response: {
              id: responseId,
              object: 'response',
              model: modelId,
              created_at: createdAt,
              status: 'failed',
              output: [],
              error: { message: msg, type: 'api_error' },
            },
          });
        }
        return;
      }

      default:
        break;
    }

    const now = Date.now();
    if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
      lastProgressAt = now;
      reasoningRepeat = trackRepetition(reasoningText, reasoningRepeat);
      textRepeat = trackRepetition(textFull, textRepeat);
      if (reasoningRepeat.streak >= REPEAT_STREAK_LIMIT) loopDetected = 'reasoning';
      else if (textRepeat.streak >= REPEAT_STREAK_LIMIT) loopDetected = 'text';

      if (onProgress) {
        onProgress({
          reasoningChars: reasoningText.length,
          reasoningTail: reasoningText.slice(-200),
          textChars: textFull.length,
          toolCallCount: toolStates.length,
          elapsedMs: now - streamStartedAt,
        });
      }

      if (loopDetected) {
        options?.onForceStop?.(`repetition loop detected (${loopDetected})`);
        break;
      }
    }
  }

  if (loopDetected) {
    ensureTextItem();
    textFull += LOOP_NOTICE;
    emit('response.output_text.delta', {
      type: 'response.output_text.delta',
      item_id: textItemId,
      output_index: textOutputIndex,
      content_index: 0,
      delta: LOOP_NOTICE,
    });
  }

  const dsml = loopDetected ? null : parseDsmlToolCalls(textFull);

  if (dsml) {
    // The client already streamed the raw DSML markup live as ordinary text-delta events
    // (we don't know it's a tool-call block until the closing tag arrives) - but the
    // *final* output is what Codex actually acts on, so replace the garbled text item
    // with the real function calls the model intended, matching a normal tool-call turn.
    if (dsml.leadingText && textItemId) {
      emit('response.output_text.done', {
        type: 'response.output_text.done',
        item_id: textItemId,
        output_index: textOutputIndex,
        content_index: 0,
        text: dsml.leadingText,
      });
      emit('response.content_part.done', {
        type: 'response.content_part.done',
        item_id: textItemId,
        output_index: textOutputIndex,
        content_index: 0,
        part: { type: 'output_text', text: dsml.leadingText },
      });
      const textItem = {
        id: textItemId,
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: dsml.leadingText }],
      };
      emit('response.output_item.done', {
        type: 'response.output_item.done',
        output_index: textOutputIndex,
        item: textItem,
      });
      outputItems.push(textItem);
    }
    for (const call of dsml.calls) {
      const itemId = newItemId('fc');
      const callId = encodeToolUseId(itemId, undefined, false);
      const idx = outputIndex++;
      const args = JSON.stringify(call.args);
      emit('response.output_item.added', {
        type: 'response.output_item.added',
        output_index: idx,
        item: { type: 'function_call', id: itemId, call_id: callId, name: call.name, arguments: '', status: 'in_progress' },
      });
      emit('response.function_call_arguments.done', {
        type: 'response.function_call_arguments.done',
        item_id: itemId,
        output_index: idx,
        arguments: args,
      });
      const fcItem = { type: 'function_call', id: itemId, call_id: callId, name: call.name, arguments: args, status: 'completed' };
      emit('response.output_item.done', { type: 'response.output_item.done', output_index: idx, item: fcItem });
      outputItems.push(fcItem);
    }
  } else if (textItemId) {
    emit('response.output_text.done', {
      type: 'response.output_text.done',
      item_id: textItemId,
      output_index: textOutputIndex,
      content_index: 0,
      text: textFull,
    });
    emit('response.content_part.done', {
      type: 'response.content_part.done',
      item_id: textItemId,
      output_index: textOutputIndex,
      content_index: 0,
      part: { type: 'output_text', text: textFull },
    });
    const textItem = {
      id: textItemId,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: textFull }],
    };
    emit('response.output_item.done', {
      type: 'response.output_item.done',
      output_index: textOutputIndex,
      item: textItem,
    });
    outputItems.push(textItem);
  }

  if (reasoningItemId) {
    const reasoningItem = makeReasoningOutputItem(reasoningItemId, reasoningText);
    emit('response.output_item.done', {
      type: 'response.output_item.done',
      output_index: reasoningOutputIndex,
      item: reasoningItem,
    });
    outputItems.unshift(reasoningItem);
  }

  for (const tool of toolStates) {
    emit('response.function_call_arguments.done', {
      type: 'response.function_call_arguments.done',
      item_id: tool.itemId,
      output_index: tool.outputIndex,
      arguments: tool.args,
    });
    const fcItem = buildFinalToolItem(resolveOutputKind(tool.name, options?.toolContext), tool.name, tool.callId, tool.itemId, tool.args);
    emit('response.output_item.done', {
      type: 'response.output_item.done',
      output_index: tool.outputIndex,
      item: fcItem,
    });
    outputItems.push(fcItem);
  }

  if (outputItems.length === 0) {
    outputItems.push({ id: newItemId('msg'), type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '(conversation context was too large to summarize)' }] });
  }

  onDone?.({
    reasoningChars: reasoningText.length,
    reasoningPreview: reasoningText.slice(0, 200),
    textChars: textFull.length,
    toolCallCount: toolStates.length,
    toolNames: toolStates.map(t => t.name),
    loopDetected,
    dsmlToolCallsRecovered: dsml?.calls.length,
  });

  emit('response.completed', {
    type: 'response.completed',
    response: {
      id: responseId,
      object: 'response',
      model: modelId,
      created_at: createdAt,
      status: 'completed',
      output: outputItems,
      usage,
    },
  });
}

/**
 * Observed live: OpenCode Zen silently dropped an upstream connection before sending a
 * single byte — no HTTP error, no stream error, no TCP reset our fetch could see. With
 * no timeout anywhere in this path, the `for await` over fullStream waited forever and
 * every safety mechanism (progress logging, repetition detector) was invisible because
 * they only run when a part arrives. This watchdog is armed immediately (unlike the
 * SDK's `timeout.chunkMs`, which only arms after the first chunk) and reset on every
 * part, so it bounds both zero-byte hangs and mid-stream connection death.
 */
const STREAM_IDLE_TIMEOUT_MS = 120_000;

export interface StreamResponsesOptions {
  idleTimeoutMs?: number;
}

export async function streamResponsesResponse(
  model: LanguageModel,
  params: CodexSdkCallParams,
  modelId: string,
  write: WriteFn,
  onDone?: (summary: ResponsesStreamSummary) => void,
  onProgress?: (progress: ResponsesStreamProgress) => void,
  options?: StreamResponsesOptions,
): Promise<void> {
  const idleTimeoutMs = options?.idleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS;
  const abort = new AbortController();
  let idleTimer = setTimeout(
    () => abort.abort(new Error(`no data received from provider for ${Math.round(idleTimeoutMs / 1000)}s`)),
    idleTimeoutMs,
  );

  const { toolContext, ...sdkParams } = params;
  const result = streamText({ model, ...sdkParams, abortSignal: abort.signal, onError: () => {} } as Parameters<typeof streamText>[0]);
  // Prevent unhandled promise rejections on stream properties:
  Promise.resolve(result.text).catch(() => {});
  Promise.resolve(result.toolCalls).catch(() => {});
  Promise.resolve(result.toolResults).catch(() => {});
  Promise.resolve(result.finishReason).catch(() => {});
  Promise.resolve(result.usage).catch(() => {});
  Promise.resolve(result.response).catch(() => {});

  const watchedStream = (async function* () {
    try {
      for await (const part of result.fullStream as AsyncIterable<FullStreamPart>) {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(
          () => abort.abort(new Error(`no data received from provider for ${Math.round(idleTimeoutMs / 1000)}s`)),
          idleTimeoutMs,
        );
        yield part;
      }
    } finally {
      clearTimeout(idleTimer);
    }
  })();

  await writeResponsesStream(watchedStream, modelId, write, onDone, onProgress, {
    onForceStop: reason => abort.abort(new Error(reason)),
    toolContext,
  });
}

export async function generateResponsesResponse(
  model: LanguageModel,
  params: CodexSdkCallParams,
  modelId: string,
): Promise<Record<string, unknown>> {
  const { toolContext, ...sdkParams } = params;
  const r = await generateText({ model, ...sdkParams } as Parameters<typeof generateText>[0]);
  const createdAt = Math.floor(Date.now() / 1000);
  const responseId = newResponseId();
  const output: unknown[] = [];

  if (r.reasoningText?.trim()) {
    output.push(makeReasoningOutputItem(newItemId('rs'), r.reasoningText));
  }

  if (r.text !== null && r.text !== undefined) {
    output.push({
      id: newItemId('msg'),
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: r.text }],
    });
  }

  for (const tc of r.toolCalls) {
    const encodedId = encodeToolUseId(tc.toolCallId, grabRoundTripSignature(tc as FullStreamPart), false);
    const argsStr = JSON.stringify(tc.input ?? {});
    output.push(buildFinalToolItem(resolveOutputKind(tc.toolName, toolContext), tc.toolName, encodedId, tc.toolCallId, argsStr));
  }

  if (output.length === 0) {
    output.push({ id: newItemId('msg'), type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '(conversation context was too large to summarize)' }] });
  }

  const inputTokens = r.usage?.inputTokens ?? 0;
  const outputTokens = r.usage?.outputTokens ?? 0;

  return {
    id: responseId,
    object: 'response',
    model: modelId,
    created_at: createdAt,
    status: 'completed',
    output,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };
}

// ── Remote compaction v2 ─────────────────────────────────────────────────────
//
// Codex "remote compaction v2" sends a bare {type:"compaction_trigger"} input item
// and its parser (codex-rs/core/src/compact_remote_v2.rs::collect_compaction_output)
// requires the response to contain EXACTLY ONE output item of type "compaction"
// (ResponseItem::Compaction, with a required `encrypted_content` string) plus a
// completed event — anything else is `Fatal("expected exactly one compaction output
// item, got N from M")`. A normal model turn returns reasoning+message (2 items, 0
// compaction), which is the bug. So for a v2 trigger we ask the model for a plain-text
// summary and wrap it as the single compaction item Codex expects. relay-ai is the
// backend for this whole conversation, so `encrypted_content` is opaque to Codex — we
// just base64-encode the summary and decode it on replay (see translateResponsesInput).

/** Injected as the final user turn on a v2 compaction request (the trigger carries no prompt). */
export const COMPACTION_SUMMARY_INSTRUCTION =
  'You are performing a CONTEXT CHECKPOINT COMPACTION. Summarize the conversation so far into a concise but complete summary that preserves the user\'s goals, key decisions and facts, the current state of the work, and any pending or in-progress tasks. Output only the summary text.';

function encodeCompactionContent(summary: string): string {
  return Buffer.from(JSON.stringify({ v: 1, summary }), 'utf8').toString('base64');
}

/** Inverse of encodeCompactionContent. Returns null for content we didn't produce
 *  (e.g. a real-OpenAI-backend item) so callers degrade gracefully instead of throwing. */
export function decodeCompactionContent(encrypted: string | undefined): string | null {
  if (!encrypted) return null;
  try {
    const obj = JSON.parse(Buffer.from(encrypted, 'base64').toString('utf8')) as { summary?: unknown };
    return typeof obj?.summary === 'string' ? obj.summary : null;
  } catch {
    return null;
  }
}

function makeCompactionItem(summary: string): Record<string, unknown> {
  return { type: 'compaction', id: newItemId('cmp'), encrypted_content: encodeCompactionContent(summary) };
}

/** Append the summarization instruction as a final user turn so the model produces a summary. */
export function appendCompactionInstruction(params: CodexSdkCallParams): CodexSdkCallParams {
  return {
    ...params,
    tools: undefined,
    messages: [
      ...params.messages,
      { role: 'user', content: [{ type: 'text', text: COMPACTION_SUMMARY_INSTRUCTION }] } as ModelMessage,
    ],
  };
}

/** The full non-streaming Responses body for a v2 compaction turn: exactly one compaction item. */
export function buildCompactionResponseBody(summary: string, modelId: string): Record<string, unknown> {
  return {
    id: newResponseId(),
    object: 'response',
    model: modelId,
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    output: [makeCompactionItem(summary)],
  };
}

/** Emit the SSE form of a v2 compaction turn (created → output_item added/done → completed). */
export function writeCompactionSse(summary: string, modelId: string, write: WriteFn): void {
  const emit = (type: string, data: unknown) => write(sseChunk(type, data));
  const responseId = newResponseId();
  const createdAt = Math.floor(Date.now() / 1000);
  const item = makeCompactionItem(summary);
  emit('response.created', {
    type: 'response.created',
    response: { id: responseId, object: 'response', model: modelId, created_at: createdAt, status: 'in_progress', output: [] },
  });
  emit('response.output_item.added', { type: 'response.output_item.added', output_index: 0, item });
  emit('response.output_item.done', { type: 'response.output_item.done', output_index: 0, item });
  emit('response.completed', {
    type: 'response.completed',
    response: { id: responseId, object: 'response', model: modelId, created_at: createdAt, status: 'completed', output: [item] },
  });
}

/** Run the model to produce a summary, return it as the single-compaction-item Responses body. */
export async function generateCompactionResponse(
  model: LanguageModel,
  params: CodexSdkCallParams,
  modelId: string,
): Promise<Record<string, unknown>> {
  const { toolContext: _toolContext, ...sdkParams } = params;
  void _toolContext;
  const r = await generateText({ model, ...sdkParams } as Parameters<typeof generateText>[0]);
  return buildCompactionResponseBody((r.text ?? '').trim() || '(no summary produced)', modelId);
}

/** Streaming variant: summarize internally (compaction is non-interactive), then emit the SSE. */
export async function streamCompactionResponse(
  model: LanguageModel,
  params: CodexSdkCallParams,
  modelId: string,
  write: WriteFn,
): Promise<void> {
  const { toolContext: _toolContext, ...sdkParams } = params;
  void _toolContext;
  const r = await generateText({ model, ...sdkParams } as Parameters<typeof generateText>[0]);
  writeCompactionSse((r.text ?? '').trim() || '(no summary produced)', modelId, write);
}

export function responsesErrorBody(
  modelId: string,
  message: string,
  statusCode = 401,
): Record<string, unknown> {
  return {
    id: newResponseId(),
    object: 'response',
    model: modelId,
    created_at: Math.floor(Date.now() / 1000),
    status: 'failed',
    output: [],
    error: { message, type: statusCode === 429 ? 'rate_limit_error' : 'api_error', code: String(statusCode) },
  };
}

export function writeResponsesErrorStream(modelId: string, message: string, write: WriteFn, statusCode = 401): void {
  write(sseChunk('response.completed', {
    type: 'response.completed',
    response: responsesErrorBody(modelId, message, statusCode),
  }));
}

export function writeResponsesRateLimitStream(modelId: string, message: string, write: WriteFn): void {
  const responseId = newResponseId();
  const itemId = newItemId('msg');
  const createdAt = Math.floor(Date.now() / 1000);
  const content = [{ type: 'output_text', text: message }];
  write(sseChunk('response.created', {
    type: 'response.created',
    response: {
      id: responseId,
      object: 'response',
      model: modelId,
      created_at: createdAt,
      status: 'in_progress',
      output: [],
    },
  }));
  write(sseChunk('response.output_item.added', {
    type: 'response.output_item.added',
    output_index: 0,
    item: { id: itemId, type: 'message', role: 'assistant', status: 'in_progress', content: [] },
  }));
  write(sseChunk('response.content_part.added', {
    type: 'response.content_part.added',
    item_id: itemId, output_index: 0, content_index: 0,
    part: { type: 'output_text', text: '' },
  }));
  write(sseChunk('response.output_text.delta', {
    type: 'response.output_text.delta',
    item_id: itemId, output_index: 0, content_index: 0,
    delta: message,
  }));
  write(sseChunk('response.output_text.done', {
    type: 'response.output_text.done',
    item_id: itemId, output_index: 0, content_index: 0,
    text: message,
  }));
  write(sseChunk('response.content_part.done', {
    type: 'response.content_part.done',
    item_id: itemId, output_index: 0, content_index: 0,
    part: { type: 'output_text', text: message },
  }));
  write(sseChunk('response.output_item.done', {
    type: 'response.output_item.done',
    output_index: 0,
    item: { id: itemId, type: 'message', role: 'assistant', status: 'completed', content },
  }));
  write(sseChunk('response.completed', {
    type: 'response.completed',
    response: {
      id: responseId, object: 'response', model: modelId, created_at: createdAt,
      status: 'completed',
      output: [{ id: itemId, type: 'message', role: 'assistant', status: 'completed', content }],
    },
  }));
}

export function responsesRateLimitBody(modelId: string, message: string): Record<string, unknown> {
  const itemId = newItemId('msg');
  const content = [{ type: 'output_text', text: message }];
  return {
    id: newResponseId(),
    object: 'response',
    model: modelId,
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    output: [{ id: itemId, type: 'message', role: 'assistant', status: 'completed', content }],
  };
}
