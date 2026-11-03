import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText } from 'ai';
import { runPoolAttempts, type PoolEvent, type PoolRoute } from '../src/pool/attempt.js';

it('preserves an exact native Google thinking budget through pool HTTP failover', async () => {
  const requests: Array<{ path: string; config: unknown }> = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      requests.push({ path: req.url!, config: body.generationConfig?.thinkingConfig });
      if (req.url?.startsWith('/rate/')) {
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Synthetic quota' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('data: ' + JSON.stringify({
        candidates: [{ index: 0, content: { role: 'model', parts: [{ text: 'BUDGET_PRESERVED' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      }) + '\n\n');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseURL = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const budget = { includeThoughts: true, thinkingBudget: 8192 };
  try {
    const routes: PoolRoute[] = ['rate', 'ok'].map(mode => ({
      id: mode + '/account/rev1/gemini-2.5-pro',
      async open(abortSignal) {
        const model = createGoogleGenerativeAI({
          apiKey: 'fake-google-key', baseURL: baseURL + '/' + mode + '/v1beta',
        })('gemini-2.5-pro');
        return streamText({
          model, prompt: 'synthetic budget test',
          providerOptions: { google: { thinkingConfig: structuredClone(budget) } },
          maxRetries: 0, abortSignal, onError: () => {},
        }).stream as AsyncIterable<PoolEvent>;
      },
    }));
    const parts: PoolEvent[] = [];
    for await (const part of runPoolAttempts(routes, new AbortController().signal, {
      attempts: 3, firstContentMs: 500, idleMs: 500, totalMs: 2000, bufferBytes: 8192, cleanupMs: 200,
    }, () => true)) parts.push(part);
    expect(parts.some(part => part.type === 'text-delta' && part.text === 'BUDGET_PRESERVED')).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests.every(request => request.path.includes('gemini-2.5-pro:streamGenerateContent'))).toBe(true);
    expect(requests.map(request => request.config)).toEqual([budget, budget]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
