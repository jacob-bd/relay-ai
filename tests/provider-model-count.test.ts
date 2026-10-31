import { expect, it, vi } from 'vitest';
vi.mock('../src/model-compatibility.js',()=>({ shouldHideModel: ({modelId}: {modelId:string})=>modelId.startsWith('audio-') }));
import { getAgentProviderModels, getProviderModels } from '../src/registry/provider-models.js';
import { resolveProvidersForDisplay } from '../src/provider-catalog.js';
import { saveRegistry, loadRegistry } from '../src/registry/io.js';
import { loadRegistryProvidersSync } from '../src/registry/load.js';
it('keeps twelve raw entries but shows five agent models consistently after reload',async()=> {
 saveRegistry({schemaVersion:1,providers:[{id:'groq',templateId:'groq',name:'Groq',enabled:true,
 authRef:'env:TEST_GROQ_KEY',authType:'api',api:{npm:'@ai-sdk/groq',url:'https://api.groq.com/openai/v1'},addedAt:new Date().toISOString(),
 modelsCache:{fetchedAt:new Date().toISOString(),models:Array.from({length:12},(_,i)=>({id:i<5?`chat-${i}`:`audio-${i}`,name:`Model ${i}`,modelFormat:'openai' as const}))}}]});
 const p=loadRegistry().providers[0]!;
 expect(getProviderModels(p)).toHaveLength(12);
 expect(getAgentProviderModels(p)).toHaveLength(5);
 expect((await resolveProvidersForDisplay())[0]?.modelCount).toBe(5);
 expect(loadRegistryProvidersSync(()=> 'key')[0]?.models).toHaveLength(5);
});
