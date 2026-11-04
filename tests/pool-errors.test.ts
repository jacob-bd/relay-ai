import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { poolFailure, retryPoolFailure } from '../src/pool/errors.js';
describe('pool failure classification', () => {
  it('preserves authoritative cooldowns without capping them', () => {
    expect(poolFailure({ statusCode: 429, responseHeaders: { 'Retry-After': '604800' } }, 1000).retryAt).toBe(604801000);
    expect(poolFailure({ statusCode: 429 }, 1000).retryAt).toBeUndefined();
  });
  it('does not retry invalid requests, cancellation or unknown failures', () => {
    for (const error of [{ statusCode: 400 }, { name: 'AbortError' }, new Error('unknown')]) expect(retryPoolFailure(error)).toBe(false);
    for (const error of [{ statusCode: 429 }, { statusCode: 503 }, new Error('first-content-timeout'), new Error('Pool route entered cooldown')]) expect(retryPoolFailure(error)).toBe(true);
  });
});

describe('installed SDK error classification', () => {
  it('classifies real HTTP failures without exposing response bodies', async () => {
    const modes: Record<string, { status: number; body: unknown; headers?: Record<string, string> }> = {
      rate: { status: 429, headers: { 'retry-after': '7' }, body: { error: { message: 'quota' } } },
      access: { status: 401, body: { error: { message: 'bad key' } } },
      context: { status: 400, body: { error: { message: 'context_length_exceeded: too many tokens' } } },
      invalid: { status: 400, body: { error: { message: 'bad schema' } } },
      transient: { status: 503, body: { error: { message: 'temporarily unavailable' } } },
    };
    const server = createServer((req, res) => {
      const mode = req.url?.split('/')[1] ?? 'invalid';
      const result = modes[mode]!;
      req.resume();
      req.once('end', () => {
        res.writeHead(result.status, { 'content-type': 'application/json', ...result.headers });
        res.end(JSON.stringify(result.body));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseURL = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    const now = 1_700_000_000_000;
    try {
      for (const [mode, expected] of Object.entries({
        rate: 'rate-limit', access: 'access', context: 'context', invalid: 'invalid', transient: 'transient',
      })) {
        const model = createOpenAICompatible({
          name: 'fixture', apiKey: 'fixture-secret', baseURL: baseURL + '/' + mode + '/v1',
        }).chatModel('fixture');
        let error: unknown;
        try { await generateText({ model, prompt: 'synthetic', maxRetries: 0 }); } catch (caught) { error = caught; }
        const classified = poolFailure(error, now);
        expect(classified.kind).toBe(expected);
        if (mode === 'rate') expect(classified.retryAt).toBe(now + 7000);
        expect(JSON.stringify(classified)).not.toContain('fixture-secret');
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
