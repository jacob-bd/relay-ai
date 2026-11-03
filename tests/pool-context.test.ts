import { describe, expect, it } from 'vitest';
import { estimatePoolRequestTokens, poolRequestFitsWindow } from '../src/pool/context.js';

describe('production pool context guard', () => {
  it('counts complete JSON including non-ASCII text and tool schemas with the conservative heuristic', () => {
    const request = { instructions: 'Be brief', messages: [{ text: '你好🙌' }], tools: [{ schema: { type: 'object' } }] };
    expect(estimatePoolRequestTokens(request)).toBe(Math.ceil(Buffer.byteLength(JSON.stringify(request), 'utf8') / 2));
    expect(estimatePoolRequestTokens(request)).toBeGreaterThan(estimatePoolRequestTokens({ messages: [] }));
  });
  it('admits the boundary and refuses overflow without rewriting the request', () => {
    const request = { text: 'x'.repeat(10000) };
    const original = JSON.stringify(request);
    const required = estimatePoolRequestTokens(request) + 4096 + 4096;
    expect(poolRequestFitsWindow(request, required, 4096)).toEqual({ fits: true, required });
    expect(poolRequestFitsWindow(request, required - 1, 4096)).toEqual({ fits: false, required });
    expect(JSON.stringify(request)).toBe(original);
  });
  it('reserves ten percent of larger provider windows in addition to output', () => {
    const request = { input: 'hello' };
    expect(poolRequestFitsWindow(request, 128000, 4096).required).toBe(estimatePoolRequestTokens(request) + 12800 + 4096);
  });
  it('refuses unknown or invalid window and output budgets', () => {
    for (const invalid of [0, -1, NaN, Infinity, 1.5]) {
      expect(poolRequestFitsWindow({}, invalid, 4096).fits).toBe(false);
      expect(poolRequestFitsWindow({}, 128000, invalid).fits).toBe(false);
    }
  });
});
