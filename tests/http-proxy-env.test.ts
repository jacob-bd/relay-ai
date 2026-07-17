import { describe, expect, it } from 'vitest';
import { buildHttpProxyChildEnv, findUnsupportedInheritedProxy } from '../src/http-proxy/env.js';

describe('transparent HTTP proxy child environment', () => {
  it('rejects a corporate or remote inherited proxy with a clear explanation', () => {
    const inherited = { HTTPS_PROXY: 'http://corporate.example:8080' };
    expect(findUnsupportedInheritedProxy(inherited)).toMatchObject({
      name: 'HTTPS_PROXY',
      value: 'http://corporate.example:8080',
    });
    expect(() => buildHttpProxyChildEnv(
      inherited,
      'http://relay-ai:secret@127.0.0.1:4567',
      '/tmp/relay-ca.pem',
    )).toThrow(/existing HTTPS_PROXY.*not yet supported/i);
  });

  it('does not repeat inherited proxy credentials in the refusal message', () => {
    let message = '';
    try {
      buildHttpProxyChildEnv(
        { HTTPS_PROXY: 'http://employee:super-secret@corporate.example:8080' },
        'http://relay-ai:secret@127.0.0.1:4567',
        '/tmp/relay-ca.pem',
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/existing HTTPS_PROXY/i);
    expect(message).not.toContain('super-secret');
  });

  it('allows loopback proxy values and replaces them only in the child process', () => {
    const inherited = {
      HTTPS_PROXY: 'http://127.0.0.1:9999',
      NODE_EXTRA_CA_CERTS: '/tmp/corporate-ca.pem',
      CLAUDE_CODE_USE_VERTEX: '1',
      ANTHROPIC_VERTEX_PROJECT_ID: 'stale-project',
      ANTHROPIC_API_KEY: 'native-api-key',
      ANTHROPIC_AUTH_TOKEN: 'native-oauth-token',
      ENABLE_TOOL_SEARCH: 'false',
      CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT: '1',
      KEEP_ME: 'yes',
    };
    const child = buildHttpProxyChildEnv(
      inherited,
      'http://relay-ai:secret@127.0.0.1:4567',
      '/tmp/combined-ca.pem',
    );

    expect(child).toMatchObject({
      HTTPS_PROXY: 'http://relay-ai:secret@127.0.0.1:4567',
      HTTP_PROXY: 'http://relay-ai:secret@127.0.0.1:4567',
      https_proxy: 'http://relay-ai:secret@127.0.0.1:4567',
      http_proxy: 'http://relay-ai:secret@127.0.0.1:4567',
      NODE_EXTRA_CA_CERTS: '/tmp/combined-ca.pem',
      KEEP_ME: 'yes',
      ANTHROPIC_API_KEY: 'native-api-key',
      ANTHROPIC_AUTH_TOKEN: 'native-oauth-token',
      ENABLE_TOOL_SEARCH: 'false',
      CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT: '1',
    });
    expect(child.CLAUDE_CODE_USE_VERTEX).toBeUndefined();
    expect(child.ANTHROPIC_VERTEX_PROJECT_ID).toBeUndefined();
    expect(inherited.HTTPS_PROXY).toBe('http://127.0.0.1:9999');
  });

  it('removes only Anthropic and wildcard entries from inherited proxy bypass lists', () => {
    const child = buildHttpProxyChildEnv(
      {
        NO_PROXY: '*, localhost,internal.example',
        no_proxy: 'api.anthropic.com:443,.anthropic.com,127.0.0.1',
      },
      'http://relay-ai:secret@127.0.0.1:4567',
      '/tmp/relay-ca.pem',
    );

    expect(child.NO_PROXY).toBe('localhost,internal.example');
    expect(child.no_proxy).toBe('127.0.0.1');
  });
});
