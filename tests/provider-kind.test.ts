import { describe, it, expect } from 'vitest';
import { PROVIDER_TEMPLATES } from '../src/provider-templates.js';
import { isProviderKind, nextInstanceId, providerKind } from '../src/registry/provider-kind.js';
import { isValidProviderId } from '../src/registry/validate.js';

describe('providerKind', () => {
  it('returns the id itself for ordinary providers', () => {
    expect(providerKind('groq')).toBe('groq');
    expect(providerKind('openai-oauth')).toBe('openai-oauth');
    expect(providerKind('custom-acme')).toBe('custom-acme');
  });

  it('maps numbered instances of known providers back to their kind', () => {
    expect(providerKind('groq-2')).toBe('groq');
    expect(providerKind('openai-oauth-3')).toBe('openai-oauth');
    expect(providerKind('claude-code-2')).toBe('claude-code');
    expect(providerKind('zen-12')).toBe('zen');
  });

  it('leaves numbered ids of unknown bases alone (custom backends keep their own ids)', () => {
    expect(providerKind('custom-acme-2')).toBe('custom-acme-2');
    expect(providerKind('mystery-2')).toBe('mystery-2');
  });

  it('does not treat -0 / -1 as instances (they start at -2)', () => {
    expect(providerKind('groq-1')).toBe('groq-1');
    expect(providerKind('groq-0')).toBe('groq-0');
  });

  it('never rewrites a real template id, even one that looks numbered', () => {
    const ids = [...PROVIDER_TEMPLATES.map(t => t.id), 'openai-oauth', 'xai-oauth', 'zen', 'go'];
    for (const id of ids) expect(providerKind(id), id).toBe(id);
  });

  it('isProviderKind compares by kind', () => {
    expect(isProviderKind('claude-code-2', 'claude-code')).toBe(true);
    expect(isProviderKind('claude-code', 'claude-code')).toBe(true);
    expect(isProviderKind('groq-2', 'claude-code')).toBe(false);
  });
});

describe('nextInstanceId', () => {
  it('uses the first free number from 2', () => {
    expect(nextInstanceId('openai-oauth', ['openai-oauth'])).toBe('openai-oauth-2');
    expect(nextInstanceId('openai-oauth', ['openai-oauth', 'openai-oauth-2'])).toBe('openai-oauth-3');
  });

  it('produces valid ids that map back to the base kind', () => {
    const id = nextInstanceId('groq', ['groq']);
    expect(isValidProviderId(id)).toBe(true);
    expect(providerKind(id)).toBe('groq');
  });
});
