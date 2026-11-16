import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CHARS_PER_TOKEN,
  IMAGE_CHAR_WEIGHT,
  estimateInputItemChars,
  estimateResponsesBodyChars,
  charsPerToken,
  recordUsageCalibration,
  estimateTokens,
  parseContextOverflow,
  conversationKey,
  noteModelFamily,
  __resetContextBudgetForTests,
} from '../src/codex-context-budget.js';

beforeEach(() => __resetContextBudgetForTests());

describe('estimateResponsesBodyChars', () => {
  it('counts tool definitions', () => {
    const tools = [{ type: 'function', name: 'big', parameters: { description: 'x'.repeat(10_000) } }];
    expect(estimateResponsesBodyChars({ tools, input: [] })).toBeGreaterThanOrEqual(10_000);
  });

  it('counts instructions and input items', () => {
    const body = { instructions: 'abc', input: [{ role: 'user', content: [{ type: 'input_text', text: 'y'.repeat(500) }] }] };
    expect(estimateResponsesBodyChars(body)).toBeGreaterThanOrEqual(503);
  });

  it('weights a nested base64 screenshot in a tool output as one image', () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(3_000_000);
    const item = { type: 'function_call_output', call_id: 'c1', output: [{ type: 'input_text', text: 'shot' }, { type: 'input_image', image_url: big }] };
    const chars = estimateInputItemChars(item);
    expect(chars).toBeLessThan(IMAGE_CHAR_WEIGHT + 500);
    expect(chars).toBeGreaterThanOrEqual(IMAGE_CHAR_WEIGHT);
  });

  it('weights a data URL inside a stringified tool output as one image', () => {
    const item = { type: 'function_call_output', call_id: 'c1', output: `see data:image/jpeg;base64,${'B'.repeat(200_000)} end` };
    expect(estimateInputItemChars(item)).toBeLessThan(IMAGE_CHAR_WEIGHT + 500);
  });
});

describe('calibration', () => {
  it('learns chars per token from real usage', () => {
    recordUsageCalibration('k', 1_950_921, 1_207_698);
    expect(charsPerToken('k')).toBeCloseTo(1.615, 2);
    expect(estimateTokens(1_615_000, 'k')).toBeCloseTo(1_000_000, -4);
  });

  it('defaults to 3 and ignores tiny samples', () => {
    expect(charsPerToken('unknown')).toBe(DEFAULT_CHARS_PER_TOKEN);
    expect(charsPerToken(undefined)).toBe(DEFAULT_CHARS_PER_TOKEN);
    recordUsageCalibration('small', 5_000, 900);
    expect(charsPerToken('small')).toBe(DEFAULT_CHARS_PER_TOKEN);
  });

  it('clamps outliers to [1, 6]', () => {
    recordUsageCalibration('hi', 10_000_000, 1_000);
    expect(charsPerToken('hi')).toBe(6);
    recordUsageCalibration('lo', 2_000, 4_000);
    expect(charsPerToken('lo')).toBe(1);
  });
});

describe('parseContextOverflow', () => {
  it('reads Anthropic token counts', () => {
    expect(parseContextOverflow('prompt is too long: 1207698 tokens > 1000000 maximum')).toEqual({ actualTokens: 1207698, maxTokens: 1000000 });
  });
  it('recognises OpenAI, Gemini, and generic wording', () => {
    expect(parseContextOverflow("This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens")).toEqual({ maxTokens: 128000, actualTokens: 130000 });
    expect(parseContextOverflow('error code context_length_exceeded')).toEqual({});
    expect(parseContextOverflow('The input token count (1100000) exceeds the maximum number of tokens allowed (1048576).')).toEqual({ actualTokens: 1100000, maxTokens: 1048576 });
    expect(parseContextOverflow('input is too long for requested model')).toEqual({});
  });
  it('ignores unrelated errors', () => {
    expect(parseContextOverflow('rate limited')).toBeUndefined();
    expect(parseContextOverflow('image exceeds 10 MB maximum')).toBeUndefined();
  });
});

describe('keys and model family', () => {
  it('falls back when there is no conversation id', () => {
    expect(conversationKey('thread-1', 'fb')).toBe('thread-1');
    expect(conversationKey(undefined, 'fb')).toBe('fb');
  });
  it('returns the previous family', () => {
    expect(noteModelFamily('c', 'openai-native')).toEqual({});
    expect(noteModelFamily('c', 'vertex-anthropic')).toEqual({ previous: 'openai-native' });
    expect(noteModelFamily('c', 'vertex-anthropic')).toEqual({ previous: 'vertex-anthropic' });
  });
});
