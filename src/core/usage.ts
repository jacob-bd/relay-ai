// src/core/usage.ts — per-account usage windows for OAuth providers (credential-safe: no token leaves this module).

import {
  readStoredOAuthCredential, resolveProviderCredential, resolveProviderOAuthAccountId,
} from '../env.js';
import { ANTIGRAVITY_BASE_URLS, ANTIGRAVITY_USER_AGENT } from '../oauth/antigravity-oauth.js';
import { CLAUDE_CODE_CLI_VERSION } from '../oauth/claude-identity.js';
import { providerKind } from '../registry/provider-kind.js';
import type { RegistryProvider } from '../registry/types.js';
import {
  parseAntigravityUsage, parseChatGptUsage, parseClaudeUsage, parseCopilotUsage, parseXaiUsage,
} from '../usage/parse.js';
import { loadStoredUsage, saveUsageResults } from '../usage/store.js';
import { VERSION } from '../constants.js';
import { loadCoreRegistry } from './catalog.js';
import type {
  GetRelayAccountUsageOptions, ReadRelayAccountUsageOptions, RelayAccountUsage, RelayUsageBalance, RelayUsageErrorCode, RelayUsageWindow,
} from './types.js';

export const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
export const CHATGPT_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
export const COPILOT_USER_URL = 'https://api.github.com/copilot_internal/user';
export const XAI_BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits';

const DEFAULT_TIMEOUT_MS = 10_000;
const USAGE_KINDS = new Set(['claude-code', 'openai-oauth', 'antigravity', 'xai-oauth', 'github-copilot']);

class UsageError extends Error {
  constructor(readonly code: RelayUsageErrorCode, message: string) {
    super(message);
  }
}

interface FetchContext {
  fetchImpl: typeof globalThis.fetch;
  timeoutMs: number;
}

interface UsageResult {
  windows: RelayUsageWindow[];
  balances?: RelayUsageBalance[];
  limitReached?: boolean;
}

function statusError(status: number, provider: string): UsageError {
  if (status === 401) return new UsageError('reauth_required', `${provider} rejected the sign-in — sign in again in relay-ai.`);
  if (status === 403) return new UsageError('access_denied', `${provider} refused the usage request (403).`);
  if (status === 429) return new UsageError('rate_limited', `${provider} is rate-limiting usage requests — try again later.`);
  return new UsageError('unavailable', `${provider} usage request failed (${status}).`);
}

async function getJson(ctx: FetchContext, url: string, init: RequestInit, provider: string): Promise<unknown> {
  let response: Response;
  try {
    response = await ctx.fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(ctx.timeoutMs) });
  } catch {
    throw new UsageError('unavailable', `${provider} usage request did not complete.`);
  }
  if (!response.ok) throw statusError(response.status, provider);
  try {
    return await response.json();
  } catch {
    throw new UsageError('unsupported_payload', `${provider} returned a usage response Relay could not read.`);
  }
}

function parsed<T>(value: T | null, provider: string): T {
  if (value === null) throw new UsageError('unsupported_payload', `${provider} returned no usage Relay recognises.`);
  return value;
}

async function accessToken(provider: RegistryProvider): Promise<string> {
  let token: string | null = null;
  try {
    token = await resolveProviderCredential(provider.id, provider.authRef);
  } catch {
    throw new UsageError('reauth_required', `Could not refresh the sign-in for ${provider.name} — sign in again in relay-ai.`);
  }
  if (!token) throw new UsageError('credential_unavailable', `No stored sign-in for ${provider.name}.`);
  return token;
}

async function claudeUsage(provider: RegistryProvider, ctx: FetchContext): Promise<UsageResult> {
  const body = await getJson(ctx, CLAUDE_USAGE_URL, {
    headers: {
      Authorization: `Bearer ${await accessToken(provider)}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': `claude-cli/${CLAUDE_CODE_CLI_VERSION} (external, cli)`,
      Accept: 'application/json',
    },
  }, 'Claude');
  const windows = parsed(parseClaudeUsage(body), 'Claude');
  return { windows, limitReached: windows.some(w => w.scope.type === 'account' && (w.usedPercent ?? 0) >= 100) };
}

async function chatGptUsage(provider: RegistryProvider, ctx: FetchContext): Promise<UsageResult> {
  const token = await accessToken(provider);
  const accountId = await resolveProviderOAuthAccountId(provider.authRef).catch(() => undefined);
  const body = await getJson(ctx, CHATGPT_USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
      'User-Agent': 'codex-cli',
      Accept: 'application/json',
    },
  }, 'ChatGPT');
  return parsed(parseChatGptUsage(body), 'ChatGPT');
}

async function antigravityUsage(provider: RegistryProvider, ctx: FetchContext): Promise<UsageResult> {
  const token = await accessToken(provider);
  const responses: unknown[] = [];
  let lastError: UsageError | undefined;
  // Preview models (Gemini 4) are listed by the daily endpoint, standard ones by the main endpoint.
  for (const base of ANTIGRAVITY_BASE_URLS) {
    try {
      responses.push(await getJson(ctx, `${base}/v1internal:fetchAvailableModels`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': ANTIGRAVITY_USER_AGENT,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: '{}',
      }, 'Antigravity'));
    } catch (err) {
      lastError = err instanceof UsageError ? err : new UsageError('unavailable', 'Antigravity usage request failed.');
    }
  }
  if (!responses.length) throw lastError ?? new UsageError('unavailable', 'Antigravity usage request failed.');
  const windows = parsed(parseAntigravityUsage(responses), 'Antigravity');
  return { windows };
}

async function copilotUsage(provider: RegistryProvider, ctx: FetchContext): Promise<UsageResult> {
  // The user endpoint takes the long-lived GitHub token (stored as the refresh token), not the Copilot session token.
  const stored = await readStoredOAuthCredential(provider.authRef).catch(() => undefined);
  if (!stored?.refresh) throw new UsageError('credential_unavailable', `No stored GitHub sign-in for ${provider.name}.`);
  const body = await getJson(ctx, COPILOT_USER_URL, {
    headers: {
      Authorization: `Bearer ${stored.refresh}`,
      Accept: 'application/json',
      'User-Agent': `relay-ai/${VERSION}`,
      'Editor-Version': 'vscode/1.85.1',
      'X-GitHub-Api-Version': '2025-04-01',
    },
  }, 'GitHub Copilot');
  const windows = parsed(parseCopilotUsage(body), 'GitHub Copilot');
  return { windows, limitReached: windows.some(w => w.id === 'monthly:premium_interactions' && (w.usedPercent ?? 0) >= 100) };
}

async function xaiUsage(provider: RegistryProvider, ctx: FetchContext): Promise<UsageResult> {
  const body = await getJson(ctx, XAI_BILLING_URL, {
    headers: {
      Authorization: `Bearer ${await accessToken(provider)}`,
      'X-XAI-Token-Auth': 'xai-grok-cli',
      Accept: 'application/json',
    },
  }, 'xAI');
  const { windows, balances } = parsed(parseXaiUsage(body), 'xAI');
  return { windows, balances, limitReached: windows.some(w => w.id === 'credits' && (w.usedPercent ?? 0) >= 100) };
}

const FETCHERS: Record<string, (provider: RegistryProvider, ctx: FetchContext) => Promise<UsageResult>> = {
  'claude-code': claudeUsage,
  'openai-oauth': chatGptUsage,
  antigravity: antigravityUsage,
  'xai-oauth': xaiUsage,
  'github-copilot': copilotUsage,
};

/** Kinds `getRelayAccountUsage` can read usage for. */
export function supportsAccountUsage(providerId: string): boolean {
  return USAGE_KINDS.has(providerKind(providerId));
}

async function usageForProvider(provider: RegistryProvider, ctx: FetchContext): Promise<RelayAccountUsage> {
  const kind = providerKind(provider.id);
  const base = { providerId: provider.id, providerKind: kind, providerName: provider.name };
  const fetcher = FETCHERS[kind];
  if (!fetcher) return { ...base, status: 'unsupported', windows: [], fetchedAt: null };
  try {
    const result = await fetcher(provider, ctx);
    return {
      ...base, status: 'ok', windows: result.windows,
      ...(result.balances?.length ? { balances: result.balances } : {}),
      ...(result.limitReached !== undefined ? { limitReached: result.limitReached } : {}),
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    const error = err instanceof UsageError ? err : new UsageError('unavailable', `Usage lookup failed for ${provider.name}.`);
    return { ...base, status: 'error', windows: [], fetchedAt: null, error: { code: error.code, message: error.message } };
  }
}

function oauthAccounts(opts: { providerIds?: string[]; registryPath?: string }): RegistryProvider[] {
  const registry = loadCoreRegistry(opts.registryPath);
  const wanted = opts.providerIds ? new Set(opts.providerIds) : undefined;
  return registry.providers.filter(p => p.enabled && p.authType === 'oauth' && (!wanted || wanted.has(p.id)));
}

/** Checks in progress, so a sign-in check and a page's first view share one request per account. */
const inFlight = new Map<string, Promise<RelayAccountUsage>>();

function checkOnce(provider: RegistryProvider, ctx: FetchContext, key: string): Promise<RelayAccountUsage> {
  const running = inFlight.get(key);
  if (running) return running;
  const check = usageForProvider(provider, ctx).finally(() => inFlight.delete(key));
  inFlight.set(key, check);
  return check;
}

async function checkAccounts(providers: RegistryProvider[], opts: GetRelayAccountUsageOptions): Promise<RelayAccountUsage[]> {
  const ctx: FetchContext = { fetchImpl: opts.fetchImpl ?? globalThis.fetch, timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS };
  const scope = `${opts.registryPath ?? ''}|${opts.usageStorePath ?? ''}`;
  const results = await Promise.all(providers.map(provider => checkOnce(provider, ctx, `${scope}|${provider.id}`)));
  if (opts.persist === false) return results;
  const stored = saveUsageResults(results.filter(r => r.status !== 'unsupported'), opts.usageStorePath);
  return results.map(r => stored[r.providerId] ?? r);
}

/**
 * Check usage now, per enabled OAuth account, as a list of windows (percent used, reset time, scope).
 * Makes one live request per account (Antigravity: one per Cloud Code endpoint) and may refresh OAuth
 * tokens; nothing in Relay calls this on a timer. Results are saved for `readRelayAccountUsage`.
 * Never throws for a single account's failure: that account comes back with `status: 'error'`
 * and keeps its last good windows.
 */
export async function getRelayAccountUsage(opts: GetRelayAccountUsageOptions = {}): Promise<RelayAccountUsage[]> {
  return checkAccounts(oauthAccounts(opts), opts);
}

/** First check for a newly signed-in account. Never throws: a failed check is saved as that account's error. */
export async function checkUsageAfterSignIn(providerId: string, opts: GetRelayAccountUsageOptions = {}): Promise<void> {
  if (!supportsAccountUsage(providerId)) return;
  try {
    await getRelayAccountUsage({ ...opts, providerIds: [providerId] });
  } catch { /* usage is informational; sign-in already succeeded */ }
}

/**
 * The last saved usage per enabled OAuth account, without network requests. Accounts never checked
 * come back as `status: 'unchecked'`, unless `fetchMissing` is set, which checks just those accounts once.
 */
export async function readRelayAccountUsage(opts: ReadRelayAccountUsageOptions = {}): Promise<RelayAccountUsage[]> {
  const providers = oauthAccounts(opts);
  const stored = loadStoredUsage(opts.usageStorePath);
  const missing = providers.filter(p => supportsAccountUsage(p.id) && !stored[p.id]);
  const fetched = opts.fetchMissing && missing.length
    ? new Map((await checkAccounts(missing, opts)).map(r => [r.providerId, r]))
    : new Map<string, RelayAccountUsage>();
  return providers.map(provider => {
    const kind = providerKind(provider.id);
    const base = { providerId: provider.id, providerKind: kind, providerName: provider.name };
    if (!supportsAccountUsage(provider.id)) return { ...base, status: 'unsupported', windows: [], fetchedAt: null };
    const reading = fetched.get(provider.id) ?? stored[provider.id];
    return reading ? { ...reading, ...base } : { ...base, status: 'unchecked', windows: [], fetchedAt: null };
  });
}
