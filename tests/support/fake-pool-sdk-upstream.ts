// Real installed SDK + loopback HTTP only. No provider registry or credentials.
import { createServer, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { streamText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { translateGeminiRequest } from '../../src/gemini-proxy.js';
import { translateResponsesRequest } from '../../src/codex-responses-adapter.js';
import { translateRequest } from '../../src/sdk-adapter.js';
import type { PoolEvent, PoolRoute } from '../../src/pool/attempt.js';

export type UpstreamMode = 'ok' | 'json' | 'rate' | 'structured-output' | 'tool-error' | 'unknown-tool';
export async function startFakePoolSdkUpstream() {
  const requests: Array<{ mode: string; roles: string[]; textHashes: string[]; hasPriorFixtureReply: boolean; toolResultIds: string[] }> = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const mode = req.url?.split('/')[1] ?? 'unknown';
      const messages = body.messages ?? [];
      requests.push({ mode, roles: messages.map((m: any) => m.role),
        textHashes: messages.map((m: any) => createHash('sha256').update(JSON.stringify(typeof m.content === 'string' ? [m.content] : (m.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text))).digest('hex')),
        hasPriorFixtureReply: messages.some((m: any) => m.role === 'assistant' && JSON.stringify(m.content).includes('RELAY_CLIENT_OK')),
        toolResultIds: messages.filter((m: any) => m.role === 'tool').map((m: any) => String(m.tool_call_id ?? m.toolCallId ?? '')) });
      if (mode === 'rate') {
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' });
        res.end(JSON.stringify({ error: { message: 'Synthetic quota', type: 'rate_limit_error' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      chunk(res, { role: 'assistant' });
      if (mode === 'structured-output') {
        chunk(res, { tool_calls: [{ index: 0, id: 'call_structured_fixture', type: 'function', function: { name: 'StructuredOutput', arguments: '{"answer":"ok"}' } }] });
        chunk(res, {}, 'tool_calls');
        res.end('data: [DONE]\n\n');
        return;
      }
      if (mode === 'unknown-tool') {
        chunk(res, { tool_calls: [{ index: 0, id: 'call_unknown_sdk', type: 'function', function: { name: 'relay_unavailable_fixture_tool', arguments: '{"value":"ok"}' } }] });
        chunk(res, {}, 'tool_calls');
        res.end('data: [DONE]\n\n');
        return;
      }
      if (mode === 'tool-error') {
        chunk(res, { tool_calls: [{ index: 0, id: 'call_interrupted_sdk', type: 'function', function: { name: 'relay_unavailable_fixture_tool', arguments: '' } }] });
        chunk(res, { tool_calls: [{ index: 0, function: { arguments: '{"synthetic":' } }] });
        res.end('data: {invalid json}\n\n');
        return;
      }
      chunk(res, { content: mode === 'json' ? '{"answer":"ok"}' : 'RELAY_CLIENT_OK' });
      chunk(res, {}, 'stop');
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseURL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    requests,
    routes(body: Record<string, any>, modes: UpstreamMode[], protocol: 'anthropic' | 'responses' | 'gemini' = 'anthropic'): PoolRoute[] {
      return modes.map(mode => ({ id: mode + '/fixture-account/revision-1', async open(abortSignal) {
        const model = createOpenAICompatible({ name: 'fixture', apiKey: 'fake-upstream-key', baseURL: baseURL + '/' + mode + '/v1' }).chatModel('fixture-model');
        const translated = protocol === 'anthropic'
          ? translateRequest(structuredClone(body) as Parameters<typeof translateRequest>[0], '@ai-sdk/openai-compatible')
          : protocol === 'gemini' ? translateGeminiRequest(structuredClone(body))
          : translateResponsesRequest(structuredClone(body) as Parameters<typeof translateResponsesRequest>[0], '@ai-sdk/openai-compatible');
        const { toolContext: _context, ...params } = translated as typeof translated & { toolContext?: unknown };
        const result = streamText({ model, ...params, maxRetries: 0, abortSignal, onError: () => {} } as Parameters<typeof streamText>[0]);
        return result.stream as AsyncIterable<PoolEvent>;
      } }));
    },
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}
function chunk(res: ServerResponse, delta: unknown, finish_reason: string | null = null) {
  res.write('data: ' + JSON.stringify({ id: 'sdk-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta, finish_reason }] }) + '\n\n');
}
