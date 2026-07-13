import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  redactTraceLine,
  redactTraceLog,
  writeInferenceRequestLog,
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
});
