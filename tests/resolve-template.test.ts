import { describe, it, expect } from 'vitest';
import { effectiveProviderBaseUrl, resolveProviderTemplate } from '../src/registry/resolve-template.js';
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

describe('resolveProviderTemplate', () => {
  it('maps google-vertex to vertex template', () => {
    const template = resolveProviderTemplate(stub({ id: 'google-vertex', templateId: 'google-vertex' }));
    expect(template?.id).toBe('vertex');
    expect(template?.modelSource).toBe('manual-only');
  });

  it('resolves anthropic template by id', () => {
    const template = resolveProviderTemplate(stub({ id: 'anthropic', templateId: 'anthropic' }));
    expect(template?.defaultBaseUrl).toBe('https://api.anthropic.com');
  });
});

describe('effectiveProviderBaseUrl', () => {
  it('ignores empty url string and uses template default', () => {
    const provider = stub({
      id: 'anthropic',
      templateId: 'anthropic',
      api: { npm: '@ai-sdk/anthropic', url: '' },
    });
    const template = resolveProviderTemplate(provider);
    expect(effectiveProviderBaseUrl(provider, template)).toBe('https://api.anthropic.com');
  });

  it('uses npm fallback for anthropic without template', () => {
    const provider = stub({
      id: 'anthropic',
      templateId: 'anthropic',
      api: { npm: '@ai-sdk/anthropic' },
    });
    expect(effectiveProviderBaseUrl(provider)).toBe('https://api.anthropic.com');
  });
});
