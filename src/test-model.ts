import { streamText } from 'ai';
import { createRelayModel } from './core/model.js';
import { loadRegistry } from './registry/io.js';
import { getProviderModels } from './registry/provider-models.js';
import { upstreamHttpStatus } from './codex/upstream-error.js';
import { cachedModelToLocal } from './registry/materialize.js';
import { setContextWindowOverride, setModelNotChat } from './registry/crud.js';

/** Far above any real context window, so a server that checks will refuse it and state its limit. */
const CONTEXT_PROBE_MAX_TOKENS = 100_000_000;

// "maximum context length is N", vLLM's "max_model_len=N". Output-token limits are deliberately not matched.
const CONTEXT_LIMIT_PATTERNS = [
  /max_model_len\s*=\s*(?:max_total_tokens\s*=\s*)?(\d[\d,_]*)/i,
  /maximum context (?:length|window|size)[^0-9]{0,40}?(\d[\d,_]*)/i,
  /context (?:length|window|size) (?:limit )?(?:is|of)[^0-9]{0,10}(\d[\d,_]*)\s*tokens/i,
];

/** The context limit a server states in an error message, or undefined if it states none. */
export function parseContextLimit(text: string): number | undefined {
  for (const pattern of CONTEXT_LIMIT_PATTERNS) {
    const match = pattern.exec(text);
    if (!match?.[1]) continue;
    const value = Number(match[1].replace(/[,_]/g, ''));
    if (Number.isSafeInteger(value) && value >= 1_000 && value < CONTEXT_PROBE_MAX_TOKENS) return value;
  }
  return undefined;
}

function errorText(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error ?? '');
  const e = error as { message?: unknown; responseBody?: unknown; cause?: unknown };
  return [e.message, e.responseBody, e.cause && typeof e.cause === 'object' ? (e.cause as { message?: unknown }).message : undefined]
    .filter((part): part is string => typeof part === 'string')
    .join(' ');
}

const NOT_CHAT_PATTERN = /not a chat model|does not support chat|chat(?: completions?)? (?:is |are )?not supported|only supports? (?:embeddings?|rerank)|is an embedding model/i;

/**
 * True when a failed chat request shows the model is not a chat model: the server says so, or the
 * chat address answers a bare 404 "Not Found" (embedding models on vLLM gateways). A 404 that says
 * anything more ("model not found", "unsupported path") is not counted: the model may chat elsewhere.
 */
export function isNotChatRefusal(error: unknown): boolean {
  const text = errorText(error);
  if (NOT_CHAT_PATTERN.test(text)) return true;
  const status = error && typeof error === 'object' ? (error as { statusCode?: unknown }).statusCode : undefined;
  const letters = text.toLowerCase().replace(/[^a-z]/g, '');
  return status === 404 && /^(?:detail|notfound)+$/.test(letters);
}

/**
 * One request asking for an impossible output length. Many servers refuse it and state their real
 * context size; how the server answers also shows whether the model takes chat requests at all.
 */
export async function probeModel(providerId: string, modelId: string, signal: AbortSignal): Promise<{ limit?: number; chat?: boolean }> {
  const inspect = (error: unknown): { limit?: number; chat?: boolean } => {
    const limit = parseContextLimit(errorText(error));
    if (limit !== undefined) return { limit, chat: true };
    return isNotChatRefusal(error) ? { chat: false } : {};
  };
  try {
    const model = await createRelayModel(`${providerId}::${modelId}`);
    const result = streamText({ model, prompt: 'Reply with OK.', maxOutputTokens: CONTEXT_PROBE_MAX_TOKENS,
      maxRetries: 0, abortSignal: signal, onError: () => {} });
    for await (const part of result.stream) {
      if (part.type === 'error') return inspect(part.error);
      if (part.type === 'finish') return { chat: true };
    }
    return {};
  } catch (error) {
    return inspect(error);
  }
}

export async function measureContextWindow(providerId: string, modelId: string, signal: AbortSignal): Promise<number | undefined> {
  return (await probeModel(providerId, modelId, signal)).limit;
}

export interface ContextCheckResult {
  /** Size the server stated, or undefined when it stated none. */
  measured?: number;
  /** Size Relay showed before the test. */
  previous?: number;
  /** True when the measured size differed from the shown one and was saved. */
  updated: boolean;
  /** True when the size was written as 'measured' (a change, or confirming a guess). */
  saved?: boolean;
  /** True when a hand-typed size was kept instead of the measured one. */
  keptManual: boolean;
  /** true = the server refused chat for this model; false = it took the chat request; absent = unclear. */
  notChat?: boolean;
}

function rememberChatResult(providerId: string, modelId: string, chat: boolean | undefined): void {
  if (chat === undefined) return;
  try {
    setModelNotChat(providerId, modelId, !chat);
  } catch {
    // Display hint only; a failed save must not fail the test.
  }
}

export async function checkContextWindow(providerId: string, modelId: string, signal?: AbortSignal): Promise<ContextCheckResult> {
  const timeout = AbortSignal.timeout(20_000);
  const probe = await probeModel(providerId, modelId, signal ? AbortSignal.any([signal, timeout]) : timeout);
  const measured = probe.limit;
  rememberChatResult(providerId, modelId, probe.chat);
  const notChat = probe.chat === undefined ? {} : { notChat: !probe.chat };
  const provider = loadRegistry().providers.find(p => p.id === providerId);
  const cached = provider ? getProviderModels(provider).find(m => m.id === modelId) : undefined;
  const previous = provider && cached ? cachedModelToLocal(cached, provider)?.contextWindow : undefined;
  const keptManual = provider?.contextWindowOverrides?.[modelId]?.source === 'user';
  // A guess (not reported, typed or measured) that the server confirms is saved too, so it stops being an estimate.
  const confirmsGuess = measured !== undefined && measured === previous
    && (cached?.contextWindowSource === undefined || cached.contextWindowSource === 'models.dev');
  if (measured === undefined || keptManual || (measured === previous && !confirmsGuess)) {
    return { measured, previous, updated: false, keptManual: keptManual && measured !== undefined && measured !== previous, ...notChat };
  }
  let saved = false;
  try {
    saved = setContextWindowOverride(providerId, modelId, measured, 'measured').ok;
  } catch {
    // Still report what the server said; the next Test can save it.
  }
  return { measured, previous, updated: saved && measured !== previous, saved, keptManual: false, ...notChat };
}

/** One bounded inference request, not a model-list/credential-storage check. */
export async function testModel(providerId: string, modelId: string, signal?: AbortSignal) {
  const provider = loadRegistry().providers.find(p => p.id === providerId);
  if (!provider?.enabled || !getProviderModels(provider).some(m => m.id === modelId)) {
    return { ok: false, error: 'Model is no longer available. Refresh this provider.' };
  }
  const started = Date.now();
  const timeout = AbortSignal.timeout(30_000);
  const abortSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const model = await createRelayModel(`${providerId}::${modelId}`);
    abortSignal.throwIfAborted();
    const result = streamText({ model, prompt: 'Reply with OK.', maxOutputTokens: 1024,
      maxRetries: 0, abortSignal, onError: () => {} });
    let text = '';
    let finished = false;
    for await (const part of result.stream) {
      if (part.type === 'error') throw part.error;
      if (part.type === 'text-delta') text += part.text;
      if (part.type === 'finish') finished = true;
    }
    abortSignal.throwIfAborted();
    if (!finished || !text.trim()) {
      return { ok: false, error: 'The model returned no complete text response. Try again or choose another model.' };
    }
    const latencyMs = Date.now() - started;
    const context = await checkContextWindow(providerId, modelId, signal).catch(() => undefined);
    // A text reply proves the model takes chat requests, whatever the follow-up size check showed.
    rememberChatResult(providerId, modelId, true);
    if (context) context.notChat = false;
    return { ok: true, latencyMs, notChat: false, ...(context ? { context } : {}) };
  } catch (error) {
    if (!abortSignal.aborted && isNotChatRefusal(error)) {
      rememberChatResult(providerId, modelId, false);
      return { ok: false, notChat: true, error: 'This is not a chat model (the server refused the chat request), so Relay cannot use it. You can hide it.' };
    }
    // Never return raw upstream errors: they can contain keys, headers or request bodies.
    const status = upstreamHttpStatus(error, '');
    const text = errorText(error);
    const message = abortSignal.aborted ? 'No response within 30 seconds, or the test was cancelled.'
      : status === 404 && /unsupported_path|not an? (?:\w+ )?surface/i.test(text)
        ? "This provider's endpoint doesn't serve this model. Try the same model on your other provider for this gateway (e.g. the OpenAI-style one)."
      : status === 403 && /subscription .* does not include model/i.test(text) ? "Your plan doesn't include this model."
      : status === 401 || status === 403 ? 'Access denied. Check the provider key or sign in again.'
      : status === 429 ? 'Provider rate limit reached. Try again later.'
      : status === 402 ? 'Provider quota or credits exhausted.'
      : 'The model could not respond. Check the provider credentials and connection, then try again.';
    return { ok: false, error: message };
  }
}
