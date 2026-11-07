import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), stream: vi.fn() }));
vi.mock('../src/core/model.js', () => ({ createRelayModel: mocks.create }));
vi.mock('ai', async original => ({ ...await original<typeof import('ai')>(), streamText: mocks.stream }));
vi.mock('../src/registry/io.js', () => ({ loadRegistry: () => ({ providers: [{ id: 'groq-2', enabled: true, api: {}, modelsCache: { models: [{ id: 'test' }] } }] }) }));
import { probeModel, testModel } from '../src/test-model.js';
const parts = (...events: any[]) => ({ stream: (async function* () { yield* events; })() });
beforeEach(() => { vi.clearAllMocks(); mocks.create.mockResolvedValue({}); });
describe('context probe early stop', () => {
 it('does not crash the process when aborting after the first text token', async () => {
  const aborted = new DOMException('This operation was aborted', 'AbortError');
  const reject = () => Promise.reject(aborted);
  mocks.stream.mockReturnValue({
   stream: (async function* () { yield { type: 'text-delta', text: 'OK' }; })(),
   text: reject(), toolCalls: reject(), toolResults: reject(), finishReason: reject(), usage: reject(), response: reject(),
  });
  const seen: unknown[] = [];
  const onUnhandled = (reason: unknown) => { seen.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  try {
   expect(await probeModel('groq-2', 'test', AbortSignal.timeout(5_000))).toEqual({ chat: true });
   await new Promise<void>(resolve => setImmediate(resolve));
   expect(seen).toEqual([]);
  } finally {
   process.off('unhandledRejection', onUnhandled);
  }
 });
});
describe('model reachability test', () => {
 it('uses the exact account/model through the runtime and requires text and completion', async () => {
  mocks.stream.mockReturnValue(parts({ type: 'text-delta', text: 'OK' }, { type: 'finish' }));
  expect(await testModel('groq-2', 'test')).toMatchObject({ ok: true, latencyMs: expect.any(Number), notChat: false });
  // A session id is always sent: OpenCode Go rejects requests without one (MissingSessionID).
  expect(mocks.create).toHaveBeenCalledWith('groq-2::test', { sessionId: expect.stringMatching(/^relay-test-/) });
  expect(mocks.stream).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0, abortSignal: expect.any(AbortSignal), maxOutputTokens: 1024, tools: expect.any(Object) }));
 });
 it('uses one request without an implicit context probe and reports tool evidence', async () => {
  mocks.stream.mockReturnValue(parts({ type: 'tool-call', toolName: 'relay_pool_probe', input: { value: 'ok' } }, { type: 'finish', finishReason: 'tool-calls' }));
  expect(await testModel('groq-2', 'test')).toMatchObject({ ok: true, toolsPassed: true });
  expect(mocks.stream).toHaveBeenCalledTimes(1);
 });
 it('does not pass truncated output or malformed tool arguments', async () => {
  mocks.stream.mockReturnValue(parts({ type: 'text-delta', text: 'OK' }, { type: 'finish', finishReason: 'length' }));
  expect((await testModel('groq-2', 'test')).ok).toBe(false);
  mocks.stream.mockReturnValue(parts({ type: 'tool-call', toolName: 'relay_pool_probe', input: { value: 'wrong' } }, { type: 'finish', finishReason: 'tool-calls' }));
  expect((await testModel('groq-2', 'test')).ok).toBe(false);
 });
 it.each([{events:[]}, {events:[{ type: 'finish' }]}, {events:[{ type: 'text-delta', text: 'partial' }]}])('does not pass an incomplete/empty stream', async ({events}) => {
  mocks.stream.mockReturnValue(parts(...events));
  expect((await testModel('groq-2', 'test')).ok).toBe(false);
 });
 it.each([401,403,429,402,500])('sanitizes upstream error %s including in-stream errors', async statusCode => {
  mocks.stream.mockReturnValue(parts({ type: 'error', error: { statusCode, message: 'secret-key', responseBody: 'secret-key' } }));
  const r=await testModel('groq-2', 'test'); expect(r.ok).toBe(false); expect(JSON.stringify(r)).not.toContain('secret-key');
 });
 it('explains a non-chat model instead of a generic failure', async () => {
  mocks.stream.mockReturnValue(parts({ type: 'error', error: { statusCode: 404, responseBody: '{"detail":"Not Found"}' } }));
  const r = await testModel('groq-2', 'test');
  expect(r).toMatchObject({ ok: false, notChat: true });
  expect(r.error).toMatch(/not a chat model/);
 });
 it('explains an endpoint that does not serve the model (gateway unsupported_path)', async () => {
  mocks.stream.mockReturnValue(parts({ type: 'error', error: { statusCode: 404, message: 'secret-key',
   responseBody: '{"error": "unsupported_path", "message": "/m/v1/messages is not an OpenAI surface this broker proxies"}' } }));
  const r = await testModel('groq-2', 'test');
  expect(r).toMatchObject({ ok: false });
  expect(r).not.toHaveProperty('notChat');
  expect(r.error).toMatch(/endpoint doesn't serve this model/);
  expect(JSON.stringify(r)).not.toContain('secret-key');
 });
 it('says the plan excludes the model instead of a generic access error', async () => {
  mocks.stream.mockReturnValue(parts({ type: 'error', error: { statusCode: 403, message: 'secret-key',
   responseBody: 'subscription personal does not include model tenant/claude' } }));
  const r = await testModel('groq-2', 'test');
  expect(r.error).toBe("Your plan doesn't include this model.");
  expect(JSON.stringify(r)).not.toContain('secret-key');
 });
 it('keeps the generic access message for other 403s', async () => {
  mocks.stream.mockReturnValue(parts({ type: 'error', error: { statusCode: 403, responseBody: 'forbidden' } }));
  expect((await testModel('groq-2', 'test')).error).toMatch(/Access denied/);
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
