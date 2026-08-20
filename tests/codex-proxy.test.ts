import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import {
  applyExternalCodexRuntimeIdentity,
  estimateCodexRequestChars,
  isLikelyCodexCompactionRequest,
  isCodexV2CompactionRequest,
  isCodexSubagentRequest,
  protectCodexCompactionParams,
  resolveCodexSubagentRoute,
  startCodexProxy,
} from '../src/codex-proxy.js';
import { buildCompactionResponseBody, type CodexSdkCallParams } from '../src/codex-responses-adapter.js';
import { CODEX_APP_AUTO_COMPACT_RATIO } from '../src/codex/app-profile.js';
import { WebSocket, WebSocketServer } from 'ws';

describe('external Codex runtime identity', () => {
  it('distinguishes the selected external model from the Codex host', () => {
    const params = applyExternalCodexRuntimeIdentity({
      system: 'Use the Codex app tools carefully.',
      messages: [{ role: 'user', content: 'what model are you?' }],
    }, {
      modelId: 'antigravity__gemini-3.1-pro-high',
      providerId: 'antigravity',
      upstreamModelId: 'gemini-pro-agent',
      auditUpstreamModelId: 'gemini-3.1-pro-high',
    });

    expect(params.system).toContain('"gemini-3.1-pro-high" through provider "antigravity"');
    expect(params.system).toContain('Codex is the host application and agent environment, not the model identity.');
    expect(params.system).toContain('Use the Codex app tools carefully.');
    expect(params.system).not.toContain('gemini-pro-agent');
  });

  it('uses the dynamic upstream model and does not hard-code Gemini', () => {
    const params = applyExternalCodexRuntimeIdentity({
      messages: [{ role: 'user', content: 'identify yourself' }],
    }, {
      modelId: 'antigravity__claude-sonnet-4-6',
      providerId: 'antigravity',
      upstreamModelId: 'claude-sonnet-4-6',
    });

    expect(params.system).toContain('"claude-sonnet-4-6" through provider "antigravity"');
    expect(params.system).not.toContain('gemini-3.1-pro-high');
  });
});

describe('startCodexProxy', () => {
  let handle: Awaited<ReturnType<typeof startCodexProxy>> | null = null;
  const auditDirs: string[] = [];

  afterEach(() => {
    handle?.close();
    handle = null;
    for (const dir of auditDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('serves GET /health', async () => {
    handle = await startCodexProxy([{
      modelId: 'test-model',
      npm: '@ai-sdk/anthropic',
      apiKey: 'sk-test',
      upstreamModelId: 'claude-sonnet-4-6',
    }]);

    const res = await fetch(`http://127.0.0.1:${handle.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rejects POST /v1/responses without placeholder key', async () => {
    handle = await startCodexProxy([{
      modelId: 'test-model',
      npm: '@ai-sdk/anthropic',
      apiKey: 'sk-test',
      upstreamModelId: 'claude-sonnet-4-6',
    }]);

    const res = await fetch(`http://127.0.0.1:${handle.port}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' },
      body: JSON.stringify({ model: 'test-model', input: 'hi' }),
    });
    expect(res.status).toBe(401);
  });

  it('falls back to first route for unknown model', async () => {
    handle = await startCodexProxy([
      {
        modelId: 'claude-fable-5',
        npm: '@ai-sdk/anthropic',
        apiKey: 'sk-test',
        upstreamModelId: 'claude-fable-5',
      },
      {
        modelId: 'claude-haiku-4-5',
        npm: '@ai-sdk/anthropic',
        apiKey: 'sk-test',
        upstreamModelId: 'claude-haiku-4-5',
      },
    ], { requireAuth: false });

    const res = await fetch(`http://127.0.0.1:${handle.port}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'relay-ai-launch-codex-app/unknown-model', input: 'hi', stream: false }),
    });
    // Fallback to first route — upstream rejects sk-test with 401, not a proxy-level 404
    expect(res.status).not.toBe(404);
  });

  it('resolves namespaced catalog model ids', async () => {
    const { findCodexProxyRoute } = await import('../src/codex-proxy.js');
    const routes = [
      {
        modelId: 'claude-sonnet-4-6',
        npm: '@ai-sdk/anthropic',
        apiKey: 'sk-test',
        upstreamModelId: 'claude-sonnet-4-6',
      },
    ];
    const route = findCodexProxyRoute(routes, 'relay-ai-launch-codex-app/claude-sonnet-4-6');
    expect(route?.modelId).toBe('claude-sonnet-4-6');
  });

  it('resolves double underscore namespaced model ids (CLI favorites)', async () => {
    const { findCodexProxyRoute } = await import('../src/codex-proxy.js');
    const routes = [
      {
        modelId: 'grok-4.3',
        npm: '@ai-sdk/xai',
        apiKey: 'sk-test',
        upstreamModelId: 'grok-4.3',
      },
    ];
    const route = findCodexProxyRoute(routes, 'xai__grok-4.3');
    expect(route?.modelId).toBe('grok-4.3');
  });

  it('honors the provider in double underscore model ids', async () => {
    const { findCodexProxyRoute } = await import('../src/codex-proxy.js');
    const routes = [
      {
        modelId: 'shared-model',
        providerId: 'first',
        npm: '@ai-sdk/openai-compatible',
        apiKey: 'first-key',
        upstreamModelId: 'first-upstream',
      },
      {
        modelId: 'shared-model',
        providerId: 'second',
        npm: '@ai-sdk/openai-compatible',
        apiKey: 'second-key',
        upstreamModelId: 'second-upstream',
      },
    ];

    expect(findCodexProxyRoute(routes, 'second__shared-model')?.providerId).toBe('second');
    expect(findCodexProxyRoute(
      routes,
      'relay-ai-launch-codex-app/second__shared-model',
    )?.providerId).toBe('second');
  });

  it('allows POST /v1/responses without auth when requireAuth is false', async () => {
    handle = await startCodexProxy([{
      modelId: 'test-model',
      npm: '@ai-sdk/anthropic',
      apiKey: 'sk-test',
      upstreamModelId: 'claude-sonnet-4-6',
    }], { requireAuth: false });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/v1/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'test-model', input: 'hi', stream: false }),
        signal: controller.signal,
      });
      // Proxy accepted the request and passed it upstream.
      // The proxy's own auth rejection always uses type:'invalid_api_key';
      // upstream errors (including upstream 401s) use type:'api_error'.
      const body = await res.json() as { error?: { type?: string } };
      expect(body.error?.type).not.toBe('invalid_api_key');
    } catch (err) {
      // AbortError means the proxy accepted the request and is awaiting upstream.
      expect(err instanceof Error && err.name === 'AbortError').toBe(true);
    } finally {
      clearTimeout(timer);
    }
  });

  it('serves GET /v1/models and GET /v1/models/:id', async () => {
    handle = await startCodexProxy([
      {
        modelId: 'claude-sonnet-4.5',
        npm: '@ai-sdk/anthropic',
        apiKey: 'sk-test',
        upstreamModelId: 'claude-sonnet-4-5-20250929',
        providerId: 'anthropic',
      },
    ], { requireAuth: false });

    // 1. GET /v1/models
    const resList = await fetch(`http://127.0.0.1:${handle.port}/v1/models`);
    expect(resList.status).toBe(200);
    const listBody = await resList.json() as { object: string; data: Array<{ id: string; owned_by: string }> };
    expect(listBody.object).toBe('list');
    expect(listBody.data).toContainEqual(expect.objectContaining({
      id: 'claude-sonnet-4.5',
      owned_by: 'anthropic',
    }));
    expect(listBody.data).toContainEqual(expect.objectContaining({
      id: 'anthropic__claude-sonnet-4.5',
      owned_by: 'anthropic',
    }));

    // 2. GET /v1/models/:id (namespaced slug)
    const resModelNamespaced = await fetch(`http://127.0.0.1:${handle.port}/v1/models/anthropic__claude-sonnet-4.5`);
    expect(resModelNamespaced.status).toBe(200);
    const modelBodyNamespaced = await resModelNamespaced.json() as { id: string; owned_by: string };
    expect(modelBodyNamespaced.id).toBe('anthropic__claude-sonnet-4.5');
    expect(modelBodyNamespaced.owned_by).toBe('anthropic');

    // 3. GET /v1/models/:id (bare id)
    const resModelBare = await fetch(`http://127.0.0.1:${handle.port}/v1/models/claude-sonnet-4.5`);
    expect(resModelBare.status).toBe(200);
    const modelBodyBare = await resModelBare.json() as { id: string; owned_by: string };
    expect(modelBodyBare.id).toBe('claude-sonnet-4.5');
    expect(modelBodyBare.owned_by).toBe('anthropic');

    // 4. GET /v1/models/:id (invalid)
    const resModelInvalid = await fetch(`http://127.0.0.1:${handle.port}/v1/models/non-existent`);
    expect(resModelInvalid.status).toBe(404);
  });

  it('requires the mixed capability path and forwards native Responses unchanged', async () => {
    const nativeFetch = vi.fn(async () => new Response('native-sse', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));
    const capability = 'A'.repeat(43);
    const auditDir = mkdtempSync(join(tmpdir(), 'relay-route-audit-'));
    auditDirs.push(auditDir);
    const routeAuditPath = join(auditDir, 'route-audit.jsonl');
    handle = await startCodexProxy([], {
      requireAuth: false,
      routeAuditPath,
      mixedNative: { nativeModelIds: new Set(['gpt-5.5']), capability, nativeFetchImpl: nativeFetch as typeof fetch },
    });
    try {
      const wrong = await fetch(`http://127.0.0.1:${handle.port}/v1/responses`, {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-5.5', input: 'hi' }),
      });
      expect(wrong.status).toBe(404);

      const native = await fetch(`http://127.0.0.1:${handle.port}/_relay-codex/${capability}/v1/responses`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer native',
          'chatgpt-account-id': 'acct',
          'x-provider-key': 'relay-secret',
        },
        body: JSON.stringify({ model: 'gpt-5.5', input: 'hi' }),
      });
      expect(native.status).toBe(200);
      expect(await native.text()).toBe('native-sse');
      expect(nativeFetch).toHaveBeenCalledOnce();
      const init = nativeFetch.mock.calls[0]![1] as RequestInit;
      expect(init.headers).toEqual(expect.objectContaining({ authorization: 'Bearer native', 'ChatGPT-Account-Id': 'acct' }));
      expect(JSON.stringify(init.headers)).not.toContain('relay-secret');

      const auditText = readFileSync(routeAuditPath, 'utf8');
      const auditEvents = auditText.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
      expect(auditEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({ dispatch: 'native', phase: 'dispatch', requestedModel: 'gpt-5.5', provider: 'openai-native' }),
        expect.objectContaining({ dispatch: 'native', phase: 'complete', requestedModel: 'gpt-5.5', outcome: 'ok', status: 200 }),
      ]));
      expect(auditText).not.toContain('hi');
      expect(auditText).not.toContain('Bearer');
      expect(auditText).not.toContain('relay-secret');
      expect(statSync(routeAuditPath).mode & 0o777).toBe(0o600);

      const unknown = await fetch(`http://127.0.0.1:${handle.port}/_relay-codex/${capability}/v1/responses`, {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-5.6-sol', input: 'hi' }),
      });
      expect(unknown.status).toBe(404);
    } finally { /* proxy cleanup runs in afterEach */ }
  });

  it('rejects an unknown model in mixed mode instead of silently using the first Relay route', async () => {
    const capability = 'C'.repeat(43);
    handle = await startCodexProxy([{
      modelId: 'provider__approved-subagent',
      npm: '@ai-sdk/anthropic',
      apiKey: 'sk-test',
      upstreamModelId: 'approved-subagent',
    }], {
      requireAuth: false,
      mixedNative: { nativeModelIds: new Set(['gpt-5.5']), capability },
    });
    const response = await fetch(`http://127.0.0.1:${handle.port}/_relay-codex/${capability}/v1/responses`, {
      method: 'POST',
      body: JSON.stringify({ model: 'provider__not-approved', input: 'hi' }),
    });
    expect(response.status).toBe(404);
  });

  it('forwards a mixed native WebSocket response.create frame to the native upstream', async () => {
    const upstream = new WebSocketServer({ port: 0 });
    const upstreamPort = await new Promise<number>(resolve => upstream.on('listening', () => resolve((upstream.address() as { port: number }).port)));
    const received: Record<string, unknown>[] = [];
    upstream.on('connection', socket => {
      socket.once('message', data => {
        received.push(JSON.parse(data.toString()) as Record<string, unknown>);
        socket.send(JSON.stringify({ type: 'response.completed', response: { status: 'completed' } }));
        socket.close();
      });
    });
    const capability = 'B'.repeat(43);
    handle = await startCodexProxy([], {
      requireAuth: false,
      mixedNative: { nativeModelIds: new Set(['gpt-5.5']), capability, nativeBaseUrl: `http://127.0.0.1:${upstreamPort}` },
    });
    try {
      const messages: string[] = [];
      await new Promise<void>((resolve, reject) => {
        const client = new WebSocket(`ws://127.0.0.1:${handle!.port}/_relay-codex/${capability}/v1/responses`, {
          headers: { authorization: 'Bearer native', 'chatgpt-account-id': 'acct' },
        });
        const relayCompaction = (
          buildCompactionResponseBody('earlier Relay work', 'relay-model').output as Record<string, unknown>[]
        )[0]!;
        client.on('open', () => client.send(JSON.stringify({ model: 'gpt-5.5', input: [relayCompaction] })));
        client.on('message', data => messages.push(data.toString()));
        client.on('close', () => resolve());
        client.on('error', reject);
      });
      expect(received[0]).toMatchObject({
        type: 'response.create',
        model: 'gpt-5.5',
        input: [{
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '[Summary of earlier conversation]\nearlier Relay work' }],
        }],
      });
      expect(messages).toContain(JSON.stringify({ type: 'response.completed', response: { status: 'completed' } }));
    } finally {
      await new Promise<void>(resolve => upstream.close(() => resolve()));
    }
  });

  it('keeps the native WebSocket bridge open for multiple response.create turns', async () => {
    const upstream = new WebSocketServer({ port: 0 });
    const upstreamPort = await new Promise<number>(resolve => upstream.on('listening', () => resolve((upstream.address() as { port: number }).port)));
    const received: Record<string, unknown>[] = [];
    upstream.on('connection', socket => {
      socket.on('message', data => {
        received.push(JSON.parse(data.toString()) as Record<string, unknown>);
        socket.send(JSON.stringify({ type: 'response.completed', response: { status: 'completed' } }));
        if (received.length === 2) socket.close();
      });
    });
    const capability = 'D'.repeat(43);
    handle = await startCodexProxy([], {
      requireAuth: false,
      mixedNative: { nativeModelIds: new Set(['gpt-5.5']), capability, nativeBaseUrl: `http://127.0.0.1:${upstreamPort}` },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const client = new WebSocket(`ws://127.0.0.1:${handle!.port}/_relay-codex/${capability}/v1/responses`);
        const timer = setTimeout(() => { client.close(); reject(new Error('timed out waiting for second native turn')); }, 2000);
        let responseCount = 0;
        client.on('open', () => client.send(JSON.stringify({ model: 'gpt-5.5', input: 'first' })));
        client.on('message', data => {
          const event = JSON.parse(data.toString()) as { type?: string };
          if (event.type !== 'response.completed') return;
          responseCount += 1;
          if (responseCount === 1) client.send(JSON.stringify({ model: 'gpt-5.5', input: 'second' }));
        });
        client.on('close', () => { clearTimeout(timer); resolve(); });
        client.on('error', reject);
      });
      expect(received).toHaveLength(2);
      expect(received[0]).toMatchObject({ type: 'response.create', input: 'first' });
      expect(received[1]).toMatchObject({ type: 'response.create', input: 'second' });
    } finally {
      await new Promise<void>(resolve => upstream.close(() => resolve()));
    }
  });

  it('reports a later native turn that closes before completion', async () => {
    const upstream = new WebSocketServer({ port: 0 });
    const upstreamPort = await new Promise<number>(resolve => upstream.on('listening', () => resolve((upstream.address() as { port: number }).port)));
    const received: Record<string, unknown>[] = [];
    upstream.on('connection', socket => {
      socket.on('message', data => {
        const body = JSON.parse(data.toString()) as Record<string, unknown>;
        received.push(body);
        if (received.length === 1) {
          socket.send(JSON.stringify({ type: 'response.completed', response: { status: 'completed' } }));
        } else {
          socket.close(1011, 'later turn failed');
        }
      });
    });
    const capability = 'H'.repeat(43);
    handle = await startCodexProxy([], {
      requireAuth: false,
      mixedNative: { nativeModelIds: new Set(['gpt-5.5']), capability, nativeBaseUrl: `http://127.0.0.1:${upstreamPort}` },
    });
    try {
      const result = await new Promise<{ closeCode: number; errors: Record<string, unknown>[] }>((resolve, reject) => {
        const client = new WebSocket(`ws://127.0.0.1:${handle!.port}/_relay-codex/${capability}/v1/responses`);
        const errors: Record<string, unknown>[] = [];
        const timer = setTimeout(() => { client.close(); reject(new Error('timed out waiting for later native turn failure')); }, 3_000);
        let completed = 0;
        client.on('open', () => client.send(JSON.stringify({ model: 'gpt-5.5', input: 'first' })));
        client.on('message', data => {
          const event = JSON.parse(data.toString()) as Record<string, unknown>;
          if (event.type === 'response.completed') {
            completed += 1;
            if (completed === 1) client.send(JSON.stringify({ model: 'gpt-5.5', input: 'second' }));
          }
          if (event.type === 'error') errors.push(event);
        });
        client.on('close', closeCode => { clearTimeout(timer); resolve({ closeCode, errors }); });
        client.on('error', reject);
      });
      expect(received).toHaveLength(2);
      expect(result.closeCode).toBe(1011);
      expect(result.errors).toContainEqual(expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({
          type: 'upstream_error',
          message: 'Native Codex WebSocket closed before completion (1011)',
        }),
      }));
    } finally {
      await new Promise<void>(resolve => upstream.close(() => resolve()));
    }
  });

  it('keeps an external WebSocket open for sequential response.create turns', async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const provider = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(Buffer.from(chunk)));
      req.once('end', () => {
        requestBodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
        const turn = requestBodies.length;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({
          id: `chatcmpl-${turn}`,
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { role: 'assistant', content: `turn-${turn}` }, finish_reason: null }],
        })}\n\n`);
        res.write(`data: ${JSON.stringify({
          id: `chatcmpl-${turn}`,
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        })}\n\n`);
        res.end('data: [DONE]\n\n');
      });
    });
    const providerPort = await new Promise<number>(resolve => provider.listen(0, '127.0.0.1', () => resolve((provider.address() as { port: number }).port)));
    const capability = 'F'.repeat(43);
    handle = await startCodexProxy([{
      modelId: 'relay-model',
      npm: '@ai-sdk/openai-compatible',
      apiKey: 'test-key',
      baseURL: `http://127.0.0.1:${providerPort}/v1`,
      upstreamModelId: 'relay-model',
      providerId: 'relay-provider',
    }], {
      requireAuth: false,
      mixedNative: { nativeModelIds: new Set(['gpt-5.5']), capability },
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const client = new WebSocket(`ws://127.0.0.1:${handle!.port}/_relay-codex/${capability}/v1/responses`);
        const timer = setTimeout(() => { client.close(); reject(new Error('timed out waiting for the second external turn')); }, 3_000);
        let completed = 0;
        client.on('open', () => client.send(JSON.stringify({ model: 'relay-model', input: 'first' })));
        client.on('message', data => {
          const event = JSON.parse(data.toString()) as { type?: string };
          if (event.type !== 'response.completed') return;
          completed += 1;
          if (completed === 1) client.send(JSON.stringify({ model: 'relay-model', input: 'second' }));
          if (completed === 2) client.close();
        });
        client.on('close', code => {
          clearTimeout(timer);
          if (code !== 1000 || completed !== 2) {
            reject(new Error(`external socket closed before two turns completed: code=${code} completed=${completed}`));
            return;
          }
          resolve();
        });
        client.on('error', reject);
      });
      expect(requestBodies).toHaveLength(2);
      expect(JSON.stringify(requestBodies[0])).toContain('first');
      expect(JSON.stringify(requestBodies[1])).toContain('second');
    } finally {
      await new Promise<void>(resolve => provider.close(() => resolve()));
    }
  });

  it('reconstructs an external tool continuation from previous_response_id', async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const provider = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(Buffer.from(chunk)));
      req.once('end', () => {
        requestBodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
        const turn = requestBodies.length;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        if (turn === 1) {
          res.write(`data: ${JSON.stringify({
            id: 'chatcmpl-tool-call',
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: {
              role: 'assistant',
              tool_calls: [{ index: 0, id: 'call_pwd', type: 'function', function: { name: 'shell', arguments: '{"cmd":"pwd"}' } }],
            }, finish_reason: 'tool_calls' }],
          })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({
            id: 'chatcmpl-final',
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: { role: 'assistant', content: 'CONTINUATION_OK' }, finish_reason: null }],
          })}\n\n`);
          res.write(`data: ${JSON.stringify({
            id: 'chatcmpl-final',
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n`);
        }
        res.end('data: [DONE]\n\n');
      });
    });
    const providerPort = await new Promise<number>(resolve => provider.listen(0, '127.0.0.1', () => resolve((provider.address() as { port: number }).port)));
    const capability = 'I'.repeat(43);
    handle = await startCodexProxy([{
      modelId: 'relay-model',
      npm: '@ai-sdk/openai-compatible',
      apiKey: 'test-key',
      baseURL: `http://127.0.0.1:${providerPort}/v1`,
      upstreamModelId: 'relay-model',
      providerId: 'relay-provider',
    }], {
      requireAuth: false,
      mixedNative: { nativeModelIds: new Set(['gpt-5.5']), capability },
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const client = new WebSocket(`ws://127.0.0.1:${handle!.port}/_relay-codex/${capability}/v1/responses`);
        const timer = setTimeout(() => { client.close(); reject(new Error('timed out waiting for external continuation')); }, 3_000);
        let completed = 0;
        let responseId = '';
        client.on('open', () => client.send(JSON.stringify({
          model: 'relay-model',
          stream: true,
          tools: [{ type: 'function', name: 'shell', parameters: { type: 'object' } }],
          input: 'run pwd',
        })));
        client.on('message', data => {
          const event = JSON.parse(data.toString()) as { type?: string; response?: { id?: string } };
          if (event.type !== 'response.completed') return;
          completed += 1;
          if (completed === 1) {
            responseId = event.response?.id ?? '';
            client.send(JSON.stringify({
              model: 'relay-model',
              stream: true,
              previous_response_id: responseId,
              tools: [{ type: 'function', name: 'shell', parameters: { type: 'object' } }],
              input: [{ type: 'function_call_output', call_id: 'call_pwd', output: 'workspace' }],
            }));
          } else {
            client.close();
          }
        });
        client.on('close', code => {
          clearTimeout(timer);
          if (code !== 1000 || completed !== 2 || !responseId) {
            reject(new Error(`external continuation failed: code=${code} completed=${completed} responseId=${responseId || '(none)'}`));
            return;
          }
          resolve();
        });
        client.on('error', reject);
      });
      expect(requestBodies).toHaveLength(2);
      const messages = requestBodies[1]!.messages as Array<{ role?: string }>;
      expect(messages.slice(-3).map(message => message.role)).toEqual(['user', 'assistant', 'tool']);
      expect(JSON.stringify(requestBodies[1])).toContain('run pwd');
      expect(JSON.stringify(requestBodies[1])).toContain('call_pwd');
      expect(JSON.stringify(requestBodies[1])).toContain('workspace');
    } finally {
      await new Promise<void>(resolve => provider.close(() => resolve()));
    }
  });

  it('rejects an orphaned external tool continuation before contacting the provider', async () => {
    let providerCalls = 0;
    const provider = createServer((req, res) => {
      providerCalls += 1;
      req.resume();
      req.once('end', () => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(`data: ${JSON.stringify({
          id: 'chatcmpl-orphan',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { role: 'assistant', content: 'provider-was-contacted' }, finish_reason: 'stop' }],
        })}\n\ndata: [DONE]\n\n`);
      });
    });
    const providerPort = await new Promise<number>(resolve => provider.listen(0, '127.0.0.1', () => resolve((provider.address() as { port: number }).port)));
    const capability = 'J'.repeat(43);
    handle = await startCodexProxy([{
      modelId: 'relay-model',
      npm: '@ai-sdk/openai-compatible',
      apiKey: 'test-key',
      baseURL: `http://127.0.0.1:${providerPort}/v1`,
      upstreamModelId: 'relay-model',
      providerId: 'relay-provider',
    }], {
      requireAuth: false,
      mixedNative: { nativeModelIds: new Set(['gpt-5.5']), capability },
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const client = new WebSocket(`ws://127.0.0.1:${handle!.port}/_relay-codex/${capability}/v1/responses`);
        const timer = setTimeout(() => { client.close(); reject(new Error('timed out waiting for orphan rejection')); }, 3_000);
        client.on('open', () => client.send(JSON.stringify({
          model: 'relay-model',
          stream: true,
          previous_response_id: 'resp-expired',
          input: [{ type: 'function_call_output', call_id: 'call_expired', output: 'orphan' }],
        })));
        client.on('message', data => {
          const event = JSON.parse(data.toString()) as { type?: string };
          if (event.type === 'response.completed') client.close();
        });
        client.on('close', code => {
          clearTimeout(timer);
          if (code !== 1000) {
            reject(new Error(`orphan continuation closed unexpectedly: code=${code}`));
            return;
          }
          resolve();
        });
        client.on('error', reject);
      });
      expect(providerCalls).toBe(0);
    } finally {
      await new Promise<void>(resolve => provider.close(() => resolve()));
    }
  });

  it('closes an external WebSocket with policy code when a turn overlaps an active provider request', async () => {
    let providerCalls = 0;
    let firstRequest!: () => void;
    const firstRequestSeen = new Promise<void>(resolve => { firstRequest = resolve; });
    let releaseFirst!: () => void;
    const firstResponseReleased = new Promise<void>(resolve => { releaseFirst = resolve; });
    const provider = createServer((req, res) => {
      req.resume();
      req.once('end', () => {
        providerCalls += 1;
        if (providerCalls !== 1) {
          res.writeHead(500);
          res.end();
          return;
        }
        firstRequest();
        void firstResponseReleased.then(() => {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.end(`data: ${JSON.stringify({
            id: 'chatcmpl-1',
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: { content: 'first' }, finish_reason: 'stop' }],
          })}\n\ndata: [DONE]\n\n`);
        });
      });
    });
    const providerPort = await new Promise<number>(resolve => provider.listen(0, '127.0.0.1', () => resolve((provider.address() as { port: number }).port)));
    const capability = 'G'.repeat(43);
    handle = await startCodexProxy([{
      modelId: 'relay-model',
      npm: '@ai-sdk/openai-compatible',
      apiKey: 'test-key',
      baseURL: `http://127.0.0.1:${providerPort}/v1`,
      upstreamModelId: 'relay-model',
      providerId: 'relay-provider',
    }], {
      requireAuth: false,
      mixedNative: { nativeModelIds: new Set(['gpt-5.5']), capability },
    });

    try {
      const closeCode = await new Promise<number>((resolve, reject) => {
        const client = new WebSocket(`ws://127.0.0.1:${handle!.port}/_relay-codex/${capability}/v1/responses`);
        const timer = setTimeout(() => { client.close(); reject(new Error('timed out waiting for overlap rejection')); }, 3_000);
        client.on('open', () => client.send(JSON.stringify({ model: 'relay-model', input: 'first' })));
        void firstRequestSeen.then(() => client.send(JSON.stringify({ model: 'relay-model', input: 'second' })));
        client.on('close', code => { clearTimeout(timer); resolve(code); });
        client.on('error', reject);
      });
      expect(closeCode).toBe(1008);
      expect(providerCalls).toBe(1);
    } finally {
      releaseFirst();
      await new Promise<void>(resolve => provider.close(() => resolve()));
    }
  });

  it('resolves a WebSocket child payload before contacting the Relay model', async () => {
    const nativeRelay = createServer((req, res) => {
      req.resume();
      req.once('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          output: [{
            type: 'function_call',
            name: 'relay_external_agent_payload',
            arguments: JSON.stringify({ payload: 'DELEGATED_MARKER' }),
          }],
        }));
      });
    });
    const nativePort = await new Promise<number>(resolve => nativeRelay.listen(0, '127.0.0.1', () => resolve((nativeRelay.address() as { port: number }).port)));

    let receiveProviderBody!: (body: Record<string, unknown>) => void;
    const providerBodyPromise = new Promise<Record<string, unknown>>(resolve => {
      receiveProviderBody = resolve;
    });
    const provider = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(Buffer.from(chunk)));
      req.once('end', () => {
        receiveProviderBody(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'test provider stopped after capture' } }));
      });
    });
    const providerPort = await new Promise<number>(resolve => provider.listen(0, '127.0.0.1', () => resolve((provider.address() as { port: number }).port)));

    const capability = 'E'.repeat(43);
    const auditDir = mkdtempSync(join(tmpdir(), 'relay-route-audit-'));
    auditDirs.push(auditDir);
    const routeAuditPath = join(auditDir, 'route-audit.jsonl');
    handle = await startCodexProxy([{
      modelId: 'provider__child',
      npm: '@ai-sdk/openai-compatible',
      apiKey: 'test-key',
      baseURL: `http://127.0.0.1:${providerPort}/v1`,
      upstreamModelId: 'child-model',
      auditUpstreamModelId: 'provider-facing-child-model',
      providerId: 'provider',
    }], {
      requireAuth: false,
      routeAuditPath,
      mixedNative: {
        nativeModelIds: new Set(['gpt-5.6-luna']),
        subagentRouteModelId: 'provider__child',
        capability,
        nativeBaseUrl: `http://127.0.0.1:${nativePort}`,
        nativePayloadRelayModel: 'gpt-5.6-luna',
      },
    });

    try {
      const client = new WebSocket(`ws://127.0.0.1:${handle!.port}/_relay-codex/${capability}/v1/responses`, {
        headers: { authorization: 'Bearer native', 'chatgpt-account-id': 'acct' },
      });
      await new Promise<void>((resolve, reject) => {
        client.on('open', () => {
          client.send(JSON.stringify({
            model: 'gpt-5.6-luna',
            stream: true,
            client_metadata: { 'x-openai-subagent': true },
            input: [{
              type: 'agent_message',
              content: [
                { type: 'input_text', text: 'Message Type: NEW_TASK\nTask name: /root/probe\nSender: /root\nPayload:' },
                { type: 'encrypted_content', encrypted_content: `gAAAAA${'A'.repeat(40)}` },
              ],
            }],
          }));
          resolve();
        });
        client.on('error', reject);
      });
      const providerBody = await Promise.race([
        providerBodyPromise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out waiting for provider request')), 2_000)),
      ]);
      client.close();

      expect(JSON.stringify(providerBody)).toContain('DELEGATED_MARKER');
      expect(JSON.stringify(providerBody)).not.toContain(`gAAAAA${'A'.repeat(40)}`);
      const routeAudit = readFileSync(routeAuditPath, 'utf8');
      expect(routeAudit).toContain('"dispatch":"relay-subagent"');
      expect(routeAudit).toContain('"provider":"provider"');
      expect(routeAudit).toContain('"upstreamModel":"provider-facing-child-model"');
      expect(routeAudit).not.toContain('DELEGATED_MARKER');
      expect(routeAudit).not.toContain('encrypted_content');
    } finally {
      await new Promise<void>(resolve => nativeRelay.close(() => resolve()));
      await new Promise<void>(resolve => provider.close(() => resolve()));
    }
  });

});

describe('Codex mixed sub-agent dispatch', () => {
  const routes = [
    { modelId: 'kilo__kilo-auto/free' },
    { modelId: 'google__gemini-3.5-flash' },
  ];

  it('recognizes the Codex child marker in client metadata without treating the parent as a child', () => {
    expect(isCodexSubagentRequest({ client_metadata: { session_id: 'parent' } })).toBe(false);
    expect(isCodexSubagentRequest({ client_metadata: { 'x-openai-subagent': true } })).toBe(true);
    expect(isCodexSubagentRequest({ client_metadata: { 'x-openai-subagent': 'relay_kilo' } })).toBe(true);
  });

  it('selects only configured sub-agent routes even when the child asks for a native model id', () => {
    const route = resolveCodexSubagentRoute(
      routes,
      'google__gemini-3.5-flash',
      { model: 'gpt-5.6-luna', client_metadata: { 'x-openai-subagent': true } },
    );
    expect(route?.modelId).toBe('google__gemini-3.5-flash');
  });

  it('ignores the incoming child model when one explicit sub-agent route is configured', () => {
    const route = resolveCodexSubagentRoute(
      routes,
      'kilo__kilo-auto/free',
      { model: 'google__gemini-3.5-flash', client_metadata: { 'x-openai-subagent': true } },
    );
    expect(route?.modelId).toBe('kilo__kilo-auto/free');
  });

  it('does not redirect an unmarked native parent request', () => {
    expect(resolveCodexSubagentRoute(
      routes,
      'kilo__kilo-auto/free',
      { model: 'gpt-5.6-luna' },
    )).toBeUndefined();
  });
});

describe('Codex compaction protection', () => {
  it('detects and shrinks oversized relay-started compaction requests before upstream', () => {
    const body = {
      model: 'relay-model',
      stream: true,
      previous_response_id: 'resp_previous',
      input: [
        ...Array.from({ length: 240 }, (_, i) => ({
          type: 'message',
          role: 'user',
          content: `turn ${i}\n${'x'.repeat(20_000)}`,
        })),
        { type: 'compaction_trigger' },
      ],
    };
    const params: CodexSdkCallParams = {
      messages: Array.from({ length: 240 }, (_, i) => ({
        role: 'user',
        content: [{ type: 'text', text: `turn ${i}\n${'x'.repeat(20_000)}` }],
      })),
    };

    expect(isLikelyCodexCompactionRequest(body)).toBe(true);

    const protectedParams = protectCodexCompactionParams(body, params, 100_000);

    expect(estimateCodexRequestChars(protectedParams)).toBeLessThanOrEqual(Math.floor(100_000 * CODEX_APP_AUTO_COMPACT_RATIO) * 3);
    expect(protectedParams.messages.length).toBeGreaterThanOrEqual(3);
    for (const message of protectedParams.messages) {
      const content = message.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
          expect(part.text.length).toBeLessThanOrEqual(12_000);
        }
      }
    }
  });

  it('strips tools from a detected compaction request so the model must return a text summary', () => {
    const body = {
      model: 'relay-model',
      stream: true,
      previous_response_id: 'resp_previous',
      tools: [{ type: 'function', name: 'read_file', parameters: {} }],
      input: [
        ...Array.from({ length: 240 }, (_, i) => ({
          type: 'message',
          role: 'user',
          content: `turn ${i}\n${'x'.repeat(20_000)}`,
        })),
        { type: 'compaction_trigger' },
      ],
    };
    const params: CodexSdkCallParams = {
      messages: Array.from({ length: 240 }, (_, i) => ({
        role: 'user',
        content: [{ type: 'text', text: `turn ${i}\n${'x'.repeat(20_000)}` }],
      })),
      tools: { read_file: {} } as CodexSdkCallParams['tools'],
    };

    expect(isLikelyCodexCompactionRequest(body)).toBe(true);

    const protectedParams = protectCodexCompactionParams(body, params, 100_000);

    expect(protectedParams.tools).toBeUndefined();
  });

  it('caps output tokens on a detected compaction request to bound a runaway generation', () => {
    const body = {
      model: 'relay-model',
      stream: true,
      previous_response_id: 'resp_previous',
      input: [
        ...Array.from({ length: 240 }, (_, i) => ({
          type: 'message',
          role: 'user',
          content: `turn ${i}\n${'x'.repeat(20_000)}`,
        })),
        { type: 'compaction_trigger' },
      ],
    };
    const params: CodexSdkCallParams = {
      messages: Array.from({ length: 240 }, (_, i) => ({
        role: 'user',
        content: [{ type: 'text', text: `turn ${i}\n${'x'.repeat(20_000)}` }],
      })),
    };

    const protectedParams = protectCodexCompactionParams(body, params, 100_000);

    expect(protectedParams.maxOutputTokens).toBe(4_000);
  });

  it('does not raise an already-tighter client-supplied output cap on compaction', () => {
    const body = {
      model: 'relay-model',
      stream: true,
      input: [
        ...Array.from({ length: 240 }, (_, i) => ({
          type: 'message',
          role: 'user',
          content: `turn ${i}\n${'x'.repeat(20_000)}`,
        })),
        { type: 'compaction_trigger' },
      ],
    };
    const params: CodexSdkCallParams = {
      messages: Array.from({ length: 240 }, (_, i) => ({
        role: 'user',
        content: [{ type: 'text', text: `turn ${i}\n${'x'.repeat(20_000)}` }],
      })),
      maxOutputTokens: 500,
    };

    const protectedParams = protectCodexCompactionParams(body, params, 100_000);

    expect(protectedParams.maxOutputTokens).toBe(500);
  });

  it('keeps tools on a normal (non-compaction) request', () => {
    const body = { model: 'relay-model', stream: true, input: 'hello' };
    const params: CodexSdkCallParams = {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      tools: { read_file: {} } as CodexSdkCallParams['tools'],
    };

    expect(isLikelyCodexCompactionRequest(body)).toBe(false);

    const protectedParams = protectCodexCompactionParams(body, params, 100_000);

    expect(protectedParams.tools).toEqual({ read_file: {} });
  });

  it('does NOT classify a huge normal agentic turn as compaction (no marker)', () => {
    // Regression: observed live — a normal 29-message review turn with 131 tools and a
    // 427KB body (> 2x the 200K window) was misclassified as compaction by the old size
    // heuristic, stripping its tools mid-task.
    const body = {
      model: 'relay-model',
      stream: true,
      input: Array.from({ length: 89 }, (_, i) => ({
        type: 'message',
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `turn ${i}\n${'x'.repeat(5_000)}`,
      })),
      tools: [{ type: 'function', name: 'exec_command', parameters: {} }],
    };
    const params: CodexSdkCallParams = {
      messages: Array.from({ length: 29 }, (_, i) => ({
        role: 'user',
        content: [{ type: 'text', text: `turn ${i}\n${'x'.repeat(10_000)}` }],
      })),
      tools: { exec_command: {} } as CodexSdkCallParams['tools'],
    };

    expect(isLikelyCodexCompactionRequest(body)).toBe(false);
    const protectedParams = protectCodexCompactionParams(body, params, 100_000);
    expect(protectedParams.tools).toEqual({ exec_command: {} });
    expect(protectedParams.maxOutputTokens).toBeUndefined();
  });

  it('classifies a small request with a compaction_trigger item as compaction', () => {
    const body = {
      model: 'relay-model',
      stream: true,
      input: [
        { type: 'message', role: 'user', content: 'short conversation' },
        { type: 'compaction_trigger' },
      ],
    };
    expect(isLikelyCodexCompactionRequest(body)).toBe(true);
  });

  it('classifies a prompt-based compaction request by its checkpoint marker', () => {
    // Older Codex versions send the summarization prompt as the final user message
    // (codex-rs templates/compact/prompt.md) instead of a compaction_trigger item.
    const body = {
      model: 'relay-model',
      stream: true,
      input: [
        { type: 'message', role: 'user', content: 'earlier conversation' },
        { type: 'message', role: 'user', content: 'You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.' },
      ],
    };
    expect(isLikelyCodexCompactionRequest(body)).toBe(true);
  });

  it('ignores the checkpoint marker when it appears mid-history (e.g. quoted in a diff)', () => {
    const body = {
      model: 'relay-model',
      stream: true,
      input: [
        { type: 'message', role: 'user', content: 'You are performing a CONTEXT CHECKPOINT COMPACTION — this string appears in a file we are reviewing.' },
        { type: 'message', role: 'user', content: 'now continue the code review' },
      ],
    };
    expect(isLikelyCodexCompactionRequest(body)).toBe(false);
  });

  it('isCodexV2CompactionRequest fires only for a compaction_trigger control, not v1 or durable items', () => {
    const v2 = { input: [{ type: 'message', role: 'user', content: 'x' }, { type: 'compaction_trigger' }] };
    expect(isCodexV2CompactionRequest(v2)).toBe(true);

    // v1 prompt-based path must NOT be treated as v2 (it returns a normal message).
    const v1 = { input: [{ type: 'message', role: 'user', content: 'You are performing a CONTEXT CHECKPOINT COMPACTION. Summarize.' }] };
    expect(isCodexV2CompactionRequest(v1)).toBe(false);

    // A durable compaction summary replayed in history must NOT re-trigger synthesis.
    const replay = { input: [{ type: 'compaction', encrypted_content: 'abc' }, { type: 'message', role: 'user', content: 'continue' }] };
    expect(isCodexV2CompactionRequest(replay)).toBe(false);
  });
});

describe('resolveCodexRoute', () => {
  it('routes OpenAI to tier 1 direct', async () => {
    const { resolveCodexRoute } = await import('../src/codex/routing.js');
    const route = resolveCodexRoute(
      { id: 'openai', name: 'OpenAI', apiKey: 'k', models: [] },
      { id: 'gpt-5', name: 'GPT', family: '', brand: '', modelFormat: 'openai', upstreamModelId: 'gpt-5', npm: '@ai-sdk/openai' },
      'k',
    );
    expect(route.tier).toBe('direct');
  });

  it('routes OpenAI OAuth through the proxy', async () => {
    const { resolveCodexRoute } = await import('../src/codex/routing.js');
    const route = resolveCodexRoute(
      { id: 'openai', name: 'OpenAI', apiKey: 'oauth-token', authType: 'oauth', models: [] },
      { id: 'gpt-5.5', name: 'GPT', family: '', brand: '', modelFormat: 'openai', upstreamModelId: 'gpt-5.5', npm: '@ai-sdk/openai' },
      'oauth-token',
    );
    expect(route.tier).toBe('proxy');
    expect(route.authType).toBe('oauth');
  });

  it('routes Anthropic to tier 2 proxy', async () => {
    const { resolveCodexRoute } = await import('../src/codex/routing.js');
    const route = resolveCodexRoute(
      { id: 'anthropic', name: 'Anthropic', apiKey: 'k', models: [] },
      { id: 'claude-sonnet-4-6', name: 'Sonnet', family: '', brand: '', modelFormat: 'anthropic', upstreamModelId: 'claude-sonnet-4-6', npm: '@ai-sdk/anthropic' },
      'k',
    );
    expect(route.tier).toBe('proxy');
  });

  it('routes xAI to tier 2 proxy in v1', async () => {
    const { resolveCodexRoute } = await import('../src/codex/routing.js');
    const route = resolveCodexRoute(
      { id: 'xai', name: 'xAI', apiKey: 'k', models: [] },
      { id: 'grok-3', name: 'Grok', family: '', brand: '', modelFormat: 'openai', upstreamModelId: 'grok-3', npm: '@ai-sdk/xai' },
      'k',
    );
    expect(route.tier).toBe('proxy');
  });

  it('carries custom endpoint headers through to the route', async () => {
    const { resolveCodexRoute } = await import('../src/codex/routing.js');
    const route = resolveCodexRoute(
      { id: 'custom-zai', name: 'Z.AI Coding Plan', apiKey: 'k', headers: { 'X-Plan': 'coding' }, models: [] },
      { id: 'glm-5.2', name: 'GLM', family: '', brand: '', modelFormat: 'openai', upstreamModelId: 'glm-5.2', npm: '@ai-sdk/openai-compatible', apiBaseUrl: 'https://api.z.ai/api/coding/paas/v4' },
      'k',
    );
    expect(route.tier).toBe('proxy');
    expect(route.headers).toEqual({ 'X-Plan': 'coding' });
  });
});

describe('codexCompatibleProviders', () => {
  it('includes anthropic and zen/go', async () => {
    const { codexCompatibleProviders } = await import('../src/codex/routing.js');
    const providers = [
      { id: 'zen', name: 'Zen', apiKey: 'k', models: [{ id: 'm', name: 'M', family: '', brand: '', modelFormat: 'openai' as const, upstreamModelId: 'm' }] },
      { id: 'groq', name: 'Groq', apiKey: 'k', models: [{ id: 'm', name: 'M', family: '', brand: '', modelFormat: 'openai' as const, upstreamModelId: 'm', npm: '@ai-sdk/groq' }] },
      { id: 'anthropic', name: 'A', apiKey: 'k', models: [{ id: 'm', name: 'M', family: '', brand: '', modelFormat: 'anthropic' as const, upstreamModelId: 'm' }] },
    ];
    expect(codexCompatibleProviders(providers).map(p => p.id).sort()).toEqual(['anthropic', 'groq', 'zen']);
  });
});

describe('buildCodexProfileToml', () => {
  it('writes proxy tier profile with RELAY_AI_CODEX_KEY', async () => {
    const { buildCodexProfileToml } = await import('../src/codex/profile.js');
    const toml = buildCodexProfileToml({
      route: {
        tier: 'proxy',
        npm: '@ai-sdk/anthropic',
        upstreamModelId: 'claude-sonnet-4-6',
        apiKey: 'k',
        modelId: 'claude-sonnet-4-6',
        providerId: 'anthropic',
      },
      proxyPort: 62832,
      catalogPath: '/tmp/models-anthropic.json',
    });
    expect(toml).toContain('model_provider = "relay-ai-proxy"');
    expect(toml).toContain('sandbox = "danger-full-access"');
    expect(toml).toContain('env_key = "RELAY_AI_CODEX_KEY"');
    expect(toml).toContain('wire_api = "responses"');
    expect(toml).toContain('http://127.0.0.1:62832/v1');
  });

  it('writes direct tier for OpenAI', async () => {
    const { buildCodexProfileToml } = await import('../src/codex/profile.js');
    const toml = buildCodexProfileToml({
      route: {
        tier: 'direct',
        npm: '@ai-sdk/openai',
        upstreamModelId: 'gpt-5',
        apiKey: 'k',
        modelId: 'gpt-5',
        providerId: 'openai',
        baseURL: 'https://api.openai.com/v1',
      },
      catalogPath: '/tmp/models-openai.json',
    });
    expect(toml).toContain('model_provider = "openai"');
    expect(toml).toContain('env_key = "OPENAI_API_KEY"');
  });

  it('writes favorites slug and default reasoning effort for capable models', async () => {
    const { buildCodexProfileToml } = await import('../src/codex/profile.js');
    const toml = buildCodexProfileToml({
      route: {
        tier: 'proxy',
        npm: '@ai-sdk/openai-compatible',
        upstreamModelId: 'deepseek-v4-flash-free',
        apiKey: 'k',
        modelId: 'zen__deepseek-v4-flash-free',
        providerId: 'relay-ai-proxy',
      },
      proxyPort: 62832,
      catalogPath: '/tmp/models-favorites.json',
      modelReasoningEffort: 'high',
    });
    expect(toml).toContain('model = "zen__deepseek-v4-flash-free"');
    expect(toml).toContain('model_reasoning_effort = "high"');
  });

  it('escapes Windows paths as valid TOML strings', async () => {
    const { buildCodexProfileToml } = await import('../src/codex/profile.js');
    const toml = buildCodexProfileToml({
      route: {
        tier: 'direct',
        npm: '@ai-sdk/openai',
        upstreamModelId: 'gpt-5',
        apiKey: 'k',
        modelId: 'gpt-5',
        providerId: 'openai',
        baseURL: 'https://api.openai.com/v1',
      },
      catalogPath: 'C:\\Users\\Jacob\\relay-ai\\models-openai.json',
    });
    const parsed = parse(toml) as {
      model_catalog_json?: string;
      model_providers?: Record<string, { base_url?: string }>;
    };
    expect(parsed.model_catalog_json).toBe('C:\\Users\\Jacob\\relay-ai\\models-openai.json');
    expect(parsed.model_providers?.openai?.base_url).toBe('https://api.openai.com/v1');
  });
});

describe('buildCatalogFile', () => {
  it('emits valid ModelInfo schema', async () => {
    const { buildCatalogFile, serializeCatalog } = await import('../src/codex/catalog.js');
    const catalog = buildCatalogFile([
      { id: 'claude-sonnet-4-6', name: 'Sonnet', family: 'claude', brand: '', modelFormat: 'anthropic', upstreamModelId: 'claude-sonnet-4-6', npm: '@ai-sdk/anthropic', contextWindow: 200000 },
    ], 'Anthropic');
    expect(catalog.models).toHaveLength(1);
    expect(catalog.models[0]!.slug).toBe('claude-sonnet-4-6');
    expect(catalog.models[0]!.display_name).toBe('Sonnet');
    expect(catalog.models[0]!.truncation_policy.limit).toBe(200000);
    expect(catalog.models[0]!.supported_reasoning_levels).toHaveLength(3);
    expect(catalog.models[0]!.default_reasoning_level).toBe('high');
    expect(catalog.models[0]!.supports_reasoning_summaries).toBe(true);
    expect(JSON.parse(serializeCatalog(catalog)).models[0].supported_in_api).toBe(true);
  });

  it('formats claude ids when name equals id', async () => {
    const { formatCodexModelLabel, buildAppCatalogFile } = await import('../src/codex/catalog.js');
    const haiku = { id: 'claude-haiku-4-5-20251001', name: 'claude-haiku-4-5-20251001', family: 'claude', brand: 'Claude', modelFormat: 'anthropic' as const, upstreamModelId: 'claude-haiku-4-5-20251001', contextWindow: 200000 };
    const sonnet = { id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6', family: 'claude', brand: 'Claude', modelFormat: 'anthropic' as const, upstreamModelId: 'claude-sonnet-4-6', contextWindow: 200000 };
    expect(formatCodexModelLabel(haiku)).toBe('Claude Haiku 4.5');
    const catalog = buildAppCatalogFile([sonnet, haiku], 'Anthropic', haiku.id);
    expect(catalog.models[0]!.slug).toBe('claude-haiku-4-5-20251001');
    expect(catalog.models[0]!.display_name).toBe('Claude Haiku 4.5');
    expect(catalog.models[0]!.priority).toBe(0);
    expect(catalog.models[1]!.priority).toBe(1);
  });
});
