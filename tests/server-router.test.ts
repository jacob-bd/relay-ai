import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createModelCatalog, type ServerModelInfo } from '../src/server/models.js';
import { startServer, type ServerHandle } from '../src/server/router.js';

interface UpstreamRequest {
  method: string;
  url: string;
  authorization: string | undefined;
  body: any;
}

async function readRequestBody(req: Parameters<typeof createServer>[0] extends (req: infer R, res: any) => any ? R : never): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString();
  return raw ? JSON.parse(raw) : null;
}

async function startUpstream(responseBody: any): Promise<{ baseUrl: string; requests: UpstreamRequest[]; close: () => Promise<void> }> {
  const requests: UpstreamRequest[] = [];
  const server = createServer(async (req, res) => {
    requests.push({
      method: req.method ?? '',
      url: req.url ?? '',
      authorization: Array.isArray(req.headers.authorization)
        ? req.headers.authorization[0]
        : req.headers.authorization,
      body: await readRequestBody(req),
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(responseBody));
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

const catalog = createModelCatalog([
  model('claude-native', 'anthropic', 'zen'),
  model('openai-format', 'openai', 'go'),
  model('bad-format', 'unsupported', 'zen'),
]);

const handles: Array<ServerHandle | { close: () => Promise<void> }> = [];

function model(
  id: string,
  modelFormat: ServerModelInfo['modelFormat'],
  sourceBackend: ServerModelInfo['sourceBackend'],
): ServerModelInfo {
  return {
    id,
    name: id,
    isFree: false,
    brand: 'Other',
    sourceBackend,
    modelFormat,
  };
}

async function startTestServer(options: Partial<Parameters<typeof startServer>[0]> = {}): Promise<ServerHandle> {
  const upstream = await startUpstream({
    id: 'chatcmpl-test',
    choices: [{ message: { content: 'upstream ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 5, completion_tokens: 7 },
  });
  handles.push(upstream);

  const handle = await startServer({
    host: '127.0.0.1',
    port: 0,
    apiKey: 'real-opencode-key',
    serverPassword: null,
    catalog,
    backends: {
      zen: { baseUrl: upstream.baseUrl },
      go: { baseUrl: upstream.baseUrl },
    },
    ...options,
  });
  handles.push(handle);
  return handle;
}

async function closeHandle(handle: ServerHandle | { close: () => Promise<void> }): Promise<void> {
  await handle.close();
}

afterEach(async () => {
  while (handles.length > 0) {
    const handle = handles.pop();
    if (handle) await closeHandle(handle);
  }
});

describe('server router', () => {
  it('serves health and model list endpoints', async () => {
    const server = await startTestServer();

    const health = await fetch(`${server.url}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const models = await fetch(`${server.url}/models`);
    expect(models.status).toBe(200);
    expect(await models.json()).toEqual({
      models: expect.arrayContaining([
        expect.objectContaining({ id: 'claude-native' }),
        expect.objectContaining({ id: 'openai-format' }),
      ]),
    });

    const anthropic = await fetch(`${server.url}/anthropic/v1/models`);
    expect(anthropic.status).toBe(200);
    expect(await anthropic.json()).toMatchObject({
      data: expect.arrayContaining([expect.objectContaining({ id: 'claude-native' })]),
    });

    const openai = await fetch(`${server.url}/openai/v1/models`);
    expect(openai.status).toBe(200);
    expect(await openai.json()).toMatchObject({ object: 'list' });
  });

  it('returns 401 for protected endpoints when password is missing or wrong', async () => {
    const server = await startTestServer({ serverPassword: 'secret' });

    const missing = await fetch(`${server.url}/openai/v1/models`);
    expect(missing.status).toBe(401);
    expect(await missing.json()).toMatchObject({ error: { message: 'Unauthorized' } });

    const wrong = await fetch(`${server.url}/openai/v1/models`, {
      headers: { authorization: 'Bearer wrong' },
    });
    expect(wrong.status).toBe(401);

    const right = await fetch(`${server.url}/openai/v1/models`, {
      headers: { 'x-api-key': 'secret' },
    });
    expect(right.status).toBe(200);
  });

  it('forwards Anthropic-native messages to the backend v1/messages endpoint with the real API key', async () => {
    const upstream = await startUpstream({
      id: 'msg-test',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'native ok' }],
    });
    handles.push(upstream);
    const server = await startTestServer({
      backends: {
        zen: { baseUrl: upstream.baseUrl },
        go: { baseUrl: upstream.baseUrl },
      },
    });

    const response = await fetch(`${server.url}/anthropic/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-native', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: 'msg-test' });
    expect(upstream.requests).toHaveLength(1);
    expect(upstream.requests[0]).toMatchObject({
      method: 'POST',
      url: '/v1/messages',
      authorization: 'Bearer real-opencode-key',
      body: { model: 'claude-native', messages: [{ role: 'user', content: 'hi' }] },
    });
  });

  it('translates Anthropic messages for OpenAI-format models through existing proxy helpers', async () => {
    const upstream = await startUpstream({
      choices: [{ message: { content: 'translated ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 4 },
    });
    handles.push(upstream);
    const server = await startTestServer({
      backends: {
        zen: { baseUrl: upstream.baseUrl },
        go: { baseUrl: upstream.baseUrl },
      },
    });

    const response = await fetch(`${server.url}/anthropic/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai-format',
        system: 'Be brief.',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      type: 'message',
      content: [{ text: 'translated ok', type: 'text' }],
      usage: { input_tokens: 3, output_tokens: 4 },
    });
    expect(upstream.requests[0]).toMatchObject({
      method: 'POST',
      url: '/v1/chat/completions',
      authorization: 'Bearer real-opencode-key',
    });
    expect(upstream.requests[0].body.messages[0]).toEqual({ role: 'system', content: 'Be brief.' });
  });

  it('forwards OpenAI chat completions for OpenAI-format models unchanged', async () => {
    const upstream = await startUpstream({
      id: 'chatcmpl-test',
      choices: [{ message: { content: 'openai ok' }, finish_reason: 'stop' }],
    });
    handles.push(upstream);
    const server = await startTestServer({
      backends: {
        zen: { baseUrl: upstream.baseUrl },
        go: { baseUrl: upstream.baseUrl },
      },
    });

    const body = { model: 'openai-format', messages: [{ role: 'user', content: 'hi' }], temperature: 0.2 };
    const response = await fetch(`${server.url}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: 'chatcmpl-test' });
    expect(upstream.requests[0]).toMatchObject({
      method: 'POST',
      url: '/v1/chat/completions',
      authorization: 'Bearer real-opencode-key',
      body,
    });
  });

  it('rejects OpenAI requests for Anthropic-native models', async () => {
    const server = await startTestServer();

    const response = await fetch(`${server.url}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-native', messages: [] }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { message: expect.stringContaining('reverse translation is not supported') },
    });
  });

  it('rejects unsupported model formats', async () => {
    const server = await startTestServer();

    const response = await fetch(`${server.url}/anthropic/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'bad-format', messages: [] }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { message: expect.stringContaining('Unsupported model format') },
    });
  });
});
