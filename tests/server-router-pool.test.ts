import { createServer } from 'node:http';
import * as net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createGatewayModelCatalog, type ServerModelInfo } from '../src/server/models.js';
import { startServer, type ServerHandle, type ServerOptions } from '../src/server/router.js';
import { CLAUDE_POOL_MODEL_ID, ClaudePoolRuntime } from '../src/pool/claude-runtime.js';
import type { DispatchRoute } from '../src/pool/dispatch.js';

const member = { providerId: 'free', modelId: 'free-model' };
const pool = { enabled: true, members: [member], effort: 'auto' as const, receipts: [] };

const poolModel: ServerModelInfo = {
  id: CLAUDE_POOL_MODEL_ID,
  name: 'Relay Free Pool',
  isFree: true,
  brand: 'Relay',
  providerLabel: 'Relay',
  providerId: 'relay-pool',
  sourceBackend: 'relay-pool',
  modelFormat: 'unsupported',
  contextWindow: 100_000,
};

function poolRoute(text = 'POOL_OK'): DispatchRoute {
  return {
    member,
    revision: 'rev',
    freeStatus: 'verified_free',
    catalogVerified: true,
    accessVerified: true,
    billingSafe: true,
    targets: ['claude'],
    toolsVerified: true,
    defaultEffortVerified: true,
    effortLevels: [],
    contextFits: true,
    contextVerified: true,
    async open() {
      return (async function* () {
        yield { type: 'text-start', id: 't' };
        yield { type: 'text-delta', id: 't', text };
        yield { type: 'text-end', id: 't' };
        yield { type: 'finish', finishReason: 'stop' };
      })();
    },
  };
}

function runtime(routes: DispatchRoute[]): ClaudePoolRuntime {
  return new ClaudePoolRuntime(pool, async () => routes);
}

const handles: Array<ServerHandle | { close: () => Promise<void> }> = [];

afterEach(async () => {
  while (handles.length) {
    const handle = handles.pop()!;
    await handle.close();
  }
});

async function startPaidUpstream(): Promise<{
  baseUrl: string;
  requests: Array<{ url: string; body: any }>;
  close: () => Promise<void>;
}> {
  const requests: Array<{ url: string; body: any }> = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push({ url: req.url ?? '', body: JSON.parse(Buffer.concat(chunks).toString() || '{}') });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'paid', type: 'message', role: 'assistant', model: 'paid-model', content: [] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing upstream address');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve()))),
  };
}

async function startTestServer(
  upstreamBaseUrl: string,
  poolRuntime: ClaudePoolRuntime | undefined,
  poolModelId = CLAUDE_POOL_MODEL_ID,
): Promise<ServerHandle> {
  const catalog = createGatewayModelCatalog([
    { ...poolModel, id: poolModelId },
    {
      id: 'paid-model',
      name: 'Paid Model',
      isFree: false,
      brand: 'Other',
      sourceBackend: 'paid-account',
      modelFormat: 'anthropic',
      baseUrl: upstreamBaseUrl,
      apiKey: 'paid-key',
      contextWindow: 128_000,
    },
  ], { maskGatewayIds: true });

  const options: ServerOptions = {
    host: '127.0.0.1',
    port: 0,
    apiKey: 'server-key',
    serverPassword: null,
    catalog,
    backends: { zen: { baseUrl: upstreamBaseUrl }, go: { baseUrl: upstreamBaseUrl } },
    gateway: { maskGatewayIds: true, longContextDisplay: 'single-1m' },
    pool: poolRuntime ? { runtime: poolRuntime, displayName: 'Relay Free Pool', modelId: poolModelId } : undefined,
  };
  const handle = await startServer(options);
  handles.push(handle);
  return handle;
}

function messages(handle: ServerHandle, body: Record<string, unknown>): Promise<Response> {
  return fetch(`http://127.0.0.1:${handle.port}/anthropic/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Claude Desktop pool routing through the generic server', () => {
  it('advertises the pool as Relay Free Pool instead of the provider-suffixed gateway name', async () => {
    const upstream = await startPaidUpstream();
    handles.push(upstream);
    const handle = await startTestServer(upstream.baseUrl, runtime([poolRoute()]));

    const payload = await (await fetch(`http://127.0.0.1:${handle.port}/anthropic/v1/models`)).json() as {
      data: Array<{ id: string; display_name: string }>;
    };
    expect(payload.data.find(model => model.id === CLAUDE_POOL_MODEL_ID)?.display_name).toBe('Relay Free Pool');
  });

  it('serves a nonstream pool message with the synthetic catalog id', async () => {
    const upstream = await startPaidUpstream();
    handles.push(upstream);
    const handle = await startTestServer(upstream.baseUrl, runtime([poolRoute()]));

    const response = await messages(handle, {
      model: CLAUDE_POOL_MODEL_ID,
      max_tokens: 64,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { model: string; content: Array<{ type: string; text?: string }> };
    expect(body.model).toBe(CLAUDE_POOL_MODEL_ID);
    expect(body.content.some(part => part.type === 'text' && part.text === 'POOL_OK')).toBe(true);
    expect(upstream.requests).toHaveLength(0);
  });

  it('serves the gateway catalog id used by `relay-ai server`', async () => {
    const upstream = await startPaidUpstream();
    handles.push(upstream);
    const handle = await startTestServer(upstream.baseUrl, runtime([poolRoute()]), 'relay-free-pool');

    const response = await messages(handle, {
      model: 'relay-free-pool',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { model: string; content: Array<{ type: string; text?: string }> };
    expect(body.model).toBe('relay-free-pool');
    expect(body.content.some(part => part.type === 'text' && part.text === 'POOL_OK')).toBe(true);
  });

  it('streams a protocol-valid pool response', async () => {
    const upstream = await startPaidUpstream();
    handles.push(upstream);
    const handle = await startTestServer(upstream.baseUrl, runtime([poolRoute()]));

    const response = await messages(handle, {
      model: CLAUDE_POOL_MODEL_ID,
      max_tokens: 64,
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
    });
    const text = await response.text();
    expect(text).toContain('event: message_start');
    expect(text).toContain('POOL_OK');
    expect(text).toContain('event: message_stop');
    expect(upstream.requests).toHaveLength(0);
  });

  it('returns a pool error without falling back to a paid catalog model', async () => {
    const upstream = await startPaidUpstream();
    handles.push(upstream);
    const handle = await startTestServer(upstream.baseUrl, runtime([]));

    const response = await messages(handle, {
      model: CLAUDE_POOL_MODEL_ID,
      max_tokens: 64,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(response.status).toBe(500);
    const body = await response.json() as { type: string; error: { type: string; message: string } };
    expect(body.type).toBe('error');
    expect(body.error.message).toContain('No eligible free pool members');
    expect(upstream.requests).toHaveLength(0);
  });

  it('aborts the pool request when the client disconnects', async () => {
    const upstream = await startPaidUpstream();
    handles.push(upstream);

    let startedResolve!: () => void;
    const started = new Promise<void>(resolve => { startedResolve = resolve; });
    let abortedResolve!: () => void;
    const aborted = new Promise<void>(resolve => { abortedResolve = resolve; });
    const fake = {
      async serve(_body: unknown, _write: unknown, signal: AbortSignal) {
        startedResolve();
        await new Promise<void>(resolve => {
          signal.addEventListener('abort', () => { abortedResolve(); resolve(); }, { once: true });
        });
        return { ok: true as const };
      },
    } as unknown as ClaudePoolRuntime;
    const handle = await startTestServer(upstream.baseUrl, fake);

    const body = JSON.stringify({
      model: CLAUDE_POOL_MODEL_ID,
      max_tokens: 64,
      messages: [{ role: 'user', content: 'hi' }],
    });
    const socket = net.connect(handle.port, '127.0.0.1');
    await new Promise<void>(resolve => socket.once('connect', resolve));
    socket.write([
      'POST /anthropic/v1/messages HTTP/1.1',
      'Host: 127.0.0.1',
      'Content-Type: application/json',
      `Content-Length: ${Buffer.byteLength(body)}`,
      '',
      body,
    ].join('\r\n'));

    await started;
    socket.destroy();
    await aborted;
  });
});
