import { describe, expect, it, vi } from 'vitest';
import {
  inspectCollaborationItem,
  normalizePlaintextCollaborationForExternal,
  createNativePayloadRelay,
  resolveRoutedCollaborationInput,
  stripCodexCollaborationTools,
} from '../src/codex/collaboration-payload.js';
import type { ResponsesInputItem } from '../src/codex-responses-adapter.js';

const encrypted = {
  type: 'agent_message',
  content: [
    { type: 'input_text', text: 'Message Type: NEW_TASK\nTask name: /root/probe\nSender: /root\nPayload:' },
    { type: 'encrypted_content', encrypted_content: `gAAAAA${'A'.repeat(40)}` },
  ],
};

describe('Codex collaboration payload handling', () => {
  it('classifies native encrypted agent messages and leaves compaction opaque', () => {
    expect(inspectCollaborationItem(encrypted)).toEqual({ kind: 'native-encrypted', ciphertext: expect.stringMatching(/^gAAAAA/) });
    expect(inspectCollaborationItem({ type: 'compaction', encrypted_content: `gAAAAA${'A'.repeat(40)}` })).toEqual({ kind: 'none' });
  });

  it('extracts plaintext after the protocol Payload boundary', () => {
    const plain = { ...encrypted, content: [encrypted.content[0], { type: 'encrypted_content', encrypted_content: 'Message Type: NEW_TASK\nPayload:\nhello Payload: text' }] };
    const normalized = normalizePlaintextCollaborationForExternal([plain]);
    expect(normalized[0]).toEqual({
      type: 'agent_message',
      content: [
        encrypted.content[0],
        { type: 'input_text', text: 'hello Payload: text' },
      ],
    });
  });

  it('accepts plaintext collaboration carried in encrypted_content after the visible protocol header', async () => {
    const plain: ResponsesInputItem = {
      type: 'agent_message',
      content: [
        { type: 'input_text', text: 'Message Type: NEW_TASK\nTask name: /root/probe\nSender: /root\nPayload:' },
        { type: 'encrypted_content', encrypted_content: 'summarize README.md' },
      ],
    };

    await expect(resolveRoutedCollaborationInput([plain], {
      native: {
        nativeBaseUrl: 'https://chatgpt.com/backend-api/codex',
        nativeModelId: 'gpt-5.5',
        headers: {},
      },
    })).resolves.toEqual([
      {
        type: 'agent_message',
        content: [
          plain.content[0],
          { type: 'input_text', text: 'summarize README.md' },
        ],
      },
    ]);
  });

  it('accepts a text-only agent result and does not duplicate its payload', () => {
    const result: ResponsesInputItem = {
      type: 'agent_message',
      content: [{ type: 'input_text', text: 'Message Type: FINAL_ANSWER\nSender: /root/probe\nPayload:\nREADME summary' }],
    };

    expect(inspectCollaborationItem(result)).toEqual({ kind: 'relay-plaintext', plaintext: 'README summary' });
    expect(normalizePlaintextCollaborationForExternal([result])).toEqual([result]);
  });

  it('removes collaboration tools from a Relay Agent request but preserves repository tools', () => {
    const body = {
      tools: [
        { type: 'function', name: 'collaboration__spawn_agent' },
        { type: 'function', name: 'exec_command' },
      ],
      input: [{
        type: 'additional_tools',
        tools: [{
          type: 'namespace',
          name: 'collaboration',
          tools: [{ type: 'function', name: 'spawn_agent' }, { type: 'function', name: 'wait_agent' }],
        }],
      }],
    };

    const stripped = stripCodexCollaborationTools(body);
    expect(JSON.stringify(stripped)).not.toContain('collaboration');
    expect(JSON.stringify(stripped)).toContain('exec_command');
  });

  it('resolves exactly one forced transport call', async () => {
    const argumentsJson = JSON.stringify({ payload: 'MARKER' });
    const fetchImpl = vi.fn(async () => new Response([
      `data: ${JSON.stringify({ type: 'response.output_item.added', item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'relay_external_agent_payload', arguments: '' } })}`,
      '',
      `data: ${JSON.stringify({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: argumentsJson.slice(0, 8) })}`,
      '',
      `data: ${JSON.stringify({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: argumentsJson.slice(8) })}`,
      '',
      `data: ${JSON.stringify({ type: 'response.function_call_arguments.done', item_id: 'fc_1', arguments: argumentsJson })}`,
      '',
      'data: [DONE]',
      '',
    ].join('\n'), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    const relay = createNativePayloadRelay({ fetchImpl: fetchImpl as typeof fetch });
    await expect(relay.resolve(encrypted as never, {
      nativeBaseUrl: 'https://chatgpt.com/backend-api/codex',
      nativeModelId: 'gpt-5.5',
      headers: { authorization: 'Bearer native', 'chatgpt-account-id': 'acct' },
    })).resolves.toBe('MARKER');
    await expect(relay.resolve(encrypted as never, {
      nativeBaseUrl: 'https://chatgpt.com/backend-api/codex',
      nativeModelId: 'gpt-5.5',
      headers: { authorization: 'Bearer native', 'chatgpt-account-id': 'acct' },
    })).resolves.toBe('MARKER');
    expect(fetchImpl).toHaveBeenCalledOnce();
    const request = fetchImpl.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ stream: true, store: false });
    expect(body.tools).toEqual([
      expect.objectContaining({ name: 'relay_external_agent_payload' }),
    ]);
    expect(request.headers).toEqual(expect.objectContaining({ Accept: 'text/event-stream' }));
  });

  it('keeps payload cache entries separated by native account', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      output: [{ type: 'function_call', name: 'relay_external_agent_payload', arguments: JSON.stringify({ payload: 'MARKER' }) }],
    }), { status: 200 }));
    const relay = createNativePayloadRelay({ fetchImpl: fetchImpl as typeof fetch });
    const base = { nativeBaseUrl: 'https://chatgpt.com/backend-api/codex', nativeModelId: 'gpt-5.5', headers: { authorization: 'Bearer native' } };
    await relay.resolve(encrypted as never, { ...base, headers: { ...base.headers, 'chatgpt-account-id': 'acct-a' } });
    await relay.resolve(encrypted as never, { ...base, headers: { ...base.headers, 'chatgpt-account-id': 'acct-a' } });
    await relay.resolve(encrypted as never, { ...base, headers: { ...base.headers, 'chatgpt-account-id': 'acct-b' } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
