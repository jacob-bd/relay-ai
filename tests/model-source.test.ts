import { describe, it, expect } from 'vitest';
import { resolveModelSource } from '../src/registry/model-source.js';
import type { RegistryProvider } from '../src/registry/types.js';

function stub(partial: Partial<RegistryProvider> & Pick<RegistryProvider, 'id' | 'templateId'>): RegistryProvider {
  return {
    name: partial.id,
    enabled: true,
    authRef: 'keyring:provider:test',
    api: {},
    addedAt: '2026-06-09T00:00:00.000Z',
    ...partial,
  };
}

describe('resolveModelSource', () => {
  it('returns zen-go-api for zen and go', () => {
    expect(resolveModelSource(stub({ id: 'zen', templateId: 'zen' }))).toBe('zen-go-api');
    expect(resolveModelSource(stub({ id: 'go', templateId: 'go' }))).toBe('zen-go-api');
  });

  it('returns api-list for groq template', () => {
    expect(resolveModelSource(stub({ id: 'groq', templateId: 'groq' }))).toBe('api-list');
  });

  it('returns manual-only for google-vertex import id', () => {
    expect(resolveModelSource(stub({ id: 'google-vertex', templateId: 'google-vertex' }))).toBe('manual-only');
  });

  it('returns manual-only for bedrock template', () => {
    expect(resolveModelSource(stub({ id: 'bedrock', templateId: 'bedrock' }))).toBe('manual-only');
  });

  it('returns api-list for custom endpoints', () => {
    expect(resolveModelSource(stub({ id: 'my-server', templateId: 'custom-openai' }))).toBe('api-list');
  });
});
