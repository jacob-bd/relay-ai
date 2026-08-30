import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendCodexRouteAudit,
  prepareCodexRouteAuditLog,
  sanitizeCodexRouteAuditEvent,
} from '../src/codex/route-audit.js';

describe('Codex route audit', () => {
  it('writes only bounded routing metadata to a private JSONL receipt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-route-audit-'));
    try {
      const path = prepareCodexRouteAuditLog(join(dir, 'audit.jsonl'));
      appendCodexRouteAudit(path, {
        transport: 'ws',
        requestedModel: `antigravity__gemini-3.1-pro-high\nforged=${'x'.repeat(500)}`,
        dispatch: 'relay',
        phase: 'complete',
        provider: 'antigravity',
        routeModel: 'antigravity__gemini-3.1-pro-high',
        upstreamModel: 'gemini-3.1-pro-high',
        outcome: 'ok',
        status: 'response.completed',
      });

      const text = readFileSync(path, 'utf8');
      const event = JSON.parse(text) as Record<string, unknown>;
      expect(event).toMatchObject({
        transport: 'ws', dispatch: 'relay', phase: 'complete', provider: 'antigravity',
        upstreamModel: 'gemini-3.1-pro-high', outcome: 'ok', status: 'response.completed',
      });
      expect(String(event.requestedModel)).not.toContain('\n');
      expect(String(event.requestedModel).length).toBeLessThanOrEqual(300);
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(text).not.toContain('authorization');
      expect(text).not.toContain('input');
      expect(text).not.toContain('tools');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('omits absent optional fields', () => {
    const event = sanitizeCodexRouteAuditEvent({
      transport: 'http', requestedModel: 'unknown', dispatch: 'unknown', phase: 'complete', outcome: 'error', status: 404,
    });
    expect(event).not.toHaveProperty('provider');
    expect(event).not.toHaveProperty('routeModel');
    expect(event).not.toHaveProperty('upstreamModel');
  });
});
