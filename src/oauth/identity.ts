// oauth/identity.ts — who is signed in to an OAuth provider (shown in details, never used as a label)

import { providerKind } from '../registry/provider-kind.js';

export interface OAuthIdentity {
  email?: string;
  name?: string;
  plan?: string;
  userId?: string;
  login?: string;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function jwtClaims(token: string | undefined): Record<string, unknown> | undefined {
  const parts = token?.split('.');
  if (!parts || parts.length !== 3) return undefined;
  try {
    return record(JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')));
  } catch {
    return undefined;
  }
}

function compact(identity: OAuthIdentity): OAuthIdentity {
  return Object.fromEntries(Object.entries(identity).filter(([, v]) => v !== undefined)) as OAuthIdentity;
}

/** Email/name/plan/user id from a JWT's claims (OpenAI and standard OpenID shapes); {} when none. */
export function identityFromJwt(token: string | undefined): OAuthIdentity {
  const claims = jwtClaims(token);
  if (!claims) return {};
  const auth = record(claims['https://api.openai.com/auth']);
  const profile = record(claims['https://api.openai.com/profile']);
  return compact({
    email: text(claims.email) ?? text(profile?.email),
    name: text(claims.name),
    plan: text(auth?.chatgpt_plan_type),
    userId: text(auth?.chatgpt_user_id) ?? text(auth?.user_id) ?? text(claims.sub),
  });
}

/** Later non-empty values win; empty values never erase earlier ones. */
export function mergeIdentity(...parts: Array<OAuthIdentity | undefined>): OAuthIdentity | undefined {
  const merged: OAuthIdentity = {};
  for (const part of parts) Object.assign(merged, compact(part ?? {}));
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function storedIdentity(providerData: Record<string, unknown> | undefined): OAuthIdentity {
  const stored = record(providerData?.identity);
  return compact({
    email: text(stored?.email),
    name: text(stored?.name),
    plan: text(stored?.plan),
    userId: text(stored?.userId),
    login: text(stored?.login),
  });
}

export interface DescribeOAuthAccountInput {
  /** Provider id or kind; numbered accounts resolve to their kind. */
  kind: string;
  accountId?: string;
  providerData?: Record<string, unknown>;
  accessToken?: string;
}

/** Best-known identity, from stored identity, then provider-specific fields, then the access token. */
export function describeOAuthAccount(input: DescribeOAuthAccountInput): OAuthIdentity {
  const data = input.providerData;
  const kind = providerKind(input.kind);
  let fromProvider: OAuthIdentity = {};

  if (kind === 'antigravity') {
    fromProvider = compact({
      email: input.accountId?.includes('@') ? input.accountId : undefined,
      plan: text(data?.tier),
    });
  } else if (kind === 'cline-pass') {
    fromProvider = compact({ email: text(data?.email), name: text(data?.name) });
  } else if (kind === 'github-copilot') {
    const copilot = record(data?.copilot);
    fromProvider = compact({ login: text(copilot?.login), plan: text(copilot?.copilot_plan) });
  } else if (kind === 'claude-code') {
    fromProvider = compact({ plan: text(data?.plan), name: text(data?.organizationName) });
  }

  return mergeIdentity(identityFromJwt(input.accessToken), fromProvider, storedIdentity(data)) ?? {};
}

/** "you@example.com · plus", or undefined when nothing useful is known. */
export function formatOAuthAccount(identity: OAuthIdentity): string | undefined {
  const who = identity.email ?? identity.login ?? identity.name;
  const parts = [who, identity.plan].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(' · ') : undefined;
}
