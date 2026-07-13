import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getLatestMessagePreview,
  redactTraceLine,
  redactTraceLog,
  writeInferenceRequestLog,
  writeInferenceResponseLifecycleLog,
  writeInferenceResponseErrorLog,
} from '../src/trace-log.js';

describe('trace log redaction', () => {
  it('redacts bearer tokens', () => {
    expect(redactTraceLine('Authorization: Bearer sk-ant-api03-secret123')).toContain('[REDACTED]');
    expect(redactTraceLine('Authorization: Bearer sk-ant-api03-secret123')).not.toContain('secret123');
  });

  it('redacts sk- prefixed keys', () => {
    expect(redactTraceLine('key=sk-abc1234567890')).toBe('key=sk-[REDACTED]');
  });

  it('redacts full log content', () => {
    const log = redactTraceLog('line1\nBearer sk-test123456789012345678901234\nline3');
    expect(log).not.toContain('sk-test123456789012345678901234');
  });
});

describe('inference request log', () => {
  it('writes only structured routing metadata', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-ai-inference-log-'));
    const path = join(dir, 'requests.jsonl');
    try {
      writeInferenceRequestLog(path, {
        modelId: 'relay:openai:gpt-test[1m]',
        effort: 'high',
        provider: 'openai',
        route: 'translated',
      });
      const entry = JSON.parse(readFileSync(path, 'utf8').trim());
      expect(entry).toMatchObject({
        modelId: 'relay:openai:gpt-test[1m]',
        effort: 'high',
        provider: 'openai',
        route: 'translated',
      });
      expect(entry.timestamp).toEqual(expect.any(String));
      expect(Object.keys(entry).sort()).toEqual(['effort', 'modelId', 'provider', 'route', 'timestamp']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adds only the latest message text when request previews are enabled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-ai-inference-preview-'));
    const path = join(dir, 'requests.jsonl');
    const previous = process.env['RELAY_AI_LOG_REQUEST_PREVIEW'];
    const requestPreview = getLatestMessagePreview([
      { role: 'user', content: 'older prompt' },
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', data: 'private-image-data' } },
          { type: 'text', text: 'identify this request\nwithout logging media' },
          { type: 'tool_result', content: 'private tool result' },
        ],
      },
    ]);

    try {
      delete process.env['RELAY_AI_LOG_REQUEST_PREVIEW'];
      writeInferenceRequestLog(path, {
        modelId: 'claude-sonnet-4-6',
        provider: 'anthropic',
        route: 'passthrough',
        requestPreview,
      });
      process.env['RELAY_AI_LOG_REQUEST_PREVIEW'] = '1';
      writeInferenceRequestLog(path, {
        modelId: 'claude-sonnet-4-6',
        provider: 'anthropic',
        route: 'passthrough',
        requestPreview,
      });

      const raw = readFileSync(path, 'utf8');
      const entries = raw.trim().split('\n').map(line => JSON.parse(line));
      expect(entries[0]).not.toHaveProperty('requestPreview');
      expect(entries[1]).toMatchObject({
        requestPreview: 'user: identify this request without logging media',
      });
      expect(raw).not.toContain('older prompt');
      expect(raw).not.toContain('private-image-data');
      expect(raw).not.toContain('private tool result');
      expect(getLatestMessagePreview([
        { role: 'user', content: [{ type: 'tool_result', content: 'private tool result' }] },
      ])).toBe('user: [tool_result]');
      expect(getLatestMessagePreview(
        [{ role: 'user', content: [{ type: 'tool_result', content: 'private tool result' }] }],
        [{ type: 'text', text: 'Generate a concise conversation title for Claude Code.' }],
      )).toBe('user: [tool_result] | system: Generate a concise conversation title for Claude Code.');
      expect(getLatestMessagePreview([
        { role: 'system', content: 'Classify this request for an OpenAI-compatible client.' },
        { role: 'user', content: [{ type: 'tool_result', content: 'private tool result' }] },
      ])).toBe('user: [tool_result] | system: Classify this request for an OpenAI-compatible client.');
    } finally {
      if (previous === undefined) delete process.env['RELAY_AI_LOG_REQUEST_PREVIEW'];
      else process.env['RELAY_AI_LOG_REQUEST_PREVIEW'] = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('logs upstream status always and redacted error content only when previews are enabled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-ai-inference-error-'));
    const path = join(dir, 'requests.jsonl');
    const previous = process.env['RELAY_AI_LOG_REQUEST_PREVIEW'];
    try {
      delete process.env['RELAY_AI_LOG_REQUEST_PREVIEW'];
      writeInferenceResponseErrorLog(path, {
        modelId: 'relay:openai:gpt-test',
        provider: 'openai',
        route: 'translated',
        statusCode: 429,
        errorContent: 'rate limited for Bearer sk-secret123456789',
        isRetryable: true,
        attemptCount: 3,
      });
      process.env['RELAY_AI_LOG_REQUEST_PREVIEW'] = '1';
      writeInferenceResponseErrorLog(path, {
        modelId: 'relay:openai:gpt-test',
        provider: 'openai',
        route: 'translated',
        statusCode: 429,
        errorContent: 'rate limited for Bearer sk-secret123456789',
        isRetryable: true,
        attemptCount: 3,
      });
      writeInferenceResponseErrorLog(path, {
        modelId: 'claude-haiku-4-5',
        provider: 'anthropic',
        route: 'passthrough',
        statusCode: 529,
        errorContent: 'x'.repeat(3_000),
      });

      const entries = readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      expect(entries[0]).toMatchObject({
        event: 'upstream_error',
        statusCode: 429,
        isRetryable: true,
        attemptCount: 3,
      });
      expect(entries[0]).not.toHaveProperty('errorContent');
      expect(entries[1].errorContent).toContain('rate limited');
      expect(entries[1].errorContent).toContain('[REDACTED]');
      expect(entries[1].errorContent).not.toContain('secret123456789');
      expect(entries[2].errorContent).toHaveLength(2_000);
      expect(entries[2].errorContent).toMatch(/ \[truncated\]$/);
    } finally {
      if (previous === undefined) delete process.env['RELAY_AI_LOG_REQUEST_PREVIEW'];
      else process.env['RELAY_AI_LOG_REQUEST_PREVIEW'] = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes correlated response lifecycle metadata without response content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-ai-inference-lifecycle-'));
    const path = join(dir, 'requests.jsonl');
    try {
      writeInferenceResponseLifecycleLog(path, {
        event: 'translation_progress',
        requestId: 'req-123',
        modelId: 'relay:openai:gpt-test',
        provider: 'openai',
        route: 'translated',
        phase: 'translating',
        durationMs: 30_000.4,
        sdkParts: 42,
        sdkIdleMs: 125.7,
        translatedBytes: 4096,
        translatedChunks: 18,
        outputIdleMs: 100.2,
        lastPartType: 'text-delta',
      });

      const entry = JSON.parse(readFileSync(path, 'utf8').trim());
      expect(entry).toMatchObject({
        event: 'translation_progress',
        requestId: 'req-123',
        modelId: 'relay:openai:gpt-test',
        provider: 'openai',
        route: 'translated',
        phase: 'translating',
        durationMs: 30_000,
        sdkParts: 42,
        sdkIdleMs: 126,
        translatedBytes: 4096,
        translatedChunks: 18,
        outputIdleMs: 100,
        lastPartType: 'text-delta',
      });
      expect(entry).not.toHaveProperty('responseContent');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
