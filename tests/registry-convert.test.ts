import { describe, it, expect } from 'vitest';
import { localProviderToRegistry } from '../src/registry/convert.js';
import type { LocalProvider } from '../src/types.js';

const sampleProvider: LocalProvider = {
  id: 'groq',
  name: 'Groq',
  apiKey: 'gsk-test',
  models: [{
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B',
    family: 'llama',
    brand: 'Other',
    modelFormat: 'openai',
    upstreamModelId: 'llama-3.3-70b',
    npm: '@ai-sdk/groq',
  }],
};

describe('localProviderToRegistry', () => {
  it('converts normalized local provider to registry entry', () => {
    const entry = localProviderToRegistry(sampleProvider);
    expect(entry).toMatchObject({
      id: 'groq',
      templateId: 'groq',
      authRef: 'keyring:provider:groq',
      enabled: true,
    });
    expect(entry?.modelsCache?.models[0]?.upstreamModelId).toBe('llama-3.3-70b');
  });

  it('rejects invalid provider ids', () => {
    expect(localProviderToRegistry({ ...sampleProvider, id: 'Bad ID' })).toBeNull();
  });
});
