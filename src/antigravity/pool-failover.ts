import type { ServerResponse } from 'node:http';

/**
 * Pre-commit failover for a pool row in the Cloud Code gateway.
 *
 * The member handler writes through a capture sink. Empty chunks are held; the
 * first chunk carrying text, thinking or a tool call commits the attempt,
 * flushes what was held, and streams the rest straight to the client. A member
 * that fails before that point is discarded and the next member runs.
 */

/** True when a Cloud Code SSE chunk carries something the user can see. */
export function isMeaningfulCloudCodeChunk(chunk: string): boolean {
  const newline = String.fromCharCode(10);
  const line = chunk.split(newline).find(part => part.startsWith('data:'));
  if (!line) return false;
  let parsed: unknown;
  try { parsed = JSON.parse(line.slice(5).trim()); } catch { return false; }
  const value = parsed as {
    candidates?: Array<{ content?: { parts?: unknown[] } }>;
    response?: { candidates?: Array<{ content?: { parts?: unknown[] } }> };
  };
  const candidates = value.candidates ?? value.response?.candidates;
  const parts = candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return false;
  return parts.some(part => {
    if (!part || typeof part !== 'object') return false;
    const value = part as { text?: unknown; thought?: unknown; functionCall?: unknown };
    if (value.functionCall && typeof value.functionCall === 'object') return true;
    return typeof value.text === 'string' && value.text.length > 0;
  });
}

export interface CaptureSink {
  response: ServerResponse;
  committed: boolean;
}

/** Preamble-only responses cannot consume memory without bound before commit. */
export const POOL_CAPTURE_MAX_BYTES = 1_048_576;

/** Streams to the real socket only once the member produced meaningful content. */
export function createStreamCapture(real: ServerResponse, maxBytes = POOL_CAPTURE_MAX_BYTES): CaptureSink {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Invalid pool capture byte limit');
  let committed = false;
  let headers: { status: number; values: Record<string, string | string[]> } | undefined;
  const held: string[] = [];
  let heldBytes = 0;
  const commit = () => {
    committed = true;
    if (!real.headersSent) real.writeHead(headers?.status ?? 200, headers?.values);
    for (const chunk of held.splice(0)) real.write(chunk);
  };
  const sink = {
    response: {
      get headersSent() { return committed; },
      get destroyed() { return real.destroyed; },
      get writableEnded() { return real.writableEnded; },
      writeHead(status: number, values?: Record<string, string | string[]>) {
        headers = { status, values: values ?? {} };
        return sink.response;
      },
      write(chunk: unknown) {
        const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8');
        if (!committed) {
          heldBytes += Buffer.byteLength(text);
          if (heldBytes > maxBytes) throw new Error('Pool capture byte limit exceeded');
          held.push(text);
          if (isMeaningfulCloudCodeChunk(text)) commit();
        } else {
          real.write(text);
        }
        return true;
      },
      end() { if (committed) real.end(); return sink.response; },
      once() { return sink.response; },
      on() { return sink.response; },
      setHeader() {},
      getHeader() { return undefined; },
      removeHeader() {},
    } as unknown as ServerResponse,
    get committed() { return committed; },
  };
  return sink;
}

/** Non-stream attempts are complete messages, so they are buffered until success. */
export function createJsonCapture(): { response: ServerResponse; status: number; body: string; headers: Record<string, string | string[]> } {
  const capture = { status: 200, body: '', headers: {} as Record<string, string | string[]> };
  const sink = {
    get headersSent() { return true; },
    get destroyed() { return false; },
    get writableEnded() { return false; },
    writeHead(status: number, values?: Record<string, string | string[]>) {
      capture.status = status;
      capture.headers = values ?? {};
      return sink;
    },
    write(chunk: unknown) {
      capture.body += typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8');
      return true;
    },
    end() { return sink; },
    once() { return sink; },
    on() { return sink; },
    setHeader() {},
    getHeader() { return undefined; },
    removeHeader() {},
  } as unknown as ServerResponse;
  return {
    response: sink,
    get status() { return capture.status; },
    get body() { return capture.body; },
    get headers() { return capture.headers; },
  };
}
