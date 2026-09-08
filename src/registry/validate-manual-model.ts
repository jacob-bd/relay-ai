import { randomUUID } from 'node:crypto';
import { streamText, type LanguageModel, type ModelMessage } from 'ai';
import { createLanguageModel } from '../provider-factory.js';
import { translateRequest, type SdkCallParams } from '../sdk-adapter.js';
import type { RegistryProvider } from './types.js';

/** Consume every event: HTTP 200 and a partial answer do not establish success. */
async function completeStream(model: LanguageModel, params: SdkCallParams, signal: AbortSignal) {
  const { subagentRouting: _routing, ...call } = params;
  const result = streamText({ model, ...call, maxRetries: 0, abortSignal: signal, onError: () => {} } as Parameters<typeof streamText>[0]);
  // Register handlers immediately for SDK promises; stream errors remain authoritative.
  const output = Promise.all([result.text, result.toolCalls, result.finishReason, result.responseMessages]);
  output.catch(() => {});
  let error: unknown;
  let finished = false;
  for await (const part of result.stream) {
    if (part.type === 'error' && error === undefined) error = part.error;
    if (part.type === 'finish') finished = true;
  }
  if (error !== undefined) throw error;
  signal.throwIfAborted();
  if (!finished) throw new Error('Validation stream ended before completion. Try again.');
  const [text, calls, finishReason, messages] = await output;
  if (!['stop', 'tool-calls'].includes(finishReason)) {
    throw new Error(`Validation did not complete (finish reason: ${finishReason}). Model was not added.`);
  }
  return { text, calls, messages };
}

/** Three small requests; the only tool is a synthetic echo and never executes code. */
export async function validateManualModel(provider: RegistryProvider, modelId: string, apiKey: string): Promise<void> {
  const npm = provider.api.npm!;
  const model = await createLanguageModel({ npm, modelId, apiKey, providerId: provider.id,
    authType: provider.authType, baseURL: provider.api.url, headers: provider.api.headers });
  const signal = AbortSignal.timeout(90_000);
  const params = (messages: ModelMessage[], tools = false): SdkCallParams => {
    const translated = translateRequest({ model: modelId, max_tokens: 1024,
      messages: [{ role: 'user', content: 'Validation' }],
      ...(tools ? { tools: [{ name: 'relay_validation', description: 'Echo a validation value. No external actions.',
        input_schema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } }], tool_choice: { type: 'auto' } } : {}),
    }, npm, { reasoningMetadata: { providerId: provider.id, apiBaseUrl: provider.api.url, upstreamModelId: modelId } });
    return { ...translated, messages };
  };
  const generated = await completeStream(model, params([{ role: 'user', content: 'Reply with exactly RELAY_OK.' }]), signal);
  if (!generated.text.trim()) throw new Error('The model returned no text. Model was not added.');

  const nonce = randomUUID();
  const toolPrompt: ModelMessage[] = [{ role: 'user', content: `Call relay_validation once with value "${nonce}". Do not answer in text yet.` }];
  const toolResult = await completeStream(model, params(toolPrompt, true), signal);
  const call = toolResult.calls[0];
  if (toolResult.calls.length !== 1 || call.toolName !== 'relay_validation'
    || !call.input || typeof call.input !== 'object'
    || (call.input as Record<string, unknown>).value !== nonce
    || Object.keys(call.input).length !== 1) {
    throw new Error('The model did not return the expected tool call and valid arguments. Model was not added.');
  }
  const receipt = `RELAY_RESULT_${randomUUID()}`;
  const continuation: ModelMessage[] = [...toolPrompt, ...toolResult.messages,
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: call.toolCallId, toolName: call.toolName, output: { type: 'text', value: receipt } }] },
    { role: 'user', content: 'Reply with the exact value returned by the tool. Do not call another tool.' },
  ];
  const roundTrip = await completeStream(model, params(continuation, true), signal);
  if (!roundTrip.text.includes(receipt) || roundTrip.calls.length) {
    throw new Error('The model could not complete the tool-result round-trip. Model was not added.');
  }
}
