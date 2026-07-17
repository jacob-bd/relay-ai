const MESSAGE_PATH = '/v1/messages';
const COUNT_TOKENS_PATH = '/v1/messages/count_tokens';

export type AnthropicMessagesEndpoint = 'messages' | 'count_tokens';

export function anthropicMessagesEndpoint(url: string | undefined): AnthropicMessagesEndpoint | null {
  if (!url) return null;
  try {
    const pathname = new URL(url, 'http://relay.local').pathname;
    if (pathname === MESSAGE_PATH) return 'messages';
    if (pathname === COUNT_TOKENS_PATH) return 'count_tokens';
  } catch {
    // Invalid request targets are not Anthropic message endpoints.
  }
  return null;
}

const NON_CONTEXT_FIELDS = new Set([
  'model',
  'stream',
  'max_tokens',
  'temperature',
  'top_p',
  'top_k',
  'stop_sequences',
  'metadata',
]);

/** Conservative provider-neutral estimate for translated models. */
export function estimateAnthropicInputTokens(body: object): number {
  const contextBody = Object.fromEntries(
    Object.entries(body).filter(([key]) => !NON_CONTEXT_FIELDS.has(key)),
  );
  const serialized = JSON.stringify(contextBody);
  if (!serialized || serialized === '{}') return 0;
  return Math.max(1, Math.ceil(Buffer.byteLength(serialized, 'utf8') / 4));
}
