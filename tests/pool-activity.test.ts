import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { poolErrorDetail } from '../src/pool/diagnostic.js';
import { formatPoolActivityLine, describePoolFailure, poolRouteMember, readPoolActivity, recordPoolActivity, clearPoolActivity } from '../src/pool/activity.js';

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

  it('clears pool activity on demand', () => {
    recordPoolActivity({ target: 'claude', event: 'served', providerId: 'kilo', modelId: 'a' });
    expect(readPoolActivity(10).length).toBe(1);
    clearPoolActivity();
    expect(readPoolActivity(10)).toEqual([]);
  });

  it('parses route ids and never returns raw upstream text', () => {
    expect(poolRouteMember(JSON.stringify(['kilo', 'rev', 'reflection/beam-free']))).toEqual({ providerId: 'kilo', modelId: 'reflection/beam-free' });
    expect(poolRouteMember('nope')).toBeUndefined();
    expect(describePoolFailure({ statusCode: 429, message: 'secret-key-abc rate limited' })).toBe('rate limit (429)');
    expect(describePoolFailure(new Error('Bearer sk-12345678 exploded'))).toBe('failed');
    expect(describePoolFailure(new Error('Pool route entered cooldown'))).toBe('skipped: recovering from an earlier failure');
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

describe('one line per request', () => {
  it('groups overlapping requests by id so a skipped member and an answer are not confused', async () => {
    const { groupPoolActivity, formatPoolRequestLines } = await import('../src/pool/activity.js');
    const at = (n: number) => new Date(1_800_000_000_000 + n * 1000).toISOString();
    const base = { target: 'claude' as const };
    // Request A answers on nvidia; request B (overlapping) finds nvidia busy and is answered by go.
    const groups = groupPoolActivity([
      { ...base, at: at(0), event: 'failed', requestId: 'A', providerId: 'kilo', modelId: 'k', reason: 'simulated failure (test switch)' },
      { ...base, at: at(1), event: 'failed', requestId: 'B', providerId: 'nvidia', modelId: 'n', reason: 'skipped: recovering from an earlier failure' },
      { ...base, at: at(2), event: 'served', requestId: 'B', providerId: 'go', modelId: 'g', ms: 2800 },
      { ...base, at: at(3), event: 'served', requestId: 'A', providerId: 'nvidia', modelId: 'n', ms: 8400 },
      { ...base, at: at(4), event: 'failed', requestId: 'C', providerId: 'kilo', modelId: 'k', reason: 'rate limit (429)' },
      { ...base, at: at(5), event: 'gave-up', requestId: 'C', providerId: 'pool', modelId: 'none' },
    ]);
    expect(groups.map(g => g.outcome)).toEqual(['answered', 'answered', 'failed']);
    expect(groups[0]).toMatchObject({ answeredBy: { providerId: 'go' }, tried: [{ providerId: 'nvidia', reason: 'skipped: recovering from an earlier failure' }] });
    expect(groups[1]).toMatchObject({ answeredBy: { providerId: 'nvidia' }, tried: [{ providerId: 'kilo' }] });
    expect(formatPoolRequestLines(groups[2]!)).toContain('nobody answered');
    expect(formatPoolRequestLines(groups[0]!)).toContain('✓ go/g answered');
    expect(formatPoolRequestLines(groups[0]!)).toContain('– nvidia/n skipped: recovering from an earlier failure');
  });
});

describe('event-only view (default)', () => {
  const answered = (n: number, who: string, tried: Array<{ providerId: string; modelId: string; reason?: string }> = []) => ({
    at: new Date(1_800_000_000_000 + n * 1000).toISOString(), outcome: 'answered' as const, ms: 3000,
    answeredBy: { providerId: who, modelId: 'm' }, tried,
  });

  it('shows the current model and a line only for a switch, a failover or a failure', async () => {
    const { summarizePoolEvents, formatPoolCurrentLine, formatPoolEventLines } = await import('../src/pool/activity.js');
    const state = summarizePoolEvents([
      answered(0, 'kilo'), answered(1, 'kilo'), answered(2, 'kilo'), answered(3, 'kilo'),          // smooth: no lines
      answered(4, 'nvidia', [{ providerId: 'kilo', modelId: 'm', reason: 'rate limit (429)' }]),   // failover
      answered(5, 'nvidia'), answered(6, 'nvidia'),                                               // smooth
      { at: new Date(1_800_000_007_000).toISOString(), outcome: 'failed' as const, tried: [{ providerId: 'nvidia', modelId: 'm', reason: 'timeout' }] },
    ]);
    expect(state.events.map(e => e.kind)).toEqual(['now-answering', 'failover', 'failed']);
    expect(state.events[1]!.quietBefore).toBe(3);
    expect(formatPoolEventLines(state.events[1]!)).toContain('✓ nvidia/m answered');
    expect(formatPoolEventLines(state.events[1]!)).toContain('✗ kilo/m failed: rate limit (429)');
    expect(formatPoolEventLines(state.events[1]!)).toContain('switched from kilo/m');
    expect(formatPoolEventLines(state.events[1]!)).toContain('3 earlier requests answered normally');
    expect(state.current).toEqual({ providerId: 'nvidia', modelId: 'm' });
    // CI terminals report colour support, so compare without the escape codes.
    expect(formatPoolCurrentLine(state).replace(/\u001b\[[0-9;]*m/g, '')).toContain('Current model: nvidia/m');
  });

  it('reports a plain switch of the answering model without any failure', async () => {
    const { summarizePoolEvents } = await import('../src/pool/activity.js');
    const state = summarizePoolEvents([answered(0, 'kilo'), answered(1, 'kilo'), answered(2, 'go')]);
    expect(state.events.map(e => e.kind)).toEqual(['now-answering', 'switched']);
  });
});
