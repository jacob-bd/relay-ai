// Relay Free Pool served by the API gateway as one OpenAI-compatible model.
// Real registry, real core pool model, real @ai-sdk/openai-compatible against a
// local fake upstream. The pool must stay hidden unless enabled with a receipt.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGatewayModelCatalog, type ServerModelInfo } from '../src/server/models.js';
import { startServer, type ServerHandle } from '../src/server/router.js';
import { ClaudePoolRuntime } from '../src/pool/claude-runtime.js';
import { poolEndpointRevision } from '../src/pool/capabilities.js';
import { materializeRegistry } from '../src/registry/materialize.js';
import { loadRegistry } from '../src/registry/io.js';
import { prepareServerPool } from '../src/server/pool.js';

vi.mock('@napi-rs/keyring', () => ({ Entry: class { constructor() { throw new Error('keyring unavailable in test'); } } }));

interface Upstream { server: Server; url: string; hits: Array<Record<string, unknown>> }
const servers: Upstream[] = [];
const handles: ServerHandle[] = [];

async function upstream(): Promise<Upstream> {
  const hits: Array<Record<string, unknown>> = [];
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) => 'data: ' + JSON.stringify({
    id: 'f', object: 'chat.completion.chunk', created: 1, model: 'm',
    choices: [{ index: 0, delta, finish_reason: finish }],
  }) + '\n\n';
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += String(chunk); });
    req.on('end', () => {
      hits.push(JSON.parse(raw || '{}') as Record<string, unknown>);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(chunk({ role: 'assistant', content: 'POOL_OPENAI_OK' }));
      res.write(chunk({}, 'stop'));
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const entry = { server, url: 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/v1', hits };
  servers.push(entry);
  return entry;
}

let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'relay-server-pool-'));
  previousHome = process.env.RELAY_AI_HOME;
  process.env.RELAY_AI_HOME = home;
});

afterEach(async () => {
  while (handles.length) await handles.pop()!.close();
  if (previousHome === undefined) delete process.env.RELAY_AI_HOME;
  else process.env.RELAY_AI_HOME = previousHome;
  for (const item of servers.splice(0)) {
    item.server.closeAllConnections();
    await new Promise<void>(resolve => item.server.close(() => resolve()));
  }
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
});

function setup(url: string, options: { enabled?: boolean; receipt?: boolean } = {}) {
  writeFileSync(join(home, 'providers.json'), JSON.stringify({ schemaVersion: 1, providers: [{
    id: 'groq', templateId: 'groq', name: 'Free', enabled: true,
    authRef: 'keychain:groq', authType: 'none',
    api: { npm: '@ai-sdk/openai-compatible', url },
    modelsCache: { fetchedAt: '2026-07-23T00:00:00Z', models: [{
      id: 'm', name: 'M', upstreamModelId: 'm', modelFormat: 'openai',
      contextWindow: 128000, contextWindowSource: 'provider', cost: { input: 0, output: 0 },
    }] },
    addedAt: '2026-07-23T00:00:00Z',
  }] }));
  const local = materializeRegistry(loadRegistry(undefined, { persist: false }), () => 'x', { agent: 'codex' });
  const provider = local[0]!;
  const model = provider.models[0]!;
  const receipt = {
    member: { providerId: provider.id, modelId: model.id },
    endpointRevision: poolEndpointRevision({
      providerId: provider.id, authRef: provider.authRef, npm: model.npm!,
      baseURL: model.apiBaseUrl, upstreamModelId: 'm', headers: provider.headers,
    }),
    verifiedAt: Date.now() - 1000,
    expiresAt: Date.now() + 60_000,
    // Saved before Core existed; the parser adds it without a re-test.
    targets: ['codex', 'claude', 'antigravity'],
    tools: true, maxOutputTokens: 8192, contextWindow: 128000, contextSource: 'provider',
    reasoningAccounting: 'inside-output', effortLevels: [], billingSafe: true,
  };
  writeFileSync(join(home, 'config.json'), JSON.stringify({ freePool: {
    enabled: options.enabled ?? true,
    effort: 'auto',
    members: [{ providerId: provider.id, modelId: model.id }],
    receipts: options.receipt === false ? [] : [receipt],
  } }));
}

const poolModel: ServerModelInfo = {
  id: 'relay-free-pool',
  name: 'Relay Free Pool',
  isFree: true,
  brand: 'Relay',
  providerId: 'relay-free-pool',
  providerLabel: 'Relay',
  sourceBackend: 'relay',
  modelFormat: 'unsupported',
  contextWindow: 120_000,
};

async function startGateway() {
  const dummy = new ClaudePoolRuntime(
    { enabled: true, members: [], effort: 'auto', receipts: [] },
    async () => [],
  );
  const handle = await startServer({
    host: '127.0.0.1',
    port: 0,
    apiKey: 'server-key',
    serverPassword: null,
    catalog: createGatewayModelCatalog([poolModel]),
    backends: { zen: { baseUrl: 'http://127.0.0.1:1' }, go: { baseUrl: 'http://127.0.0.1:1' } },
    pool: { runtime: dummy, displayName: 'Relay Free Pool', modelId: 'relay-free-pool' },
  });
  handles.push(handle);
  return handle;
}

function chat(handle: ServerHandle, body: Record<string, unknown>) {
  return fetch(`http://127.0.0.1:${handle.port}/openai/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Relay Free Pool as a gateway model', () => {
  it('is off by default and absent without a passing Test', async () => {
    const fake = await upstream();
    const providers = () => materializeRegistry(loadRegistry(undefined, { persist: false }), () => 'x', { agent: 'codex' });
    setup(fake.url, { enabled: false });
    expect(prepareServerPool(providers())).toBeUndefined();
    setup(fake.url, { receipt: false });
    expect(prepareServerPool(providers())).toBeUndefined();
  });

  it('is prepared as one model when enabled and tested', async () => {
    const fake = await upstream();
    setup(fake.url);
    const providers = materializeRegistry(loadRegistry(undefined, { persist: false }), () => 'x', { agent: 'codex' });
    const prepared = prepareServerPool(providers);
    expect(prepared?.model).toMatchObject({ id: 'relay-free-pool', name: 'Relay Free Pool', contextWindow: 115200, modelFormat: 'unsupported' });
    expect(prepared?.options.modelId).toBe('relay-free-pool');
  });

  it('lists the pool on the OpenAI discovery endpoint', async () => {
    const handle = await startGateway();
    const payload = await (await fetch(`http://127.0.0.1:${handle.port}/openai/v1/models`)).json() as {
      data: Array<{ id: string }>;
    };
    expect(payload.data.some(model => model.id === 'relay-free-pool')).toBe(true);
  });

  it('answers a non-streaming Chat Completions request through the enabled pool', async () => {
    const fake = await upstream();
    setup(fake.url);
    const handle = await startGateway();

    const response = await chat(handle, {
      model: 'relay-free-pool',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { model: string; choices: Array<{ message: { content: string } }> };
    expect(body.model).toBe('relay-free-pool');
    expect(body.choices[0]!.message.content).toContain('POOL_OPENAI_OK');
    expect(fake.hits).toHaveLength(1);
    expect(fake.hits[0]!.model).toBe('m');
  });

  it('streams Chat Completions chunks through the enabled pool', async () => {
    const fake = await upstream();
    setup(fake.url);
    const handle = await startGateway();

    const response = await chat(handle, {
      model: 'relay-free-pool',
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('POOL_OPENAI_OK');
    expect(text).toContain('data: [DONE]');
    expect(fake.hits).toHaveLength(1);
  });

  it('fails cleanly when the pool is disabled or has no verified member', async () => {
    const fake = await upstream();
    setup(fake.url, { receipt: false });
    const handle = await startGateway();

    const response = await chat(handle, {
      model: 'relay-free-pool',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(response.status).toBe(502);
    const body = await response.json() as { error: { message: string } };
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(fake.hits).toHaveLength(0);
  });

});
