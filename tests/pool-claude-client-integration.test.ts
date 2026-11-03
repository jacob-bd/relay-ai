import { expect, it } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { startFakeAnthropicGateway } from './support/fake-anthropic-gateway.js';
import { startFakePoolSdkUpstream } from './support/fake-pool-sdk-upstream.js';

it('serves nonstream JSON through the actual Anthropic client and HTTP failover', async () => {
  const upstream = await startFakePoolSdkUpstream();
  const gateway = await startFakeAnthropicGateway({
    pool: true, guard: true, routes: body => upstream.routes(body, ['rate', 'ok']),
  });
  try {
    const client = new Anthropic({
      apiKey: 'fake-anthropic-key', baseURL: 'http://127.0.0.1:' + gateway.port, maxRetries: 0,
    });
    const message = await client.messages.create({
      model: 'claude-pool', max_tokens: 64, stream: false,
      messages: [{ role: 'user', content: 'synthetic nonstream' }],
    }, { headers: { 'x-claude-code-session-id': 'fixture/nonstream' } });
    expect(message.type).toBe('message');
    expect(message.content).toEqual([{ type: 'text', text: 'RELAY_CLIENT_OK' }]);
    expect(message.stop_reason).toBe('end_turn');
    expect(upstream.requests.map(request => request.mode)).toEqual(['rate', 'ok']);
    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0].stream).toBe(false);
  } finally {
    await gateway.close();
    await upstream.close();
  }
});

it('never returns a partial nonstream tool call or retries after provider commitment', async () => {
  const upstream = await startFakePoolSdkUpstream();
  const gateway = await startFakeAnthropicGateway({
    pool: true, guard: true, routes: body => upstream.routes(body, ['tool-error', 'ok']),
  });
  try {
    const client = new Anthropic({
      apiKey: 'fake-anthropic-key', baseURL: 'http://127.0.0.1:' + gateway.port, maxRetries: 0,
    });
    const request = () => client.messages.create({
      model: 'claude-pool', max_tokens: 64, stream: false,
      messages: [{ role: 'user', content: 'synthetic interrupted nonstream tool' }],
    }, { headers: { 'x-claude-code-session-id': 'fixture/nonstream/tool' } });
    await expect(request()).rejects.toMatchObject({ status: 400 });
    await expect(request()).rejects.toMatchObject({ status: 400 });
    expect(upstream.requests.map(entry => entry.mode)).toEqual(['tool-error']);
    expect(gateway.requests).toHaveLength(2);
  } finally {
    await gateway.close();
    await upstream.close();
  }
});
