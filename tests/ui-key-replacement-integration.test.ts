import { EventEmitter } from 'node:events';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createMockRequest, createMockResponse } from './helpers/ui-api-test-utils.js';
const state=vi.hoisted(()=>({store:new Map<string,string>(),write:true,build:vi.fn(),refresh:vi.fn()}));
vi.mock('@napi-rs/keyring',()=>({Entry:class {
 constructor(_service:string,private account:string){}
 getPassword(){return state.store.get(this.account)??null;}
 setPassword(value:string){if(state.write)state.store.set(this.account,value);}
 deletePassword(){state.store.delete(this.account);}
}}));
vi.mock('../src/provider-factory.js',async original=>({...await original<typeof import('../src/provider-factory.js')>(),createLanguageModel:state.build}));
vi.mock('../src/registry/refresh-models.js',()=>({refreshProviderModels:state.refresh,refreshAllProviderModels:vi.fn()}));
vi.mock('ai',async original=>({...await original<typeof import('ai')>(),streamText:()=>({stream:(async function*(){yield {type:'text-delta',text:'OK'};yield {type:'finish'};})()})}));
import { saveRegistry } from '../src/registry/io.js';
import { invalidateKeyringReadCache, resolveProviderCredential } from '../src/env.js';
import { handleUiApiRequest } from '../src/ui/api.js';

async function call(url:string,body:unknown){
 const response=createMockResponse();const events=new EventEmitter();
 response.res.on=events.on.bind(events) as any;response.res.removeListener=events.removeListener.bind(events) as any;
 handleUiApiRequest(createMockRequest('POST',url,JSON.stringify(body)),response.res);
 await vi.waitFor(()=>expect(response.result.data).not.toBe(''));
 return {code:response.result.code,body:JSON.parse(response.result.data)};
}
beforeEach(()=>{
 vi.clearAllMocks();vi.stubEnv('RELAY_AI_KEY_NVIDIA','');invalidateKeyringReadCache();state.store.clear();state.store.set('provider:nvidia','old-key');state.write=true;
 state.build.mockResolvedValue({});state.refresh.mockResolvedValue({ok:true,modelCount:1});
 saveRegistry({schemaVersion:1,providers:[{id:'nvidia',templateId:'nvidia',name:'NVIDIA',enabled:true,authRef:'keyring:provider:nvidia',authType:'api',api:{npm:'@ai-sdk/openai-compatible',url:'https://example.com/v1'},addedAt:new Date().toISOString(),modelsCache:{fetchedAt:new Date().toISOString(),models:[{id:'minimaxai/minimax-m3.1-flash',name:'MiniMax',upstreamModelId:'minimaxai/minimax-m3.1-flash',modelFormat:'openai'}]}}]});
});
afterEach(()=>{vi.unstubAllEnvs();invalidateKeyringReadCache();});
it('uses the entered key for refresh, asks before replacement, then tests with the newly saved key',async()=>{
 expect(await resolveProviderCredential('nvidia','keyring:provider:nvidia')).toBe('old-key');
 await call('/api/providers/refresh',{providerId:'nvidia',key:'new-key'});
 expect(state.refresh).toHaveBeenCalledWith('nvidia','new-key',expect.anything());
 expect(state.store.get('provider:nvidia')).toBe('old-key');
 const prompt=await call('/api/keys',{providerId:'nvidia',key:'new-key'});
 expect(prompt).toMatchObject({code:409,body:{needsConfirmation:true}});
 expect(state.store.get('provider:nvidia')).toBe('old-key');
 const saved=await call('/api/keys',{providerId:'nvidia',key:'new-key',confirmOverwrite:true});
 expect(saved).toEqual({code:200,body:{ok:true}});
 expect(await resolveProviderCredential('nvidia','keyring:provider:nvidia')).toBe('new-key');
 expect((await call('/api/providers/models/test',{providerId:'nvidia',modelId:'minimaxai/minimax-m3.1-flash'})).body.ok).toBe(true);
 expect(state.build).toHaveBeenCalledWith(expect.objectContaining({providerId:'nvidia',apiKey:'new-key'}));
});
it('does not report success when storage silently fails to replace the old key',async()=>{
 state.write=false;
 const r=await call('/api/keys',{providerId:'nvidia',key:'new-key',confirmOverwrite:true});
 expect(r.code).toBe(500);expect(r.body.ok).toBe(false);expect(r.body.error).toContain('read back');
 expect(JSON.stringify(r)).not.toContain('new-key');
});
it('warns when an environment setting still overrides the replacement',async()=>{
 vi.stubEnv('RELAY_AI_KEY_NVIDIA','environment-key');
 const r=await call('/api/keys',{providerId:'nvidia',key:'new-key',confirmOverwrite:true});
 expect(r.code).toBe(409);expect(r.body.error).toContain('overrides');expect(JSON.stringify(r)).not.toContain('environment-key');
});
