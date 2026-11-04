import { streamText, tool, jsonSchema, type LanguageModel } from 'ai';

export interface PoolProbeResult {
  text: 'passed' | 'failed';
  tools: 'passed' | 'failed';
  failure?: 'timeout' | 'truncated' | 'invalid-output' | 'provider';
}
/** Explicit enrollment probe only. One bounded call, no tool execution or retry loop. */
export async function probePoolModel(
  model: LanguageModel,
  signal: AbortSignal,
  timeoutMs = 20_000,
  onError?: (error: unknown) => void,
): Promise<PoolProbeResult> {
  const result: PoolProbeResult = { text: 'failed', tools: 'failed' };
  const call = async () => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const abortSignal = AbortSignal.any([signal, timeout]);
    const response = streamText({ model, abortSignal, maxRetries: 0, maxOutputTokens: 256,
      prompt: 'Call relay_pool_probe with value "ok". Do not perform any other action.',
      toolChoice: { type: 'tool' as const, toolName: 'relay_pool_probe' }, tools: {
        relay_pool_probe: tool({ description: 'Harmless enrollment capability probe; it is never executed.',
          inputSchema: jsonSchema<{ value: string }>({ type: 'object', properties: { value: { type: 'string', enum: ['ok'] } }, required: ['value'], additionalProperties: false }),
        }),
      }, onError: () => {},
    });
    for (const promise of [response.text, response.toolCalls, response.finishReason, response.usage, response.response]) Promise.resolve(promise).catch(() => {});
    let validTool = false;
    let finish = '';
    for await (const part of response.stream) {
      if (part.type === 'error') throw part.error;
      if (part.type === 'tool-call') validTool = part.toolName === 'relay_pool_probe' && (part.input as { value?: string })?.value === 'ok';
      if (part.type === 'finish') finish = part.finishReason;
    }
    if (finish === 'length') return 'truncated' as const;
    return validTool && finish === 'tool-calls';
  };
  try {
    const outcome = await call();
    if (outcome !== true) return { ...result, failure: outcome === 'truncated' ? 'truncated' : 'invalid-output' };
    result.text = 'passed';
    result.tools = 'passed';
    return result;
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    onError?.(error);
    return { ...result, failure: (error as { name?: string })?.name === 'TimeoutError' ? 'timeout' : 'provider' };
  }
}

/** One bounded call per effort rung. Only observed success is recorded. */
export async function probePoolEffort(
  model: LanguageModel,
  providerOptions: Record<string, Record<string, unknown>>,
  signal: AbortSignal,
  timeoutMs = 20_000,
  onError?: (error: unknown) => void,
): Promise<boolean> {
  try {
    const abortSignal = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    const response = streamText({
      model, abortSignal, maxRetries: 0, maxOutputTokens: 32,
      prompt: 'Reply with exactly OK.', providerOptions: providerOptions as never, onError: () => {},
    });
    for (const promise of [response.text, response.toolCalls, response.finishReason, response.usage, response.response]) {
      Promise.resolve(promise).catch(() => {});
    }
    let text = '';
    let finish = '';
    for await (const part of response.stream) {
      if (part.type === 'error') {
        onError?.(part.error);
        return false;
      }
      if (part.type === 'text-delta') text += part.text;
      if (part.type === 'finish') finish = part.finishReason;
    }
    return finish === 'stop' && text.trim().length > 0;
  } catch (error) {
    onError?.(error);
    return false;
  }
}
