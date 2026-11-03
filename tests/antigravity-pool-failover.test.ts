import { describe, expect, it } from 'vitest';
import { createStreamCapture, isMeaningfulCloudCodeChunk } from '../src/antigravity/pool-failover.js';
const chunk = 'data: ' + JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Mocked ' }] } }] }) + String.fromCharCode(10, 10);
describe('cloud code pool chunks', () => {
  it('treats text, thinking and tool calls as meaningful', () => {
    expect(isMeaningfulCloudCodeChunk(chunk)).toBe(true);
    expect(isMeaningfulCloudCodeChunk('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: '' }] } }] }))).toBe(false);
    expect(isMeaningfulCloudCodeChunk('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: 'x', args: {} } }] } }] }))).toBe(true);
    expect(isMeaningfulCloudCodeChunk('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hmm', thought: true }] } }] }))).toBe(true);
  });
  it('caps preamble-only capture before committing to the client', () => {
    const real = { headersSent: false, destroyed: false, writableEnded: false, write: () => true, writeHead: () => real, end: () => real } as never;
    const capture = createStreamCapture(real, 8);
    const preamble = 'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: '' }] } }] });
    expect(() => capture.response.write(preamble)).toThrow('Pool capture byte limit exceeded');
    expect(capture.committed).toBe(false);
  });
});
