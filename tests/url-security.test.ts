import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateCustomEndpointUrl } from '../src/registry/url-security.js';

describe('validateCustomEndpointUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts public https URLs', async () => {
    const result = await validateCustomEndpointUrl('https://api.groq.com/openai/v1');
    expect(result.ok).toBe(true);
    expect(result.normalizedUrl).toContain('api.groq.com');
  });

  it('blocks cloud metadata hostnames', async () => {
    const result = await validateCustomEndpointUrl('https://metadata.google.internal/computeMetadata/v1');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/blocked/i);
  });

  it('blocks plain http without local allowance', async () => {
    const result = await validateCustomEndpointUrl('http://127.0.0.1:11434/v1');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/HTTPS/i);
  });

  it('allows localhost http when allowInsecureLocal is set', async () => {
    const result = await validateCustomEndpointUrl('http://127.0.0.1:11434/v1', { allowInsecureLocal: true });
    expect(result.ok).toBe(true);
  });

  it('allows private LAN http when insecure local access is explicitly approved', async () => {
    const result = await validateCustomEndpointUrl('http://192.168.68.5:11434/v1', { allowInsecureLocal: true });
    expect(result.ok).toBe(true);
    expect(result.normalizedUrl).toBe('http://192.168.68.5:11434/v1');
  });

  it('blocks private LAN http without explicit insecure approval', async () => {
    const result = await validateCustomEndpointUrl('http://192.168.68.5:11434/v1');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/HTTPS/i);
  });

  it('blocks AWS metadata IP', async () => {
    const result = await validateCustomEndpointUrl('https://169.254.169.254/latest/meta-data');
    expect(result.ok).toBe(false);
  });

  it('still blocks metadata IPs even when insecure local access is approved', async () => {
    const result = await validateCustomEndpointUrl('http://169.254.169.254/latest/meta-data', { allowInsecureLocal: true });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/blocked|restricted/i);
  });
});
