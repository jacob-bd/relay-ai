import { streamText } from 'ai';
import { createRelayModel } from './core/model.js';
import { loadRegistry } from './registry/io.js';
import { getProviderModels } from './registry/provider-models.js';
import { upstreamHttpStatus } from './codex/upstream-error.js';

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
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    // Never return raw upstream errors: they can contain keys, headers or request bodies.
    const status = upstreamHttpStatus(error, '');
    const message = abortSignal.aborted ? 'No response within 30 seconds, or the test was cancelled.'
      : status === 401 || status === 403 ? 'Access denied. Check the provider key or sign in again.'
      : status === 429 ? 'Provider rate limit reached. Try again later.'
      : status === 402 ? 'Provider quota or credits exhausted.'
      : 'The model could not respond. Check the provider credentials and connection, then try again.';
    return { ok: false, error: message };
  }
}
