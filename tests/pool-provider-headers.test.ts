import { describe, expect, it } from 'vitest';
import { poolProviderHeaders } from '../src/pool/session-id.js';

describe('poolProviderHeaders', () => {
  it('adds the OpenCode session header for Go, using the conversation id or a fresh one', () => {
    const withId = poolProviderHeaders({ id: 'go' }, { apiBaseUrl: 'https://opencode.ai/zen/go/v1' }, 'conv-1');
    expect(withId?.['x-opencode-session']).toBe('conv-1');
    const without = poolProviderHeaders({ id: 'go-2' }, { apiBaseUrl: 'https://opencode.ai/zen/go/v1' }, undefined);
    expect(without?.['x-opencode-session']).toBeTruthy();
  });

  it('leaves other providers alone', () => {
    expect(poolProviderHeaders({ id: 'kilo' }, { apiBaseUrl: 'https://api.kilo.ai/v1' }, 'conv-1')).toBeUndefined();
    expect(poolProviderHeaders({ id: 'groq', headers: { 'x-a': '1' } }, { apiBaseUrl: 'https://api.groq.com/openai/v1' }, 'conv-1')).toEqual({ 'x-a': '1' });
  });
});
