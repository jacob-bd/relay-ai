import { describe, it, expect } from 'vitest';
import {
  normalizeResponseHeaders,
  decodeBody,
  encodeBody,
} from '../src/antigravity/cloud-code-proxy.js';
import zlib from 'node:zlib';

describe('cloud-code-proxy body utilities', () => {
  it('decodes gzip bodies', () => {
    const original = Buffer.from('{"models":{}}', 'utf8');
    const encoded = zlib.gzipSync(original);
    expect(decodeBody(encoded, 'gzip').toString('utf8')).toBe('{"models":{}}');
  });

  it('decodes brotli bodies', () => {
    const original = Buffer.from('{"models":{}}', 'utf8');
    const encoded = zlib.brotliCompressSync(original);
    expect(decodeBody(encoded, 'br').toString('utf8')).toBe('{"models":{}}');
  });

  it('decodes deflate bodies', () => {
    const original = Buffer.from('{"models":{}}', 'utf8');
    const encoded = zlib.deflateSync(original);
    expect(decodeBody(encoded, 'deflate').toString('utf8')).toBe('{"models":{}}');
  });

  it('passes through identity (no encoding)', () => {
    const original = Buffer.from('{"models":{}}', 'utf8');
    expect(decodeBody(original, '').toString('utf8')).toBe('{"models":{}}');
    expect(decodeBody(original, 'identity').toString('utf8')).toBe('{"models":{}}');
  });

  it('re-encodes gzip bodies', () => {
    const original = Buffer.from('{"models":{}}', 'utf8');
    const encoded = encodeBody(original, 'gzip');
    expect(decodeBody(encoded, 'gzip').toString('utf8')).toBe('{"models":{}}');
  });

  it('re-encodes brotli bodies', () => {
    const original = Buffer.from('{"models":{}}', 'utf8');
    const encoded = encodeBody(original, 'br');
    expect(decodeBody(encoded, 'br').toString('utf8')).toBe('{"models":{}}');
  });

  it('re-encodes deflate bodies', () => {
    const original = Buffer.from('{"models":{}}', 'utf8');
    const encoded = encodeBody(original, 'deflate');
    expect(decodeBody(encoded, 'deflate').toString('utf8')).toBe('{"models":{}}');
  });
});

describe('cloud-code-proxy header normalization', () => {
  it('sets Content-Length and removes Transfer-Encoding', () => {
    const headers = {
      'content-type': 'application/json',
      'transfer-encoding': 'chunked',
      'content-length': '1234',
    };
    const result = normalizeResponseHeaders(headers, Buffer.from('hello world'));
    expect(result['content-length']).toBe('11');
    expect(result['transfer-encoding']).toBeUndefined();
  });

  it('removes stale ETag after modification', () => {
    const headers = {
      'content-type': 'application/json',
      etag: '"abc123"',
    };
    const result = normalizeResponseHeaders(headers, Buffer.from('modified'));
    expect(result.etag).toBeUndefined();
  });

  it('removes content-encoding when body is re-encoded as identity', () => {
    const headers = {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
    };
    const result = normalizeResponseHeaders(headers, Buffer.from('plain'), true);
    expect(result['content-encoding']).toBeUndefined();
  });

  it('preserves content-type and other headers', () => {
    const headers = {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'x-custom': 'value',
    };
    const result = normalizeResponseHeaders(headers, Buffer.from('data'));
    expect(result['content-type']).toBe('text/event-stream');
    expect(result['cache-control']).toBe('no-cache');
    expect(result['x-custom']).toBe('value');
  });

  it('regression: Content-Length + Transfer-Encoding must never coexist', () => {
    // This is the exact bug found during feasibility testing:
    // "Parse Error: Content-Length can't be present with Transfer-Encoding"
    const headers = {
      'content-type': 'application/json',
      'content-length': '999',
      'transfer-encoding': 'chunked',
    };
    const result = normalizeResponseHeaders(headers, Buffer.from('output'));
    const hasContentLength = 'content-length' in result;
    const hasTransferEncoding = 'transfer-encoding' in result;
    expect(hasContentLength && hasTransferEncoding).toBe(false);
    expect(hasContentLength).toBe(true);
  });
});
