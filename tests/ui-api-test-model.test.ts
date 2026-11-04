import { beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createMockRequest, createMockResponse } from './helpers/ui-api-test-utils.js';
const test = vi.hoisted(() => vi.fn());
const pool = vi.hoisted(() => ({ verify: vi.fn(), invalidate: vi.fn() }));
vi.mock('../src/ui/pool-api.js', () => ({ handlePoolApi: vi.fn(), verifyUiPoolMember: pool.verify, invalidateUiPoolMember: pool.invalidate }));
vi.mock('../src/test-model.js', () => ({ testModel: test }));
import { handleUiApiRequest } from '../src/ui/api.js';
beforeEach(() => { pool.verify.mockReset(); pool.invalidate.mockReset(); test.mockReset(); test.mockResolvedValue({ ok:true,latencyMs:25 }); });
async function call(body: unknown) {
 const response=createMockResponse(); const events=new EventEmitter();
 response.res.on=events.on.bind(events) as any;
 response.res.removeListener=events.removeListener.bind(events) as any;
 handleUiApiRequest(createMockRequest('POST','/api/providers/models/test',JSON.stringify(body)),response.res);
 await vi.waitFor(()=>expect(response.result.data).not.toBe(''));
 return {code:response.result.code,body:JSON.parse(response.result.data)};
}
it.each([null,[],{}, {providerId:4,modelId:'m'}, {providerId:'p',modelId:' '}])('rejects invalid request %j', async body=> {
 expect((await call(body)).code).toBe(400); expect(test).not.toHaveBeenCalled();
});
it('only passes selected account/model and returns result',async()=> {
 expect((await call({providerId:' groq-2 ',modelId:' m ',key:'ignored'})).body).toEqual({ok:true,latencyMs:25});
 expect(test).toHaveBeenCalledWith('groq-2','m',expect.any(AbortSignal));
});
it('never exposes unexpected backend error credentials',async()=> {
 test.mockRejectedValue(new Error('secret-key'));
 const r=await call({providerId:'groq',modelId:'m'});expect(r.code).toBe(500);expect(JSON.stringify(r.body)).not.toContain('secret-key');
});

it('reuses the same Test action to cache pool readiness', async () => {
 pool.verify.mockResolvedValue({ ok: true, status: 'verified' });
 expect((await call({ providerId:'free',modelId:'m' })).body.pool).toMatchObject({ ok:true,status:'verified' });
 expect(pool.verify).toHaveBeenCalledWith('free','m',expect.any(AbortSignal), { evidence: { text: 'passed', tools: 'failed' } });
});
it('invalidates old pool readiness when the normal Test fails', async () => {
 test.mockResolvedValue({ ok:false,error:'quota' });
 await call({ providerId:'free',modelId:'m' });
 expect(pool.invalidate).toHaveBeenCalledWith('free','m');
 expect(pool.verify).not.toHaveBeenCalled();
});
