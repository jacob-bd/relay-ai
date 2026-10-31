import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), stream: vi.fn() }));
vi.mock('../src/core/model.js', () => ({ createRelayModel: mocks.create }));
vi.mock('ai', () => ({ streamText: mocks.stream }));
vi.mock('../src/registry/io.js', () => ({ loadRegistry: () => ({ providers: [{ id: 'groq-2', enabled: true, api: {}, modelsCache: { models: [{ id: 'test' }] } }] }) }));
import { testModel } from '../src/test-model.js';
const parts = (...events: any[]) => ({ stream: (async function* () { yield* events; })() });
beforeEach(() => { vi.clearAllMocks(); mocks.create.mockResolvedValue({}); });
describe('model reachability test', () => {
 it('uses the exact account/model through the runtime and requires text and completion', async () => {
  mocks.stream.mockReturnValue(parts({ type: 'text-delta', text: 'OK' }, { type: 'finish' }));
  expect(await testModel('groq-2', 'test')).toEqual({ ok: true, latencyMs: expect.any(Number) });
  expect(mocks.create).toHaveBeenCalledWith('groq-2::test');
  expect(mocks.stream).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0, abortSignal: expect.any(AbortSignal), prompt: 'Reply with OK.' }));
 });
 it.each([{events:[]}, {events:[{ type: 'finish' }]}, {events:[{ type: 'text-delta', text: 'partial' }]}])('does not pass an incomplete/empty stream', async ({events}) => {
  mocks.stream.mockReturnValue(parts(...events));
  expect((await testModel('groq-2', 'test')).ok).toBe(false);
 });
 it.each([401,403,429,402,500])('sanitizes upstream error %s including in-stream errors', async statusCode => {
  mocks.stream.mockReturnValue(parts({ type: 'error', error: { statusCode, message: 'secret-key', responseBody: 'secret-key' } }));
  const r=await testModel('groq-2', 'test'); expect(r.ok).toBe(false); expect(JSON.stringify(r)).not.toContain('secret-key');
 });
 it('does not call a missing/disabled provider or missing model', async () => {
  expect((await testModel('missing', 'test')).ok).toBe(false);
  expect((await testModel('groq-2', 'removed')).ok).toBe(false);
  expect(mocks.create).not.toHaveBeenCalled();
 });
 it('does not start inference when cancelled', async () => {
  expect((await testModel('groq-2','test',AbortSignal.abort())).ok).toBe(false);
  expect(mocks.stream).not.toHaveBeenCalled();
 });
});
