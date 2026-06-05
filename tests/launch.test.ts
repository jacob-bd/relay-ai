// tests/launch.test.ts
import { describe, it, expect } from 'vitest';
import { buildClaudeArgs } from '../src/launch.js';

describe('buildClaudeArgs', () => {
  it('builds model args when no extra args are provided', () => {
    expect(buildClaudeArgs('claude-sonnet-4-6', [])).toEqual(['--model', 'claude-sonnet-4-6']);
  });

  it('preserves -c', () => {
    expect(buildClaudeArgs('claude-sonnet-4-6', ['-c'])).toEqual(['--model', 'claude-sonnet-4-6', '-c']);
  });

  it('preserves resume session id', () => {
    expect(buildClaudeArgs('claude-sonnet-4-6', ['--resume', 'abc-123'])).toEqual([
      '--model',
      'claude-sonnet-4-6',
      '--resume',
      'abc-123',
    ]);
  });

  it('preserves prompt text', () => {
    expect(buildClaudeArgs('claude-sonnet-4-6', ['--print', 'hello'])).toEqual([
      '--model',
      'claude-sonnet-4-6',
      '--print',
      'hello',
    ]);
  });
});
