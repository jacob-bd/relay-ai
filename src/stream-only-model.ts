import { generateText, streamText } from 'ai';

// Some upstreams reject non-streaming requests outright. ChatGPT login
// (chatgpt.com/backend-api/codex) answers {"detail":"Stream must be set to true"}
// with HTTP 400, so any generateText call on an openai-oauth model fails.
// provider-factory marks those models; non-streaming call sites use
// generateTextStreamingIfRequired() so they stream for marked models and keep
// calling generateText for everything else.

const streamOnlyModels = new WeakSet<object>();

/** Mark a model whose upstream only accepts streaming requests. Returns the model. */
export function markStreamOnlyModel<T>(model: T): T {
  if (typeof model === 'object' && model !== null) streamOnlyModels.add(model);
  return model;
}

export function isStreamOnlyModel(model: unknown): boolean {
  return typeof model === 'object' && model !== null && streamOnlyModels.has(model);
}

type GenerateTextArgs = Parameters<typeof generateText>[0];
type GenerateTextOutput = Awaited<ReturnType<typeof generateText>>;

/** The generateText result fields Relay's non-streaming call sites read. */
export type GeneratedText = Pick<
  GenerateTextOutput,
  'text' | 'reasoning' | 'reasoningText' | 'toolCalls' | 'finishReason' | 'usage'
>;

/**
 * generateText, except a stream-only model gets a real streamed request that is
 * collected into the same fields. Other models are unchanged.
 */
export async function generateTextStreamingIfRequired(args: GenerateTextArgs): Promise<GeneratedText> {
  if (!isStreamOnlyModel(args.model)) return generateText(args);

  let firstStreamError: { error: unknown } | undefined;
  const result = streamText({
    ...(args as Parameters<typeof streamText>[0]),
    onError: event => { firstStreamError ??= event; },
  });
  Promise.resolve(result.toolResults).catch(() => {});

  let collected: GeneratedText;
  try {
    const [text, reasoning, reasoningText, toolCalls, finishReason, usage] = await Promise.all([
      result.text,
      result.reasoning,
      result.reasoningText,
      result.toolCalls,
      result.finishReason,
      result.usage,
    ]);
    collected = { text, reasoning, reasoningText, toolCalls, finishReason, usage } as GeneratedText;
  } catch (error) {
    // The SDK can replace the upstream failure with NoOutputGeneratedError;
    // keep the original so the HTTP status and message survive.
    throw firstStreamError ? firstStreamError.error : error;
  }
  // A failed stream can still resolve its promises with empty values.
  if (firstStreamError) throw firstStreamError.error;
  return collected;
}
