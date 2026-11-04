import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isUntrustedCertificateError,
  untrustedCertificateMessage,
  UNTRUSTED_CERTIFICATE_CODE,
} from '../src/tls-trust.js';
import { fetchTemplateModels } from '../src/registry/fetch-template-models.js';
import { fetchAnthropicModels } from '../src/registry/fetch-anthropic-models.js';
import { parseProvidersArgs } from '../src/providers-command.js';
import type { ProviderTemplate } from '../src/provider-templates.js';

function certFailure(code: string): TypeError {
  const err = new TypeError('fetch failed');
  (err as { cause?: unknown }).cause = Object.assign(new Error('cert'), { code });
  return err;
}

const template = {
  id: 'custom-openai',
  name: 'Custom',
  authType: 'api',
  npm: '@ai-sdk/openai-compatible',
  modelSource: 'api-list',
  supported: true,
} as unknown as ProviderTemplate;

describe('isUntrustedCertificateError', () => {
  it('matches an untrusted issuer reported on the fetch cause', () => {
    expect(isUntrustedCertificateError(certFailure('UNABLE_TO_GET_ISSUER_CERT_LOCALLY'))).toBe(true);
    expect(isUntrustedCertificateError(certFailure('SELF_SIGNED_CERT_IN_CHAIN'))).toBe(true);
  });

  it('does not match failures that trusting more CAs cannot fix', () => {
    expect(isUntrustedCertificateError(certFailure('CERT_HAS_EXPIRED'))).toBe(false);
    expect(isUntrustedCertificateError(certFailure('ERR_TLS_CERT_ALTNAME_INVALID'))).toBe(false);
    expect(isUntrustedCertificateError(certFailure('ECONNREFUSED'))).toBe(false);
    expect(isUntrustedCertificateError(new Error('boom'))).toBe(false);
    expect(isUntrustedCertificateError(undefined)).toBe(false);
  });
});

describe('untrustedCertificateMessage', () => {
  it('points at the trust option', () => {
    const { error, hint } = untrustedCertificateMessage();
    expect(error).toMatch(/certificate/i);
    expect(hint).toMatch(/trust-certs|certificates/i);
  });
});

describe('connection test with an untrusted certificate', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('openai-style fetch reports the certificate code, not a generic failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(certFailure('UNABLE_TO_GET_ISSUER_CERT_LOCALLY')));
    const result = await fetchTemplateModels(template, 'key', 'https://models.example.corp/oai/v1');
    expect(result.code).toBe(UNTRUSTED_CERTIFICATE_CODE);
    expect(result.error).not.toMatch(/Could not reach/);
  });

  it('anthropic-style fetch reports the certificate code too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(certFailure('UNABLE_TO_VERIFY_LEAF_SIGNATURE')));
    const result = await fetchAnthropicModels('https://models.example.corp', 'key');
    expect(result.code).toBe(UNTRUSTED_CERTIFICATE_CODE);
  });

  it('keeps the generic message for ordinary network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(certFailure('ECONNREFUSED')));
    const result = await fetchTemplateModels(template, 'key', 'https://models.example.corp/oai/v1');
    expect(result.code).toBeUndefined();
    expect(result.error).toMatch(/Could not reach/);
  });
});

describe('providers trust-certs args', () => {
  it('defaults to status and accepts on/off', () => {
    expect(parseProvidersArgs(['trust-certs'])).toMatchObject({ subcommand: 'trust-certs', trustMode: 'status' });
    expect(parseProvidersArgs(['trust-certs', 'on'])).toMatchObject({ trustMode: 'on' });
    expect(parseProvidersArgs(['trust-certs', 'off'])).toMatchObject({ trustMode: 'off' });
  });

  it('rejects anything else', () => {
    expect(parseProvidersArgs(['trust-certs', 'maybe']).error).toMatch(/Usage/);
    expect(parseProvidersArgs(['trust-certs', 'on', 'x']).error).toMatch(/Usage/);
  });
});
