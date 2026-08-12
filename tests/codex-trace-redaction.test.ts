import { describe, expect, it } from 'vitest';
import { redactCodexTraceValue } from '../src/codex/trace-redaction.js';

describe('Codex trace redaction', () => {
  it('redacts credentials, ciphertext, and collaboration plaintext while preserving metadata', () => {
    const value = redactCodexTraceValue({
      model: 'gpt-5.5',
      authorization: 'Bearer secret',
      apiKey: 'relay-secret',
      input: [{ type: 'agent_message', content: [{ type: 'encrypted_content', encrypted_content: 'gAAAAAsecret' }, { type: 'input_text', text: 'Payload: private task' }] }],
      toolNames: ['read_file'],
    }) as Record<string, unknown>;
    expect(value.model).toBe('gpt-5.5');
    expect(value.toolNames).toEqual(['read_file']);
    expect(value.authorization).toBe('[REDACTED]');
    expect(value.apiKey).toBe('[REDACTED]');
    expect(JSON.stringify(value)).not.toContain('secret');
    expect(JSON.stringify(value)).not.toContain('private task');
  });
});
