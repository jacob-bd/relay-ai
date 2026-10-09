import { it, expect } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { startCodexProxy } from '../src/codex-proxy.js';

it('keeps Gemini bridge budgets and incomplete status through HTTP, WS, audit, and continuation', async () => {
  const requests: any[] = [];
  const provider = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(body);
    const continued = JSON.stringify(body.messages).includes('continue after truncation');
    const text = continued ? 'finished' : 'if (typeof';
    const stopReason = continued ? 'end_turn' : 'max_tokens';
    const message = {
      id: 'msg_fixture', type: 'message', role: 'assistant', model: body.model,
      content: [{ type: 'text', text }], stop_reason: stopReason, stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 161 },
    };
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(message));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const emit = (type: string, value: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
    emit('message_start', { message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } });
    emit('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    emit('content_block_delta', { index: 0, delta: { type: 'text_delta', text } });
    emit('content_block_stop', { index: 0 });
    emit('message_delta', { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 161 } });
    emit('message_stop', {});
    res.end();
  });
  const port = await new Promise<number>(resolve => provider.listen(0, '127.0.0.1', () => resolve((provider.address() as any).port)));
  const dir = mkdtempSync(join(tmpdir(), 'relay-gemini-bridge-'));
  const auditPath = join(dir, 'audit.jsonl');
  const capability = 'G'.repeat(43);
  const proxy = await startCodexProxy([{
    modelId: 'gemini-worker', npm: '@ai-sdk/anthropic', providerId: 'antigravity',
    upstreamModelId: 'anthropic-antigravity__gemini-3.8-flash-medium[1m]',
    apiKey: 'fixture-key', baseURL: `http://127.0.0.1:${port}`,
  }], {
    requireAuth: false, routeAuditPath: auditPath,
    mixedNative: { nativeModelIds: new Set(['gpt-6-luna']), capability },
  });
  const url = `http://127.0.0.1:${proxy.port}/_relay-codex/${capability}/v1/responses`;
  try {
    const request = { model: 'gemini-worker', input: 'implement the fix' };
    const streamed = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...request, stream: true }) });
    const events = (await streamed.text()).split('\n\n').flatMap(block => {
      const data = block.split('\n').find(line => line.startsWith('data: '));
      return data ? [JSON.parse(data.slice(6))] : [];
    });
    expect(events.at(-1)).toMatchObject({ type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } });
    expect(events.some(event => event.type === 'response.completed')).toBe(false);

    const unary = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
    expect(await unary.json()).toMatchObject({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } });

    const wsEvents: any[] = [];
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url.replace('http:', 'ws:'));
      const timer = setTimeout(() => { ws.terminate(); reject(new Error('Gemini bridge continuation timed out')); }, 5000);
      ws.on('open', () => ws.send(JSON.stringify({ ...request, stream: true })));
      ws.on('message', data => {
        const event = JSON.parse(data.toString());
        wsEvents.push(event);
        if (event.type === 'response.incomplete') {
          ws.send(JSON.stringify({ model: 'gemini-worker', stream: true, previous_response_id: event.response.id, input: 'continue after truncation' }));
        } else if (event.type === 'response.completed' || event.type === 'response.failed') ws.close();
      });
      ws.on('error', reject);
      ws.on('close', () => { clearTimeout(timer); resolve(); });
    });
    expect(wsEvents.filter(event => event.type === 'response.incomplete')).toHaveLength(1);
    expect(wsEvents.at(-1)).toMatchObject({ type: 'response.completed', response: { status: 'completed' } });
    expect(JSON.stringify(requests.at(-1).messages)).toContain('if (typeof');
    expect(requests).toHaveLength(4);
    expect(requests.every(body => body.max_tokens === 65536)).toBe(true);
    const audits = readFileSync(auditPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const outcomes = audits.filter(entry => entry.phase === 'complete');
    expect(outcomes.map(entry => [entry.outcome, entry.status])).toEqual([
      ['error', 'response.incomplete'], ['error', 'response.incomplete'],
      ['error', 'response.incomplete'], ['ok', 'response.completed'],
    ]);
  } finally {
    proxy.close();
    provider.closeAllConnections();
    await new Promise<void>(resolve => provider.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
