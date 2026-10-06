import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  getAntigravityDebugLogPath,
  localIsoTimestamp,
  localTimestamp,
  makeTraceLogger,
  redactTraceLine,
  redactTraceLog,
} from '../src/trace-log.js';

describe('timestamps', () => {
  it('formats localTimestamp as YYYY-MM-DD HH:MM:SS wall-clock', () => {
    expect(localTimestamp()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('formats localIsoTimestamp as ISO-8601 with the local UTC offset', () => {
    expect(localIsoTimestamp()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
  });

  it('localIsoTimestamp round-trips through Date.parse and carries the local wall-clock time', () => {
    const utc = new Date('2026-10-05T14:23:11.204Z');
    const parsed = new Date(Date.parse(localIsoTimestamp(utc)));
    expect(parsed.getTime()).toBe(utc.getTime());
    // Same wall-clock reading as localTimestamp() would print for that instant.
    const local = new Date(utc.getTime() - utc.getTimezoneOffset() * 60_000);
    expect(localIsoTimestamp(utc).slice(11, 19)).toBe(local.toISOString().slice(11, 19));
  });
});

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

describe('Antigravity trace logging', () => {
  it('creates each launch mode trace under the Relay logs directory', () => {
    const relayHome = mkdtempSync(join(tmpdir(), 'relay-ai-trace-'));
    const previousHome = process.env.RELAY_AI_HOME;
    process.env.RELAY_AI_HOME = relayHome;

    try {
      expect(getAntigravityDebugLogPath('agy')).toBe(
        join(relayHome, 'logs', 'antigravity-agy-debug.log'),
      );
      expect(getAntigravityDebugLogPath('antigravity')).toBe(
        join(relayHome, 'logs', 'antigravity-app-debug.log'),
      );
      const path = getAntigravityDebugLogPath('ide');
      expect(path).toBe(join(relayHome, 'logs', 'antigravity-ide-debug.log'));

      makeTraceLogger(path)('[gateway] request received');
      expect(readFileSync(path, 'utf8')).toContain('[gateway] request received');
    } finally {
      if (previousHome === undefined) {
        delete process.env.RELAY_AI_HOME;
      } else {
        process.env.RELAY_AI_HOME = previousHome;
      }
      rmSync(relayHome, { recursive: true, force: true });
    }
  });
});
