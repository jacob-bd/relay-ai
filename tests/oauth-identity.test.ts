import { describe, it, expect } from 'vitest';
import {
  describeOAuthAccount,
  formatOAuthAccount,
  identityFromJwt,
  mergeIdentity,
  sameOAuthAccount,
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

describe('sameOAuthAccount', () => {
  const cred = (extra: Record<string, unknown>) => ({ type: 'oauth' as const, access: 'opaque', refresh: 'r', expires: Date.now() + 1000, ...extra });

  it('matches the same email regardless of case', () => {
    const a = cred({ providerData: { identity: { email: 'Me@Example.com' } } });
    const b = cred({ providerData: { identity: { email: 'me@example.com' } } });
    expect(sameOAuthAccount('openai-oauth', a, b)).toBe(true);
  });

  it('matches the same user id even when the email differs', () => {
    const a = cred({ providerData: { identity: { userId: 'user-1', email: 'old@example.com' } } });
    const b = cred({ providerData: { identity: { userId: 'user-1', email: 'new@example.com' } } });
    expect(sameOAuthAccount('openai-oauth', a, b)).toBe(true);
  });

  it('two people in one ChatGPT workspace are different accounts', () => {
    const a = cred({ accountId: 'workspace-1', providerData: { identity: { email: 'a@corp.com', userId: 'u-a' } } });
    const b = cred({ accountId: 'workspace-1', providerData: { identity: { email: 'b@corp.com', userId: 'u-b' } } });
    expect(sameOAuthAccount('openai-oauth', a, b)).toBe(false);
  });

  it('reads the email from an older login that only has it in the access token', () => {
    const old = cred({ access: jwt({ 'https://api.openai.com/profile': { email: 'me@example.com' } }) });
    const fresh = cred({ providerData: { identity: { email: 'me@example.com' } } });
    expect(sameOAuthAccount('openai-oauth', old, fresh)).toBe(true);
  });

  it('GitHub Copilot compares the login', () => {
    const a = cred({ providerData: { copilot: { login: 'Octocat' } } });
    const b = cred({ providerData: { copilot: { login: 'octocat' } } });
    const c = cred({ providerData: { copilot: { login: 'someone-else' } } });
    expect(sameOAuthAccount('github-copilot', a, b)).toBe(true);
    expect(sameOAuthAccount('github-copilot', a, c)).toBe(false);
  });

  it('ClinePass compares the Cline user id', () => {
    expect(sameOAuthAccount('cline-pass', cred({ accountId: 'u1' }), cred({ accountId: 'u1' }))).toBe(true);
    expect(sameOAuthAccount('cline-pass', cred({ accountId: 'u1' }), cred({ accountId: 'u2' }))).toBe(false);
  });

  it('an account id alone never proves two ChatGPT logins are the same', () => {
    expect(sameOAuthAccount('openai-oauth', cred({ accountId: 'workspace-1' }), cred({ accountId: 'workspace-1' }))).toBe(false);
  });

  it('with nothing in common (or nothing known) accounts are treated as different', () => {
    expect(sameOAuthAccount('xai-oauth', cred({}), cred({}))).toBe(false);
    expect(sameOAuthAccount('xai-oauth', cred({ providerData: { identity: { email: 'a@x.com' } } }), cred({ providerData: { identity: { email: 'b@x.com' } } }))).toBe(false);
  });
});
