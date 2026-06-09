// Shared helpers for Anthropic ↔ upstream translation proxies.

const TOOL_USE_SIG_SEP = '::ts::';

export function parseToolArguments(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch { /* fall through */ }
  }
  return {};
}

export function sseChunk(eventType: string, data: unknown): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Parse one SSE line into a JSON payload string, or null if not a data line. */
export function extractSseDataPayload(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':')) return null;
  if (trimmed.startsWith('data:')) {
    const payload = trimmed.slice(5).trimStart();
    if (!payload || payload === '[DONE]') return null;
    return payload;
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;
  return null;
}

export function splitToolUseId(id: string): { rawId: string; thoughtSignature?: string } {
  const sep = id.lastIndexOf(TOOL_USE_SIG_SEP);
  if (sep === -1) return { rawId: id };
  return {
    rawId: id.slice(0, sep),
    thoughtSignature: id.slice(sep + TOOL_USE_SIG_SEP.length),
  };
}

export function encodeToolUseId(rawId: string, thoughtSignature?: string): string {
  return thoughtSignature ? `${rawId}${TOOL_USE_SIG_SEP}${thoughtSignature}` : rawId;
}

export function stripToolUseIdSuffix(toolUseId: string): string {
  return splitToolUseId(toolUseId).rawId;
}

export function serializeToolResultContent(content: unknown): string {
  return typeof content === 'string' ? content : JSON.stringify(content);
}

/** Incrementally read SSE lines from an upstream stream without re-splitting the full buffer. */
export function attachSseLineReader(
  upstream: NodeJS.ReadableStream,
  onLine: (line: string) => void,
  onDone: () => void,
): void {
  const decoder = new TextDecoder();
  let buffer = '';

  const flushRemainder = () => {
    const trimmed = buffer.trim();
    if (trimmed) onLine(trimmed);
    buffer = '';
  };

  upstream.on('data', (chunk: Buffer) => {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      onLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  });

  upstream.on('end', () => {
    flushRemainder();
    onDone();
  });

  upstream.on('error', () => onDone());
}
