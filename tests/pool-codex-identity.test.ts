import { describe, expect, it } from 'vitest';
import { codexPoolIdentity } from '../src/pool/codex-identity.js';
const metadata = { session_id: 's', thread_id: 't', turn_id: '1', agent_name: 'main', context_window_id: 'same' };
const identity = (value: unknown) => codexPoolIdentity({ 'x-codex-turn-metadata': JSON.stringify(value) });
describe('Codex pool identity', () => {
  it('preserves branch affinity across turns but separates retries and forks', () => {
    const first = identity(metadata)!;
    const resumed = identity({ ...metadata, turn_id: '2' })!;
    expect(first.conversation).toBe(resumed.conversation);
    expect(first.turn).not.toBe(resumed.turn);
    expect(first).toEqual(identity(metadata));
    expect(identity({ ...metadata, thread_id: 'fork' })!.conversation).not.toBe(first.conversation);
    expect(identity({ ...metadata, agent_name: 'child' })!.conversation).not.toBe(first.conversation);
  });
  it('refuses absent, oversized and malformed identities', () => {
    expect(codexPoolIdentity({})).toBeUndefined();
    for (const value of [[], null, {}, { ...metadata, thread_id: '' }, { ...metadata, turn_id: 12 }]) expect(identity(value)).toBeUndefined();
    expect(codexPoolIdentity({ 'x-codex-turn-metadata': 'x'.repeat(8193) })).toBeUndefined();
  });
});
