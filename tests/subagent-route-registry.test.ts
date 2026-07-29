import { describe, expect, it } from 'vitest';
import {
  SubagentRouteRegistry,
  appendSubagentRouteMarker,
  extractClaudeSessionId,
} from '../src/subagent-route-registry.js';

function childBody(prompt: string, sessionId = 'session-a') {
  return {
    model: 'claude-sonnet-5',
    metadata: {
      user_id: JSON.stringify({ device_id: 'device', session_id: sessionId }),
    },
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: '<system-reminder>context</system-reminder>' },
        { type: 'text', text: prompt },
      ],
    }],
  };
}

const childHeaders = {
  'x-claude-code-session-id': 'session-a',
  'x-claude-code-agent-id': 'agent-1',
};

describe('extractClaudeSessionId', () => {
  it('prefers the Claude session header', () => {
    expect(extractClaudeSessionId(
      { 'x-claude-code-session-id': 'header-session' },
      childBody('prompt', 'metadata-session'),
    )).toBe('header-session');
  });

  it('falls back to metadata.user_id JSON', () => {
    expect(extractClaudeSessionId({}, childBody('prompt', 'metadata-session')))
      .toBe('metadata-session');
  });
});

describe('SubagentRouteRegistry', () => {
  it('consumes a session-bound marker from an agent child and strips it', () => {
    const registry = new SubagentRouteRegistry();
    const token = registry.register('session-a', 'anthropic-relay__grok-4');
    const markedPrompt = appendSubagentRouteMarker('Inspect the router.', token);

    const resolved = registry.consume(childHeaders, childBody(markedPrompt));

    expect(resolved?.modelId).toBe('anthropic-relay__grok-4');
    expect((resolved?.body.messages[0].content[1] as any).text).toBe('Inspect the router.');
    expect(registry.consume(childHeaders, childBody(markedPrompt))).toBeUndefined();
  });

  it('does not consume a marker without an agent id or for another session', () => {
    const registry = new SubagentRouteRegistry();
    const token = registry.register('session-a', 'anthropic-relay__qwen-3');
    const body = childBody(appendSubagentRouteMarker('Inspect.', token));

    expect(registry.consume(
      { 'x-claude-code-session-id': 'session-a' },
      body,
    )).toBeUndefined();
    expect(registry.consume(
      {
        'x-claude-code-session-id': 'session-b',
        'x-claude-code-agent-id': 'agent-2',
      },
      body,
    )).toBeUndefined();
  });

  it('resolves concurrent selections independently even with identical prompts', () => {
    const registry = new SubagentRouteRegistry();
    const qwenToken = registry.register('session-a', 'anthropic-relay__qwen-3');
    const grokToken = registry.register('session-a', 'anthropic-relay__grok-4');
    const prompt = 'Run the same review.';

    const grok = registry.consume(
      { ...childHeaders, 'x-claude-code-agent-id': 'agent-grok' },
      childBody(appendSubagentRouteMarker(prompt, grokToken)),
    );
    const qwen = registry.consume(
      { ...childHeaders, 'x-claude-code-agent-id': 'agent-qwen' },
      childBody(appendSubagentRouteMarker(prompt, qwenToken)),
    );

    expect(grok?.modelId).toBe('anthropic-relay__grok-4');
    expect(qwen?.modelId).toBe('anthropic-relay__qwen-3');
  });

  it('expires old entries and bounds retained registrations', () => {
    let now = 1_000;
    const registry = new SubagentRouteRegistry({
      ttlMs: 100,
      maxEntries: 2,
      now: () => now,
    });
    const expired = registry.register('session-a', 'model-expired');
    now += 101;
    expect(registry.consume(
      childHeaders,
      childBody(appendSubagentRouteMarker('old', expired)),
    )).toBeUndefined();

    const evicted = registry.register('session-a', 'model-1');
    const retainedA = registry.register('session-a', 'model-2');
    const retainedB = registry.register('session-a', 'model-3');
    expect(registry.consume(
      childHeaders,
      childBody(appendSubagentRouteMarker('evicted', evicted)),
    )).toBeUndefined();
    expect(registry.consume(
      childHeaders,
      childBody(appendSubagentRouteMarker('a', retainedA)),
    )?.modelId).toBe('model-2');
    expect(registry.consume(
      childHeaders,
      childBody(appendSubagentRouteMarker('b', retainedB)),
    )?.modelId).toBe('model-3');
  });
});
