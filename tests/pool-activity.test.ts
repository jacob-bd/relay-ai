import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { poolErrorDetail } from '../src/pool/diagnostic.js';
import { formatPoolActivityLine, describePoolFailure, poolRouteMember, readPoolActivity, recordPoolActivity } from '../src/pool/activity.js';

describe('pool activity log', () => {
  beforeEach(() => { process.env['RELAY_AI_HOME'] = mkdtempSync(join(tmpdir(), 'relay-activity-')); });

  it('records served and failed attempts newest-first and caps the file', () => {
    recordPoolActivity({ target: 'claude', event: 'failed', providerId: 'kilo', modelId: 'a', reason: 'rate limit (429)', ms: 1200 });
    recordPoolActivity({ target: 'claude', event: 'served', providerId: 'nvidia', modelId: 'b', ms: 3400 });
    const entries = readPoolActivity(10);
    expect(entries.map(e => e.event)).toEqual(['served', 'failed']);
    expect(entries[1]).toMatchObject({ providerId: 'kilo', reason: 'rate limit (429)' });
    for (let i = 0; i < 4000; i++) recordPoolActivity({ target: 'claude', event: 'served', providerId: 'p', modelId: 'm' + i });
    expect(readPoolActivity(1000).length).toBeLessThanOrEqual(1000);
    expect(readPoolActivity(1)[0]!.modelId).toBe('m3999');
  });

  it('parses route ids and never returns raw upstream text', () => {
    expect(poolRouteMember(JSON.stringify(['kilo', 'rev', 'reflection/beam-free']))).toEqual({ providerId: 'kilo', modelId: 'reflection/beam-free' });
    expect(poolRouteMember('nope')).toBeUndefined();
    expect(describePoolFailure({ statusCode: 429, message: 'secret-key-abc rate limited' })).toBe('rate limit (429)');
    expect(describePoolFailure(new Error('Bearer sk-12345678 exploded'))).toBe('failed');
    expect(describePoolFailure(new Error('Pool route entered cooldown'))).toBe('skipped: cooling down after a recent failure');
  });
});

describe('following the log', () => {
  beforeEach(() => { process.env['RELAY_AI_HOME'] = mkdtempSync(join(tmpdir(), 'relay-activity-follow-')); });
  it('delivers new entries as they are appended and ignores older ones', async () => {
    const { followPoolActivity } = await import('../src/pool/activity.js');
    recordPoolActivity({ target: 'claude', event: 'served', providerId: 'old', modelId: 'old' });
    const seen: string[] = [];
    const controller = new AbortController();
    const done = followPoolActivity(e => seen.push(e.modelId), controller.signal, 20);
    await new Promise(r => setTimeout(r, 60));
    recordPoolActivity({ target: 'claude', event: 'failed', providerId: 'kilo', modelId: 'one', reason: 'timeout' });
    recordPoolActivity({ target: 'claude', event: 'served', providerId: 'nvidia', modelId: 'two' });
    await new Promise(r => setTimeout(r, 120));
    controller.abort();
    await done;
    expect(seen).toEqual(['one', 'two']);
  });
});

describe('backend error detail', () => {
  it('keeps what the provider said, redacts credentials and caps the length', () => {
    const error = Object.assign(new Error('Too Many Requests'), {
      statusCode: 429,
      responseBody: JSON.stringify({ error: { message: 'Rate limit exceeded: free-models-per-day. Authorization: Bearer sk-live-abcdef123456 retry later' } }),
    });
    const detail = poolErrorDetail(error)!;
    expect(detail).toContain('Rate limit exceeded: free-models-per-day');
    expect(detail).toContain('HTTP 429');
    expect(detail).not.toContain('sk-live');
    expect(poolErrorDetail(new Error('x'.repeat(400)))!.length).toBeLessThanOrEqual(200);
  });

  it('shows the detail under the line in pool log output', () => {
    const line = formatPoolActivityLine({ at: '2026-11-04T20:00:00Z', target: 'claude', event: 'failed', providerId: 'kilo', modelId: 'm',
      reason: 'rate limit (429)', detail: 'free-models-per-day exceeded (HTTP 429)', ms: 400 });
    expect(line).toContain('rate limit (429)');
    expect(line).toContain('↳ free-models-per-day exceeded (HTTP 429)');
  });
});
