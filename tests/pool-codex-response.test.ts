import { describe, expect, it } from 'vitest';
import { writeCodexPoolResponse } from '../src/pool/codex-response.js';
import type { PoolEvent } from '../src/pool/attempt.js';
const stream = (parts: PoolEvent[]) => (async function* () { yield* parts; })();
describe('Codex pool response formatting', () => {
  it('returns protocol-valid stream and nonstream results from the same formatter', async () => {
    const parts: PoolEvent[] = [{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', text: 'OK' }, { type: 'text-end', id: 't' }, { type: 'finish', finishReason: 'stop' }];
    const chunks: string[] = [];
    const response = await writeCodexPoolResponse(stream(parts), 'relay-free-pool', chunk => chunks.push(chunk));
    expect(response.status).toBe('completed');
    expect(chunks.join('')).toContain('response.completed');
    let writes = 0;
    const nonstream = await writeCodexPoolResponse(stream(parts), 'relay-free-pool', () => writes++, { nonstream: true });
    expect(writes).toBe(0);
    expect(nonstream.output).toMatchObject([{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'OK' }] }]);
  });
  it('bounds nonstream buffering and closes the upstream iterator', async () => {
    let closed = false;
    const source = (async function* () { try { yield { type: 'text-delta', text: 'x'.repeat(2000) }; } finally { closed = true; } })();
    await expect(writeCodexPoolResponse(source, 'pool', () => {}, { nonstream: true, maxResponseBytes: 1000 })).rejects.toThrow('buffer');
    expect(closed).toBe(true);
  });
});


it('writes no preamble when every pool attempt fails before commitment', async () => {
  const chunks: string[] = [];
  const source = (async function* () { throw new Error('all members failed'); yield { type: 'finish' }; })();
  await expect(writeCodexPoolResponse(source, 'pool', chunk => chunks.push(chunk))).rejects.toThrow('all members failed');
  expect(chunks).toEqual([]);
});
