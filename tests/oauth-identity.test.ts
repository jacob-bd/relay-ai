import { describe, it, expect } from 'vitest';
import {
  describeOAuthAccount,
  formatOAuthAccount,
  identityFromJwt,
  mergeIdentity,
} from '../src/oauth/identity.js';
import { tokensToStoredCredential } from '../src/oauth/types.js';

function jwt(claims: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'none' })}.${enc(claims)}.sig`;
}

const openAiClaims = {
  email: 'me@example.com',
  'https://api.openai.com/auth': { chatgpt_plan_type: 'plus', chatgpt_user_id: 'user-123', chatgpt_account_id: 'acct-1' },
};

describe('identityFromJwt', () => {
  it('reads email, plan and user id from OpenAI-style claims', () => {
    expect(identityFromJwt(jwt(openAiClaims))).toEqual({ email: 'me@example.com', plan: 'plus', userId: 'user-123' });
  });

  it('reads the profile email OpenAI puts in access tokens', () => {
    expect(identityFromJwt(jwt({ 'https://api.openai.com/profile': { email: 'p@example.com' } })).email).toBe('p@example.com');
  });

  it('reads standard OpenID claims', () => {
    expect(identityFromJwt(jwt({ email: 'g@example.com', name: 'G User', sub: 's-1' })))
      .toEqual({ email: 'g@example.com', name: 'G User', userId: 's-1' });
  });

  it('returns nothing for opaque or malformed tokens', () => {
    expect(identityFromJwt('opaque-token')).toEqual({});
    expect(identityFromJwt('a.b.c')).toEqual({});
    expect(identityFromJwt(undefined)).toEqual({});
  });
});

describe('mergeIdentity', () => {
  it('later non-empty values win and empty ones never erase', () => {
    expect(mergeIdentity({ email: 'old@x.com', plan: 'plus' }, { email: undefined, plan: 'pro' }))
      .toEqual({ email: 'old@x.com', plan: 'pro' });
  });

  it('returns undefined when nothing is known', () => {
    expect(mergeIdentity({}, undefined)).toBeUndefined();
  });
});

describe('tokensToStoredCredential identity', () => {
  it('stores identity from the id_token under providerData.identity', () => {
    const cred = tokensToStoredCredential({ access_token: 'a', id_token: jwt(openAiClaims) });
    expect(cred.providerData?.identity).toEqual({ email: 'me@example.com', plan: 'plus', userId: 'user-123' });
  });

  it('keeps stored identity across a refresh that returns no id_token', () => {
    const first = tokensToStoredCredential({ access_token: 'a', id_token: jwt(openAiClaims) });
    const refreshed = tokensToStoredCredential({ access_token: 'b' }, 'r', undefined, first.providerData);
    expect(refreshed.providerData?.identity).toEqual({ email: 'me@example.com', plan: 'plus', userId: 'user-123' });
  });

  it('adds nothing when the id_token carries no identity', () => {
    const cred = tokensToStoredCredential({ access_token: 'a', id_token: 'opaque' });
    expect(cred.providerData).toBeUndefined();
  });
});

describe('describeOAuthAccount / formatOAuthAccount', () => {
  it('prefers stored identity', () => {
    const d = describeOAuthAccount({ kind: 'openai-oauth', providerData: { identity: { email: 'me@example.com', plan: 'plus' } } });
    expect(formatOAuthAccount(d)).toBe('me@example.com · plus');
  });

  it('falls back to the access token for ChatGPT logins saved before identity was kept', () => {
    const d = describeOAuthAccount({ kind: 'openai-oauth', accessToken: jwt({ 'https://api.openai.com/profile': { email: 'old@example.com' } }) });
    expect(formatOAuthAccount(d)).toBe('old@example.com');
  });

  it('Antigravity: the account id is the Google email; tier is the plan', () => {
    const d = describeOAuthAccount({ kind: 'antigravity', accountId: 'g@example.com', providerData: { tier: 'free-tier' } });
    expect(formatOAuthAccount(d)).toBe('g@example.com · free-tier');
  });

  it('Antigravity: an account id that is not an email is not shown as one', () => {
    expect(formatOAuthAccount(describeOAuthAccount({ kind: 'antigravity', accountId: 'abc123' }))).toBeUndefined();
  });

  it('ClinePass: email from the stored user info', () => {
    expect(formatOAuthAccount(describeOAuthAccount({ kind: 'cline-pass', providerData: { email: 'c@example.com', name: 'C' } })))
      .toBe('c@example.com');
  });

  it('GitHub Copilot: login and plan', () => {
    expect(formatOAuthAccount(describeOAuthAccount({ kind: 'github-copilot', providerData: { copilot: { login: 'octocat', copilot_plan: 'individual' } } })))
      .toBe('octocat · individual');
  });

  it('Claude Code: email from sign-in, plan from the account', () => {
    expect(formatOAuthAccount(describeOAuthAccount({ kind: 'claude-code', providerData: { identity: { email: 'cl@example.com' }, plan: 'max_5x' } })))
      .toBe('cl@example.com · max_5x');
  });

  it('numbered accounts resolve through their kind', () => {
    expect(formatOAuthAccount(describeOAuthAccount({ kind: 'antigravity-2', accountId: 'g@example.com' }))).toBe('g@example.com');
  });

  it('returns undefined when nothing is known', () => {
    expect(formatOAuthAccount(describeOAuthAccount({ kind: 'xai-oauth' }))).toBeUndefined();
  });
});
