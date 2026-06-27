export interface CloudCodeChunkOptions {
  text?: string;
  thought?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  modelVersion: string;
  responseId: string;
  finishReason?: 'STOP' | 'MAX_TOKENS' | 'OTHER' | string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

/**
 * Map SDK finish reasons to Cloud Code format.
 */
export function mapFinishReason(reason: string): string {
  if (reason === 'stop' || reason === 'tool-calls') return 'STOP';
  if (reason === 'length') return 'MAX_TOKENS';
  if (reason === 'content-filter') return 'SAFETY';
  return 'OTHER';
}

/**
 * Format a text delta, function call, stop reason, and usage stats
 * into the Cloud Code SSE shape.
 */
export function formatCloudCodeChunk(opts: CloudCodeChunkOptions): Record<string, any> {
  const parts: any[] = [];

  if (opts.thought !== undefined && opts.thought !== '') {
    parts.push({ text: opts.thought, thought: true });
  }
  if (opts.text !== undefined && opts.text !== '') {
    parts.push({ text: opts.text });
  }
  if (opts.functionCall) {
    parts.push({ functionCall: opts.functionCall });
  }
  if (parts.length === 0 && !opts.finishReason) {
    parts.push({ text: '' });
  }

  const candidate: Record<string, any> = {};

  if (parts.length > 0 || opts.finishReason) {
    candidate.content = {
      role: 'model',
      parts,
    };
  }

  if (opts.finishReason) {
    candidate.finishReason = opts.finishReason;
  }

  const response: Record<string, any> = {
    candidates: [candidate],
    modelVersion: opts.modelVersion,
    responseId: opts.responseId,
  };

  if (opts.usage) {
    response.usageMetadata = {
      promptTokenCount: opts.usage.promptTokens,
      candidatesTokenCount: opts.usage.completionTokens,
      totalTokenCount: opts.usage.promptTokens + opts.usage.completionTokens,
    };
  }

  return {
    response,
    traceId: 'relay-trace',
    metadata: {},
  };
}
