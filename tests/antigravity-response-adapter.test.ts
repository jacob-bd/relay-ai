import { describe, it, expect } from 'vitest';
import { formatCloudCodeChunk, mapFinishReason, type CloudCodeChunkOptions } from '../src/antigravity/response-adapter.js';

describe('antigravity response-adapter', () => {
  it('formats a text chunk into a Cloud Code SSE event', () => {
    const opts: CloudCodeChunkOptions = {
      text: 'hello',
      modelVersion: 'relay-ai__zen__deepseek',
      responseId: 'test-response-123',
    };

    const chunk = formatCloudCodeChunk(opts);
    expect(chunk.response.candidates).toHaveLength(1);
    expect(chunk.response.candidates[0].content.parts[0].text).toBe('hello');
    expect(chunk.response.candidates[0].content.role).toBe('model');
    expect(chunk.response.modelVersion).toBe('relay-ai__zen__deepseek');
    expect(chunk.response.responseId).toBe('test-response-123');
    expect(chunk.traceId).toBe('relay-trace');
  });

  it('formats a thought chunk separately from visible text', () => {
    const opts: CloudCodeChunkOptions = {
      thought: 'hidden plan',
      modelVersion: 'relay-ai__zen__deepseek',
      responseId: 'test-response-123',
    };

    const chunk = formatCloudCodeChunk(opts);
    expect(chunk.response.candidates[0].content.parts).toEqual([
      { text: 'hidden plan', thought: true },
    ]);
  });

  it('formats a finish chunk with stop reason', () => {
    const opts: CloudCodeChunkOptions = {
      modelVersion: 'relay-ai__zen__deepseek',
      responseId: 'test-response-123',
      finishReason: 'STOP',
      usage: {
        promptTokens: 15,
        completionTokens: 30,
      },
    };

    const chunk = formatCloudCodeChunk(opts);
    expect(chunk.response.candidates).toHaveLength(1);
    expect(chunk.response.candidates[0].finishReason).toBe('STOP');
    expect(chunk.response.usageMetadata).toEqual({
      promptTokenCount: 15,
      candidatesTokenCount: 30,
      totalTokenCount: 45,
    });
  });

  it('formats a functionCall chunk', () => {
    const opts: CloudCodeChunkOptions = {
      functionCall: { name: 'readFile', args: { path: 'main.py' } },
      modelVersion: 'relay-ai__zen__deepseek',
      responseId: 'test-response-123',
    };

    const chunk = formatCloudCodeChunk(opts);
    const parts = chunk.response.candidates[0].content.parts;
    expect(parts).toHaveLength(1);
    expect(parts[0].functionCall).toEqual({ name: 'readFile', args: { path: 'main.py' } });
    expect(parts[0].text).toBeUndefined();
  });

  it('formats a chunk with both text and functionCall', () => {
    const opts: CloudCodeChunkOptions = {
      text: 'Let me read that',
      functionCall: { name: 'readFile', args: { path: 'file.txt' } },
      modelVersion: 'relay-ai__zen__deepseek',
      responseId: 'test-response-123',
    };

    const chunk = formatCloudCodeChunk(opts);
    const parts = chunk.response.candidates[0].content.parts;
    expect(parts).toHaveLength(2);
    expect(parts[0].text).toBe('Let me read that');
    expect(parts[1].functionCall).toEqual({ name: 'readFile', args: { path: 'file.txt' } });
  });

  it('emits empty text part when no text or functionCall and no finishReason', () => {
    const opts: CloudCodeChunkOptions = {
      modelVersion: 'relay-ai__zen__deepseek',
      responseId: 'test-response-123',
    };

    const chunk = formatCloudCodeChunk(opts);
    const parts = chunk.response.candidates[0].content.parts;
    expect(parts).toHaveLength(1);
    expect(parts[0].text).toBe('');
  });

  it('includes empty content when only finishReason is set (no text or functionCall)', () => {
    const opts: CloudCodeChunkOptions = {
      modelVersion: 'relay-ai__zen__deepseek',
      responseId: 'test-response-123',
      finishReason: 'STOP',
    };

    const chunk = formatCloudCodeChunk(opts);
    expect(chunk.response.candidates[0].finishReason).toBe('STOP');
    expect(chunk.response.candidates[0].content).toEqual({ role: 'model', parts: [] });
  });
});

describe('mapFinishReason', () => {
  it('maps stop to STOP', () => {
    expect(mapFinishReason('stop')).toBe('STOP');
  });

  it('maps tool-calls to STOP', () => {
    expect(mapFinishReason('tool-calls')).toBe('STOP');
  });

  it('maps length to MAX_TOKENS', () => {
    expect(mapFinishReason('length')).toBe('MAX_TOKENS');
  });

  it('maps content-filter to SAFETY', () => {
    expect(mapFinishReason('content-filter')).toBe('SAFETY');
  });

  it('maps unknown reasons to OTHER', () => {
    expect(mapFinishReason('unknown')).toBe('OTHER');
    expect(mapFinishReason('')).toBe('OTHER');
  });
});
