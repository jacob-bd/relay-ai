// Validation-only Anthropic gateway. It records structural payload information,
// never writes auth headers or user content into logs, and serves deterministic
// protocol-shaped responses to an isolated real coding client.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream';
import { runPoolAttempts, type PoolEvent, type PoolRoute } from '../../src/pool/attempt.js';
import { ClaudeHistoryEmbargo } from '../../src/pool/claude-runtime.js';
import { writeAnthropicStream } from '../../src/sdk-adapter.js';

export interface CapturedRequest {
  path: string;
  identity: Record<string, string>;
  metadataKeys: string[];
  bodyHash: string;
  fieldHashes: Record<string, string>;
  model?: string;
  effort?: string;
  thinkingBudget?: number;
  stream: boolean;
  toolCount: number;
  toolNames: string[];
  messageCount: number;
  messageRoles: string[];
  messageHashes: string[];
  messageTextHashes: string[];
  messageBlockKeys: string[][];
  hasPriorFixtureReply: boolean;
  structuredFormat: boolean;
  toolResultIds: string[];
  hasSystem: boolean;
  promptChars: number;
}
export interface FakeGateway {
  port: number;
  requests: CapturedRequest[];
  attempts: Array<{ mode: string; at: number }>;
  close(): Promise<void>;
}
type Mode = 'ok' | 'hang' | 'rate' | 'text-hang' | 'tool-error';

export async function startFakeAnthropicGateway(options: { failures?: Mode[]; pool?: boolean; guard?: boolean; beforeAttempt?: () => Promise<void>; routes?: (body: Record<string, any>) => PoolRoute[] } = {}): Promise<FakeGateway> {
  const requests: CapturedRequest[] = [];
  const attempts: Array<{ mode: string; at: number }> = [];
  const retryGuard = new ClaudeHistoryEmbargo();
  const failures = [...(options.failures ?? [])];
  const server = createServer((req, res) => {
    if (req.url?.endsWith('/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'claude-pool', type: 'model', display_name: 'Relay Free Models' }], has_more: false }));
      return;
    }
    if (req.url === '/__control') {
      failures.length = 0;
      requests.length = 0;
      res.end('ok');
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.once('end', () => {
      let body: Record<string, any> = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* malformed stays empty */ }
      const messages = Array.isArray(body.messages) ? body.messages : [];
      requests.push({
        path: req.url ?? '',
        identity: Object.fromEntries(Object.entries(req.headers).filter(([key]) => /^(x-stainless-retry-count|x-client-request-id|x-request-id|session-id|x-session-id|x-claude-code-session-id|anthropic-session-id)$/.test(key)).map(([key, value]) => [key, String(value)])),
        metadataKeys: Object.keys(body.metadata ?? {}),
        fieldHashes: Object.fromEntries(Object.entries(body).map(([key,value]) => [key, createHash('sha256').update(JSON.stringify(value)).digest('hex')])),
        bodyHash: createHash('sha256').update(JSON.stringify({ ...body, stream: undefined })).digest('hex'),
        model: body.model,
        effort: body.output_config?.effort,
        thinkingBudget: body.thinking?.budget_tokens,
        stream: body.stream === true,
        toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
        toolNames: Array.isArray(body.tools) ? body.tools.map((t: any) => String(t.name ?? '')) : [],
        messageCount: messages.length,
        messageRoles: messages.map((m: any) => String(m.role)),
        messageHashes: messages.map((m: any) => createHash('sha256').update(JSON.stringify(m)).digest('hex')),
        messageTextHashes: messages.map((m: any) => createHash('sha256').update(JSON.stringify(typeof m.content === 'string' ? [m.content] : (m.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text))).digest('hex')),
        messageBlockKeys: messages.map((m: any) => Array.isArray(m.content) ? m.content.map((c: any) => Object.keys(c).sort().join(',')) : ['string']),
        structuredFormat: Boolean(body.output_config?.format),
        hasPriorFixtureReply: messages.some((m: any) => m.role === 'assistant' && JSON.stringify(m.content).includes('RELAY_CLIENT_OK')),
        toolResultIds: messages.flatMap((m: any) => Array.isArray(m.content) ? m.content.filter((c: any) => c.type === 'tool_result').map((c: any) => String(c.tool_use_id)) : []),
        hasSystem: Boolean(body.system || messages.some((m: any) => m.role === 'system')),
        promptChars: JSON.stringify(body).length,
      });
      if (options.pool) {
        const session = req.headers['x-claude-code-session-id'];
        const history = createHash('sha256').update(JSON.stringify({ model: body.model, system: body.system, messages: body.messages, tools: body.tools, tool_choice: body.tool_choice, output_config: body.output_config, max_tokens: body.max_tokens, stop_sequences: body.stop_sequences })).digest('hex');
        const lease = options.guard ? retryGuard.claim(typeof session === 'string' ? session : 'fixture-session', history) : undefined;
        if (lease && lease.kind !== 'owner') {
          sendPoolError(res, lease.kind === 'busy'
            ? 'A matching request is already in flight'
            : 'A matching request recently failed');
          return;
        }
        void respondPool(res, options.failures ?? ['ok'], attempts, body.stream === true,
          () => lease?.kind === 'owner' && lease.fail(), options.beforeAttempt, options.routes?.(body)).finally(() => lease?.kind === 'owner' && lease.release());
      }
      else void respond(req, res, failures.shift() ?? 'ok');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as { port: number }).port,
    requests,
    attempts,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
function sse(res: ServerResponse, event: string, data: unknown) {
  res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
}
async function respond(req: IncomingMessage, res: ServerResponse, mode: Mode) {
  if (mode === 'rate') {
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'Synthetic rate limit.' } }));
    return;
  }
  if (mode === 'hang') return;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  sse(res, 'message_start', { type: 'message_start', message: { id: 'msg_' + randomUUID(), type: 'message', role: 'assistant', content: [], model: 'claude-pool', stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
  sse(res, 'ping', { type: 'ping' });
  sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  if (mode === 'text-hang') {
    sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'PARTIAL_RELAY_TEST' } });
    return;
  }
  sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'RELAY_CLIENT_OK' } });
  sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } });
  sse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}

async function respondPool(res: ServerResponse, modes: Mode[], attempts: Array<{ mode: string; at: number }>, streaming: boolean, recordFailure: () => void, beforeAttempt?: () => Promise<void>, overrideRoutes?: PoolRoute[]) {
  const controller = new AbortController();
  res.once('close', () => { if (!res.writableFinished) controller.abort(new Error('disconnect')); });
  const routes: PoolRoute[] = overrideRoutes ?? modes.map(mode => ({ id: mode, async open(signal) {
    return (async function* () {
      if (beforeAttempt) await beforeAttempt();
      yield { type: 'start' };
      if (mode === 'tool-error') {
        yield { type: 'tool-input-start', id: 'call_interrupted_fixture', toolName: 'relay_unavailable_fixture_tool' };
        yield { type: 'tool-input-delta', id: 'call_interrupted_fixture', delta: '{"synthetic":' };
        yield { type: 'error', error: new Error('interrupted tool arguments') };
        return;
      }
      if (mode === 'hang') await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      if (mode === 'rate') { yield { type: 'error', error: Object.assign(new Error('quota exceeded'), { statusCode: 429 }) }; return; }
      yield { type: 'text-delta', text: 'RELAY_CLIENT_OK' };
      if (mode === 'text-hang') { yield { type: 'error', error: new Error('post-content failure') }; return; }
      yield { type: 'finish', finishReason: 'stop' };
    })();
  } }));
  try {
    const parts = runPoolAttempts(routes, controller.signal,
      { attempts: 3, firstContentMs: 20000, idleMs: 20000, totalMs: 60000, bufferBytes: 65536, cleanupMs: 250 },
      () => true, mode => attempts.push({ mode, at: Date.now() }));
    if (!streaming) {
      const message = await collectAnthropicMessage(parts, 'claude-pool');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(message));
      return;
    }
    await writeAnthropicStream(parts, 'claude-pool', chunk => {
        if (!res.headersSent) res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(chunk);
      });
    res.end();
  } catch {
    if (controller.signal.aborted) return; // Cancellation is not provider failure.
    recordFailure();
    if (res.destroyed) return;
    if (!res.headersSent) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'No pool models available' } }));
    } else {
      sse(res, 'error', { type: 'error', error: { type: 'api_error', message: 'Pool response failed after commitment' } });
      res.end();
    }
  }
}

async function collectAnthropicMessage(parts: AsyncIterable<PoolEvent>, model: string, maxBytes = 65536) {
  const lines: string[] = [];
  let bytes = 0;
  await writeAnthropicStream(parts, model, chunk => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > maxBytes) throw new Error('nonstream-output-limit');
    for (const line of chunk.split('\n')) if (line.startsWith('data: {')) lines.push(line.slice(6));
  });
  const encoded = new TextEncoder().encode(lines.join('\n') + '\n');
  const stream = MessageStream.fromReadableStream(new ReadableStream({
    start(controller) { controller.enqueue(encoded); controller.close(); },
  }));
  return stream.finalMessage();
}

function sendPoolError(res: ServerResponse, message: string) {
  res.writeHead(400, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } }));
}
