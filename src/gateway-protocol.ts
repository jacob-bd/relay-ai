import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getAppHome } from './paths.js';

export type GatewayProtocol = 'openai' | 'anthropic';

export interface ProtocolAlternative {
  modelFormat: GatewayProtocol;
  npm: string;
  baseURL: string;
  upstreamUrl: string;
}

export interface ProtocolRouteInput {
  providerId?: string;
  modelFormat: GatewayProtocol;
  npm?: string;
  baseURL?: string;
}

const DUAL_PROVIDER_IDS = new Set([
  'zen',
  'go',
  'opencode',
  'opencode-zen',
  'opencode-go',
  'openrouter',
  'commandcode',
  'command-code',
]);

function normalizedRoot(baseURL: string): string {
  return baseURL.replace(/\/+$/, '').replace(/\/v1$/i, '');
}

function isKnownDualHost(providerId: string | undefined, baseURL: string | undefined): boolean {
  if (!baseURL) return false;
  let parsed: URL;
  try {
    parsed = new URL(baseURL);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  const id = providerId?.trim().toLowerCase();

  if (host === 'opencode.ai' && path.includes('/zen')) return true;
  if (host === 'openrouter.ai' && path.includes('/api')) return true;
  if (host === 'commandcode.ai' || host.endsWith('.commandcode.ai')) {
    if (path.includes('/provider')) return true;
  }
  return id !== undefined && DUAL_PROVIDER_IDS.has(id) && (
    host === 'opencode.ai' || host === 'openrouter.ai' || host === 'commandcode.ai'
  );
}

/** Whether a route is a known gateway with both Chat Completions and Messages APIs. */
export function isDualProtocolGateway(providerId?: string, baseURL?: string): boolean {
  return isKnownDualHost(providerId, baseURL);
}

/**
 * Derive the sibling endpoint for a known dual-protocol gateway. The returned
 * baseURL is the root expected by the selected SDK package; `upstreamUrl` is
 * the full endpoint useful for diagnostics and raw forwarding.
 */
export function resolveProtocolAlternative(input: ProtocolRouteInput): ProtocolAlternative | null {
  if (!isDualProtocolGateway(input.providerId, input.baseURL)) return null;
  if (!input.baseURL) return null;

  const root = normalizedRoot(input.baseURL);
  if (input.modelFormat === 'openai') {
    return {
      modelFormat: 'anthropic',
      npm: '@ai-sdk/anthropic',
      baseURL: root,
      upstreamUrl: `${root}/v1/messages`,
    };
  }

  const openaiRoot = `${root}/v1`;
  const openrouter = input.providerId?.trim().toLowerCase() === 'openrouter'
    || input.npm === '@openrouter/ai-sdk-provider'
    || root.includes('openrouter.ai');
  return {
    modelFormat: 'openai',
    npm: openrouter ? '@openrouter/ai-sdk-provider' : '@ai-sdk/openai-compatible',
    baseURL: openaiRoot,
    upstreamUrl: `${openaiRoot}/chat/completions`,
  };
}

export interface ProtocolFailure {
  retryable: boolean;
  status?: number;
  reason: string;
}

function errorText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const pieces = [record.message, record.responseBody, record.code]
    .filter((item): item is string => typeof item === 'string');
  return pieces.join(' ');
}

function findErrorField(error: unknown, field: string, depth = 0): unknown {
  if (!error || typeof error !== 'object' || depth > 3) return undefined;
  const record = error as Record<string, unknown>;
  if (record[field] !== undefined) return record[field];
  return findErrorField(record.cause, field, depth + 1)
    ?? findErrorField(record.lastError, field, depth + 1);
}

/** Classify whether an upstream error is plausibly a protocol mismatch. */
export function classifyProtocolFailure(error: unknown): ProtocolFailure {
  const statusValue = findErrorField(error, 'statusCode') ?? findErrorField(error, 'status');
  const status = typeof statusValue === 'number' ? statusValue : undefined;
  const text = errorText(error) + ' ' + errorText(findErrorField(error, 'cause'))
    + ' ' + errorText(findErrorField(error, 'responseBody'));
  const lower = text.toLowerCase();

  if (lower.includes('abort') || lower.includes('cancel')) {
    return { retryable: false, status, reason: 'request cancelled' };
  }
  if (status === 401 || status === 403 || status === 429
    || /invalid (api )?key|authentication|quota|billing|not in plan|model_not_in_plan/.test(lower)) {
    return { retryable: false, status, reason: 'authentication or quota failure' };
  }
  if (/context (length|window)|too many tokens|maximum context|invalid tool|tool schema|moderation/.test(lower)) {
    return { retryable: false, status, reason: 'request content was rejected' };
  }

  const explicitProtocol = status === 405 || status === 415
    || (status !== undefined && [400, 404, 422].includes(status)
      && /endpoint|method|protocol|messages|chat\/completions|chat completions|anthropic/.test(lower));
  if (explicitProtocol) {
    return { retryable: true, status, reason: 'provider rejected the selected API format' };
  }
  if (status === 500) {
    return { retryable: true, status, reason: 'gateway returned an early internal error' };
  }
  return { retryable: false, status, reason: 'failure is not attributable to API format' };
}

interface RememberedProtocol {
  protocol?: GatewayProtocol;
  expiresAt: number;
  cooldownUntil?: number;
}

const remembered = new Map<string, RememberedProtocol>();
const PREFERENCE_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
let loadedPersistentPath: string | null = null;

function persistentPath(): string {
  return join(getAppHome(), 'protocol-cache.json');
}

function loadPersistent(now = Date.now()): void {
  const path = persistentPath();
  if (loadedPersistentPath === path) return;
  remembered.clear();
  loadedPersistentPath = path;
  try {
    if (!existsSync(path)) return;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, RememberedProtocol>;
    for (const [key, entry] of Object.entries(raw)) {
      if (!entry || (entry.protocol !== undefined && entry.protocol !== 'openai' && entry.protocol !== 'anthropic')) continue;
      if (typeof entry.expiresAt !== 'number' || entry.expiresAt <= now) continue;
      if (entry.cooldownUntil !== undefined && typeof entry.cooldownUntil !== 'number') continue;
      remembered.set(key, entry);
    }
  } catch {
    // A corrupt preference file should never prevent a request from running.
  }
}

function savePersistent(): void {
  const path = persistentPath();
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const live: Record<string, RememberedProtocol> = {};
    const now = Date.now();
    for (const [key, entry] of remembered) {
      if (entry.expiresAt > now) live[key] = entry;
    }
    const tempPath = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(live)}\n`, { mode: 0o600 });
    renameSync(tempPath, path);
  } catch {
    // Preference caching is an optimization; the request path must continue.
  }
}

/** Build a non-secret cache key for one provider/model/configuration. */
export function protocolCacheKey(parts: {
  providerId?: string;
  modelId: string;
  protocol?: GatewayProtocol;
  baseURL?: string;
  alternativeURL?: string;
  apiKey?: string;
  headers?: Record<string, string>;
}): string {
  const credentialFingerprint = createHash('sha256')
    .update(parts.apiKey ?? '')
    .update('\0')
    .update(JSON.stringify(Object.entries(parts.headers ?? {}).sort(([a], [b]) => a.localeCompare(b))))
    .digest('hex');
  return createHash('sha256').update(JSON.stringify({
    providerId: parts.providerId ?? '',
    modelId: parts.modelId,
    protocol: parts.protocol ?? '',
    baseURL: parts.baseURL ?? '',
    alternativeURL: parts.alternativeURL ?? '',
    credentialFingerprint,
  })).digest('hex');
}

export function rememberedProtocol(key: string, now = Date.now()): GatewayProtocol | undefined {
  loadPersistent(now);
  const entry = remembered.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    remembered.delete(key);
    savePersistent();
    return undefined;
  }
  if (entry.cooldownUntil !== undefined && entry.cooldownUntil > now) return undefined;
  if (!entry.protocol) return undefined;
  return entry.protocol;
}

export function rememberProtocol(key: string, protocol: GatewayProtocol, now = Date.now()): void {
  loadPersistent(now);
  remembered.set(key, { protocol, expiresAt: now + PREFERENCE_TTL_MS });
  savePersistent();
}

export function protocolCooldownActive(key: string, now = Date.now()): boolean {
  loadPersistent(now);
  const entry = remembered.get(key);
  if (!entry) return false;
  if (entry.expiresAt <= now) {
    remembered.delete(key);
    savePersistent();
    return false;
  }
  return entry.cooldownUntil !== undefined && entry.cooldownUntil > now;
}

/** Suppress another alternate attempt briefly when both candidates failed. */
export function rememberProtocolFailure(key: string, now = Date.now()): void {
  loadPersistent(now);
  remembered.set(key, {
    expiresAt: now + PREFERENCE_TTL_MS,
    cooldownUntil: now + FAILURE_COOLDOWN_MS,
  });
  savePersistent();
}

export function clearRememberedProtocols(): void {
  remembered.clear();
  loadedPersistentPath = persistentPath();
  try { unlinkSync(loadedPersistentPath); } catch { /* already absent */ }
}
