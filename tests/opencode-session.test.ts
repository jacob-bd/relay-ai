import { describe, expect, it } from 'vitest';
import {
  MAX_OPENCODE_SESSION_LENGTH,
  RELAY_USER_AGENT,
  extractConversationId,
  isOpenCodeGoEndpoint,
  mergeHeaders,
  openCodeGoHeaders,
  sanitizeSessionId,
} from '../src/opencode-session.js';

describe('OpenCode Go session helpers', () => {
  it('accepts bounded opaque session identifiers and rejects unsafe values', () => {
    expect(sanitizeSessionId('  conversation-1  ')).toBe('conversation-1');
    expect(sanitizeSessionId('x'.repeat(MAX_OPENCODE_SESSION_LENGTH))).toHaveLength(MAX_OPENCODE_SESSION_LENGTH);
    expect(sanitizeSessionId('x'.repeat(MAX_OPENCODE_SESSION_LENGTH + 1))).toBeUndefined();
    expect(sanitizeSessionId('bad\nvalue')).toBeUndefined();
    expect(sanitizeSessionId('   ')).toBeUndefined();
  });

  it('prefers an explicit OpenCode header, then native client IDs', () => {
    expect(extractConversationId(
      {
        'x-opencode-session': 'opencode-1',
        'x-claude-code-session-id': 'claude-1',
      },
      {},
    )).toBe('opencode-1');
    expect(extractConversationId(
      { 'x-claude-code-session-id': 'claude-1' },
      {},
    )).toBe('claude-1');
    expect(extractConversationId(
      { 'session-id': 'codex-1' },
      {},
    )).toBe('codex-1');
  });

  it('reads Claude metadata session IDs when no header exists', () => {
    expect(extractConversationId(undefined, {
      metadata: { user_id: JSON.stringify({ session_id: 'session_456' }) },
    })).toBe('session_456');
  });

  it('detects OpenCode Go by provider identity or endpoint path', () => {
    expect(isOpenCodeGoEndpoint('go', undefined)).toBe(true);
    expect(isOpenCodeGoEndpoint('custom-openai', 'https://opencode.ai/zen/go/v1/chat/completions')).toBe(true);
    expect(isOpenCodeGoEndpoint('zen', 'https://opencode.ai/zen/v1')).toBe(false);
    expect(isOpenCodeGoEndpoint('other', 'https://example.test/go/v1')).toBe(false);
  });

  it('fabricates a distinct per-request session for session-less Go requests, and skips it when opted out', () => {
    // A Go request with no client session gets a generated x-opencode-session so
    // Console Go stops rejecting it (e.g. Claude Desktop's availability probe).
    const first = openCodeGoHeaders('go', undefined, undefined, undefined);
    expect(first?.['x-opencode-session']).toMatch(/^relay-/);
    expect(first?.['User-Agent']).toBe(RELAY_USER_AGENT);

    // Two session-less requests get DISTINCT ids — a per-request id never blends
    // two conversations the way a shared per-process id would.
    const second = openCodeGoHeaders('go', undefined, undefined, undefined);
    expect(second?.['x-opencode-session']).not.toBe(first?.['x-opencode-session']);

    // An explicit client session always wins over the fallback.
    expect(openCodeGoHeaders('go', undefined, 'conversation-1', undefined)?.['x-opencode-session'])
      .toBe('conversation-1');

    // Embedded Core opts out: the returned model may be reused across
    // conversations, so it must never bake in a fabricated session.
    expect(openCodeGoHeaders('go', undefined, undefined, undefined, { generateFallbackSession: false }))
      .toEqual({ 'User-Agent': RELAY_USER_AGENT });

    // Non-Go endpoints are untouched.
    expect(openCodeGoHeaders('zen', 'https://opencode.ai/zen/v1', undefined, undefined)).toBeUndefined();
  });

  it('merges selected request headers case-insensitively and adds a truthful user agent', () => {
    expect(mergeHeaders(
      { 'User-Agent': 'client/1', 'X-Other': 'keep' },
      { 'user-agent': RELAY_USER_AGENT, 'x-opencode-session': 'conversation-1' },
    )).toEqual({
      'X-Other': 'keep',
      'user-agent': RELAY_USER_AGENT,
      'x-opencode-session': 'conversation-1',
    });
  });
});
