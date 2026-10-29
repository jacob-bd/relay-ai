import { describe, it, expect } from 'vitest';
import { claudeCodeProviderData } from '../src/oauth/claude-code-account.js';

describe('claudeCodeProviderData', () => {
  it('keeps the account details a sign-in discovered, with a new device id', () => {
    const data = claudeCodeProviderData({
      accountId: 'uuid-1', email: 'me@example.com', organizationId: 'org-1', organizationName: 'My Org', plan: 'max_5x',
    });
    expect(data).toMatchObject({
      accountUUID: 'uuid-1',
      organizationUUID: 'org-1',
      organizationName: 'My Org',
      plan: 'max_5x',
      identity: { email: 'me@example.com' },
    });
    expect(data.cliUserID).toMatch(/^[0-9a-f]{64}$/);
  });

  it('leaves out what the sign-in did not discover', () => {
    const data = claudeCodeProviderData({});
    expect(Object.keys(data)).toEqual(['cliUserID']);
  });

  it('gives every sign-in its own device id', () => {
    expect(claudeCodeProviderData({}).cliUserID).not.toBe(claudeCodeProviderData({}).cliUserID);
  });
});
