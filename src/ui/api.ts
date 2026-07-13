import { getSupportedApps, getSupportedApp, getRelayLaunchCommand, detectApp } from '../native-launcher.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
import { existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { loadPreferences, recordLaunchFolder, savePreferences, setAppPathOverride } from '../config.js';
import { fetchProviderCatalog } from '../provider-catalog.js';
import { favoriteProviderDisplayName } from '../favorite-provider-display.js';
import { saveProviderCredential, resolveProviderCredential } from '../env.js';
import { readBody, sendJson } from '../http-utils.js';
import { loadRegistry } from '../registry/io.js';
import { refreshProviderModels, refreshAllProviderModels } from '../registry/refresh-models.js';
import { listAddableTemplates, listVisibleOAuthTemplates, PROVIDER_TEMPLATES } from '../provider-templates.js';
import { addProviderFromTemplate, type AddTemplateResult } from '../registry/add-template.js';
import { addCustomEndpointProvider, type CustomEndpointKind } from '../registry/custom-endpoint.js';
import { validateCustomEndpointUrl } from '../registry/url-security.js';
import { saveNativeOAuthCredential } from '../registry/provider-auth.js';
import { removeProviderFromRegistry } from '../registry/crud.js';
import { requestXaiDeviceCode, pollXaiDeviceCodeToken } from '../oauth/xai.js';
import { requestOpenAiDeviceCode, pollOpenAiDeviceCodeToken, openAiDeviceCodeUrl } from '../oauth/openai.js';
import { requestGithubDeviceCode, pollGithubDeviceCodeToken } from '../oauth/github.js';
import {
  guiCallbackRedirectUri,
} from '../oauth/claude-code.js';
import {
  buildAntigravityAuthUrl,
  completeAntigravityExchange,
} from '../oauth/antigravity-oauth.js';
import { writeSecureLogLine } from '../trace-log.js';
import { providerOptionsFromCatalog } from '../server/index.js';
import {
  getServerStatus,
  startGatewayServer,
  stopGatewayServer,
  type GatewayServerStartRequest,
  type ServerStartRequest,
} from './server-control.js';
import { freeStatusLabel } from '../free-models.js';

const MODELS_TIMEOUT_MS = 30_000;

export interface UiApiOptions {
  trace?: boolean;
  traceLogPath?: string;
}

// ── OAuth device-code session store ──────────────────────────────────────────
// Keyed by random session ID returned to the client. Sessions auto-purge on
// first terminal status read so the map doesn't grow unboundedly.

type OAuthSessionStatus = 'pending' | 'done' | 'error';

interface OAuthSession {
  status: OAuthSessionStatus;
  url: string;
  userCode?: string;          // device code flows only
  providerId: string;
  error?: string;
  // PKCE flows only — never sent to client:
  codeVerifier?: string;
  oauthState?: string;
  codeResolver?: (code: string) => void;
  errorRejecter?: (err: string) => void;
}

const oauthSessions = new Map<string, OAuthSession>();

async function fetchModelsWithTimeout(opts?: Parameters<typeof fetchProviderCatalog>[0]) {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), MODELS_TIMEOUT_MS),
  );
  return Promise.race([fetchProviderCatalog(opts), timeout]);
}

/** Shared 500/504 mapping for the two provider-catalog-fetching routes below. */
function sendCatalogFetchError(res: ServerResponse, err: unknown, label: string): void {
  const isTimeout = String(err).includes('timeout');
  sendJson(res, isTimeout ? 504 : 500, { error: isTimeout ? `${label} timed out` : String(err) });
}

function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
  } catch {
    return false;
  }
}

function sendCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  const originValue = Array.isArray(origin) ? origin[0] : origin;
  if (isLoopbackOrigin(originValue)) {
    res.setHeader('Access-Control-Allow-Origin', originValue!);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function traceUi(opts: UiApiOptions | undefined, message: string): void {
  if (!opts?.trace || !opts.traceLogPath) return;
  writeSecureLogLine(opts.traceLogPath, `${new Date().toISOString()} ${message}`);
}

export function handleUiApiRequest(req: IncomingMessage, res: ServerResponse, opts: UiApiOptions = {}): void {
  sendCors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = req.url ?? '';
  traceUi(opts, `${req.method ?? 'GET'} ${url}`);

  if (url === '/api/config' && req.method === 'GET') {
    handleGetConfig(res);
  } else if (url === '/api/config' && req.method === 'POST') {
    handlePostConfig(req, res);
  } else if (url === '/api/models' && req.method === 'GET') {
    handleGetModels(res);
  } else if (url === '/api/keys' && req.method === 'POST') {
    handlePostKeys(req, res);
  } else if (url === '/api/providers/refresh' && req.method === 'POST') {
    handleProviderRefresh(req, res);
  } else if (url === '/api/providers/refresh-all' && req.method === 'POST') {
    handleRefreshAll(res);
  } else if (url === '/api/providers/templates' && req.method === 'GET') {
    handleGetTemplates(res);
  } else if (url === '/api/providers/add' && req.method === 'POST') {
    handleAddProvider(req, res);
  } else if (url === '/api/providers/add-custom' && req.method === 'POST') {
    handleAddCustomProvider(req, res);
  } else if (url === '/api/providers/delete' && req.method === 'POST') {
    handleDeleteProvider(req, res);
  } else if (url === '/api/providers/oauth/start' && req.method === 'POST') {
    handleOAuthStart(req, res);
  } else if (url.startsWith('/api/providers/oauth/status') && req.method === 'GET') {
    handleOAuthStatus(req, res);
  } else if (url.startsWith('/oauth/callback') && req.method === 'GET') {
    handleOAuthCallback(req, res);
  } else if (url === '/api/apps' && req.method === 'GET') {
    handleGetApps(res);
  } else if (url === '/api/apps/path' && req.method === 'POST') {
    handleSetAppPath(req, res);
  } else if (url === '/api/apps/launch' && req.method === 'POST') {
    handleLaunchApp(req, res, opts);
  } else if (url === '/api/apps/browse-folder' && req.method === 'POST') {
    handleBrowseFolder(res);
  } else if (url === '/api/server/status' && req.method === 'GET') {
    handleGetServerStatus(res);
  } else if (url === '/api/server/providers' && req.method === 'GET') {
    handleGetServerProviders(res);
  } else if (url === '/api/server/start' && req.method === 'POST') {
    handleStartServer(req, res);
  } else if (url === '/api/server/stop' && req.method === 'POST') {
    handleStopServer(res);
  } else {
    sendJson(res, 404, { error: 'Not found' });
  }
}

function handleGetConfig(res: ServerResponse): void {
  const prefs = loadPreferences();
  sendJson(res, 200, {
    favoriteModels: prefs.favoriteModels ?? [],
    antigravityCliFavoriteModels: prefs.antigravityCliFavoriteModels ?? [],
  });
}

async function handlePostConfig(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req));
    const update: Parameters<typeof savePreferences>[0] = {};
    if (Array.isArray(body.favoriteModels)) update.favoriteModels = body.favoriteModels;
    if (Array.isArray(body.antigravityCliFavoriteModels)) update.antigravityCliFavoriteModels = body.antigravityCliFavoriteModels;
    if (Object.keys(update).length > 0) savePreferences(update);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 400, { error: String(err) });
  }
}

async function handleGetModels(res: ServerResponse): Promise<void> {
  try {
    const catalog = await fetchModelsWithTimeout();
    const registry = loadRegistry();
    const rawCountById = new Map(registry.providers.map(p => [p.id, p.modelsCache?.models.length ?? 0]));
    const providers = catalog.map(p => ({
      id: p.id,
      name: p.name,
      favoriteName: favoriteProviderDisplayName(p),
      hasKey: Boolean(p.apiKey),
      freeAccess: !p.apiKey && (() => {
        const t = (registry.providers.find(rp => rp.id === p.id)?.templateId ?? p.id);
        const { getTemplateById } = require('../provider-templates.js');
        return getTemplateById(t)?.anonymousFreeModels === true;
      })(),
      authType: p.authType ?? 'api',
      modelCount: rawCountById.get(p.id) ?? p.models.length,
      models: p.models.map(m => ({
        id: m.id,
        name: m.name,
        isFree: m.isFree ?? false,
        freeStatus: m.freeStatus,
        freeLabel: freeStatusLabel(m.freeStatus),
        contextWindow: m.contextWindow,
        cost: m.cost,
      })),
    }));

    // OAuth providers with 0 models are excluded by materializeOne (no models = not materialized).
    // Surface them anyway so their card appears and the user can click Refresh Models.
    const materializedIds = new Set(catalog.map(p => p.id));
    for (const rp of registry.providers) {
      if (rp.authType !== 'oauth' || !rp.enabled || materializedIds.has(rp.id)) continue;
      const credential = await resolveProviderCredential(rp.id, rp.authRef).catch(() => null);
      if (!credential) continue;
      providers.push({
        id: rp.id,
        name: rp.name,
        favoriteName: favoriteProviderDisplayName({ id: rp.id, name: rp.name, authType: rp.authType }),
        hasKey: true,
        freeAccess: false,
        authType: 'oauth',
        modelCount: 0,
        models: [],
      });
    }

    sendJson(res, 200, { providers });
  } catch (err) {
    sendCatalogFetchError(res, err, 'Model fetch');
  }
}

async function handlePostKeys(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req));
    const { providerId, key } = body;
    if (!providerId || typeof providerId !== 'string') {
      sendJson(res, 400, { error: 'providerId required' }); return;
    }
    if (!key || typeof key !== 'string' || key.trim().length === 0) {
      sendJson(res, 400, { error: 'key must be a non-empty string' }); return;
    }
    const authRef = `keyring:provider:${providerId}`;
    const saved = await saveProviderCredential(authRef, key.trim());
    if (saved) {
      sendJson(res, 200, { ok: true });
    } else {
      sendJson(res, 500, { error: 'Keychain unavailable — key not saved' });
    }
  } catch (err) {
    sendJson(res, 400, { error: String(err) });
  }
}

const CUSTOM_TEMPLATES = [
  { id: '__custom_openai__', name: 'Custom OpenAI-compatible', signupUrl: null, authType: 'api', custom: true },
  { id: '__custom_anthropic__', name: 'Custom Anthropic-compatible', signupUrl: null, authType: 'api', custom: true },
] as const;

function handleGetTemplates(res: ServerResponse): void {
  const registry = loadRegistry();
  const configured = new Set(registry.providers.map(p => p.id));

  const apiTemplates = listAddableTemplates(configured).map(t => ({
    id: t.id,
    name: t.name,
    signupUrl: t.signupUrl ?? null,
    authType: t.authType,
    anonymousFreeModels: t.anonymousFreeModels ?? false,
    urlPrompt: t.urlPrompt ?? null,
    defaultBaseUrl: t.defaultBaseUrl ?? null,
    apiKeyOptional: t.apiKeyOptional ?? false,
    custom: false,
  }));

  const oauthTemplates = listVisibleOAuthTemplates(configured)
    .map(t => ({
      id: t.id,
      name: t.name,
      signupUrl: t.signupUrl ?? null,
      authType: t.authType,
      subscriptionRisk: t.subscriptionRisk ?? false,
      custom: false,
    }));

  sendJson(res, 200, { templates: [...apiTemplates, ...oauthTemplates, ...CUSTOM_TEMPLATES] });
}

async function handleAddCustomProvider(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req)) as {
      kind?: string; displayName?: string; baseUrl?: string; apiKey?: string; headers?: Record<string, string>;
    };
    const { kind, displayName, baseUrl, apiKey = '', headers } = body;
    if (kind !== 'openai' && kind !== 'anthropic') {
      sendJson(res, 400, { error: 'kind must be "openai" or "anthropic"' }); return;
    }
    if (!displayName?.trim()) {
      sendJson(res, 400, { error: 'displayName required' }); return;
    }
    if (!baseUrl?.trim()) {
      sendJson(res, 400, { error: 'baseUrl required' }); return;
    }
    const result = await addCustomEndpointProvider({
      kind: kind as CustomEndpointKind,
      displayName: displayName.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      allowInsecureLocal: true,
      headers: headers && Object.keys(headers).length > 0 ? headers : undefined,
    });
    if (result.added) {
      sendJson(res, 200, { ok: true, name: displayName.trim(), count: result.modelCount ?? 0 });
    } else {
      sendJson(res, 200, { ok: false, error: result.error, hint: result.hint });
    }
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}

async function handleAddProvider(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req));
    const { templateId, key, baseUrl } = body;
    if (!templateId || typeof templateId !== 'string') {
      sendJson(res, 400, { error: 'templateId required' }); return;
    }
    const { listSupportedTemplates } = await import('../provider-templates.js');
    const template = listSupportedTemplates().find(t => t.id === templateId);
    if (!template) {
      sendJson(res, 404, { error: `Template '${templateId}' not found` }); return;
    }
    const rawKey = typeof key === 'string' ? key.trim() : '';
    if (!rawKey && !template.anonymousFreeModels && !template.apiKeyOptional) {
      sendJson(res, 400, { error: 'key must be a non-empty string' }); return;
    }
    const keyText = template.apiKeyOptional && !rawKey && !template.anonymousFreeModels ? template.id : rawKey;

    let baseUrlOverride: string | undefined;
    if (template.urlPrompt) {
      baseUrlOverride = typeof baseUrl === 'string' ? baseUrl.trim() : '';
      if (!baseUrlOverride) {
        sendJson(res, 400, { error: 'baseUrl required' }); return;
      }
      const usesHttp = /^http:\/\//i.test(baseUrlOverride);
      const valid = await validateCustomEndpointUrl(baseUrlOverride, { allowInsecureLocal: usesHttp });
      if (!valid.ok) {
        sendJson(res, 400, { error: valid.error ?? 'Invalid URL', hint: valid.hint }); return;
      }
    }

    const result: AddTemplateResult = await addProviderFromTemplate(template, keyText, { baseUrl: baseUrlOverride });
    if (result.added) {
      sendJson(res, 200, { ok: true, name: template.name, count: result.modelCount ?? 0 });
    } else {
      sendJson(res, 200, { ok: false, error: result.error, hint: result.hint });
    }
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}

async function handleRefreshAll(res: ServerResponse): Promise<void> {
  try {
    const result = await refreshAllProviderModels(async provider => {
      if (!provider.authRef) return null;
      return resolveProviderCredential(provider.id, provider.authRef);
    });
    // Return per-provider summary: id, name, ok, count
    const summary = result.refreshed.map(r => {
      // OAuth providers can't refresh model lists via the standard API endpoint —
      // the token is for user sessions, not model discovery. This is expected, not broken.
      const isOAuthExpected = !r.ok && !r.skipped && r.reason?.includes('OAuth token');
      return {
        id: r.id,
        name: r.name,
        ok: r.ok || isOAuthExpected,
        count: r.modelCount ?? r.previousModelCount ?? 0,
        skipped: r.skipped ?? isOAuthExpected,
        oauthWarning: isOAuthExpected,
        reason: r.reason,
      };
    });
    sendJson(res, 200, { ok: true, providers: summary, total: summary.reduce((n, p) => n + p.count, 0) });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err) });
  }
}

async function handleProviderRefresh(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req));
    const { providerId } = body;
    if (!providerId || typeof providerId !== 'string') {
      sendJson(res, 400, { error: 'providerId required' }); return;
    }
    const registry = loadRegistry();
    const registryProvider = registry.providers.find(p => p.id === providerId);
    if (!registryProvider) {
      sendJson(res, 200, { ok: false, error: 'Provider not found in registry' }); return;
    }
    // Resolve credential via authRef (covers both API keys and OAuth tokens)
    const apiKey = await resolveProviderCredential(providerId, registryProvider.authRef);
    // Use the same refresh path as `relay-ai providers refresh-models` so counts match CLI
    const result = await refreshProviderModels(providerId, apiKey, registry);
    if (result.ok) {
      sendJson(res, 200, { ok: true, count: result.modelCount ?? result.previousModelCount ?? 0 });
    } else {
      sendJson(res, 200, { ok: false, error: result.reason ?? 'Refresh failed' });
    }
  } catch (err) {
    sendJson(res, 200, { ok: false, error: String(err) });
  }
}

async function handleDeleteProvider(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req)) as { providerId?: string };
    const { providerId } = body;
    if (!providerId || typeof providerId !== 'string') {
      sendJson(res, 400, { error: 'providerId required' }); return;
    }
    const result = await removeProviderFromRegistry(providerId);
    if (result.removed) {
      sendJson(res, 200, { ok: true, name: result.name });
    } else {
      sendJson(res, 200, { ok: false, error: result.error ?? 'Provider not found' });
    }
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}

const DEVICE_CODE_PROVIDER_IDS = new Set(['xai-oauth', 'openai-oauth', 'github-copilot']);
const PKCE_PROVIDER_IDS = new Set(['claude-code', 'antigravity']);
const NATIVE_OAUTH_PROVIDER_IDS = new Set([...DEVICE_CODE_PROVIDER_IDS, ...PKCE_PROVIDER_IDS]);

async function refreshOAuthProviderModels(providerId: string): Promise<void> {
  const registry = loadRegistry();
  const entry = registry.providers.find(p => p.id === providerId);
  if (!entry) return;
  const apiKey = await resolveProviderCredential(providerId, entry.authRef);
  await refreshProviderModels(providerId, apiKey, registry);
}

async function handleOAuthStart(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req)) as { providerId?: string };
    const { providerId } = body;
    if (!providerId || !NATIVE_OAUTH_PROVIDER_IDS.has(providerId)) {
      sendJson(res, 400, { error: `providerId must be one of: ${[...NATIVE_OAUTH_PROVIDER_IDS].join(', ')}` }); return;
    }

    const sessionId = randomUUID();

    if (providerId === 'xai-oauth') {
      const device = await requestXaiDeviceCode();
      const url = device.verification_uri_complete ?? device.verification_uri;
      const session: OAuthSession = { status: 'pending', url, userCode: device.user_code, providerId };
      oauthSessions.set(sessionId, session);

      pollXaiDeviceCodeToken(device).then(async tokens => {
        await saveNativeOAuthCredential(providerId, tokens);
        await refreshOAuthProviderModels(providerId);
        oauthSessions.set(sessionId, { ...session, status: 'done' });
      }).catch(err => {
        oauthSessions.set(sessionId, { ...session, status: 'error', error: String(err) });
      });

      sendJson(res, 200, { sessionId, url, userCode: device.user_code });
      return;
    }

    if (providerId === 'github-copilot') {
      const device = await requestGithubDeviceCode();
      const url = device.verification_uri;
      const session: OAuthSession = { status: 'pending', url, userCode: device.user_code, providerId };
      oauthSessions.set(sessionId, session);

      pollGithubDeviceCodeToken(device).then(async tokens => {
        await saveNativeOAuthCredential(providerId, tokens);
        await refreshOAuthProviderModels(providerId);
        oauthSessions.set(sessionId, { ...session, status: 'done' });
      }).catch(err => {
        oauthSessions.set(sessionId, { ...session, status: 'error', error: String(err) });
      });

      sendJson(res, 200, { sessionId, url, userCode: device.user_code });
      return;
    }

    if (PKCE_PROVIDER_IDS.has(providerId)) {
      if (providerId === 'claude-code') {
        sendJson(res, 400, {
          error: 'Claude Code OAuth must be completed in the terminal: relay-ai providers auth claude-code',
        });
        return;
      }

      // PKCE / browser-redirect flow (claude-code, future: antigravity).
      const host = (req.headers.host as string | undefined) ?? '127.0.0.1';
      const redirectUri = guiCallbackRedirectUri(host);

      let pkce: Awaited<ReturnType<typeof buildAntigravityAuthUrl>>;
      if (providerId === 'antigravity') {
        pkce = await buildAntigravityAuthUrl(redirectUri);
      } else {
        sendJson(res, 400, { error: `PKCE flow for "${providerId}" not yet implemented` }); return;
      }

      const { authUrl, codeVerifier, oauthState } = pkce;
      const session: OAuthSession = {
        status: 'pending',
        url: authUrl,
        providerId,
        codeVerifier,
        oauthState,
      };
      oauthSessions.set(sessionId, session);

      // The callback route will call session.codeResolver when the code arrives.
      const codePromise = new Promise<string>((resolve, reject) => {
        session.codeResolver = resolve;
        session.errorRejecter = (err: string) => reject(new Error(err));
        setTimeout(() => reject(new Error('OAuth timeout — sign-in not completed')), 10 * 60 * 1000);
      });
      oauthSessions.set(sessionId, session); // re-set with resolvers attached

      codePromise.then(async (code) => {
        let providerData: Record<string, unknown> = {};
        let accountId: string | undefined;
        let tokens: import('../oauth/types.js').OAuthTokenResponse;

        if (providerId === 'antigravity') {
          const result = await completeAntigravityExchange(code, codeVerifier, redirectUri);
          tokens = result.tokens;
          accountId = result.userInfo.email;
          if (result.projectId) providerData.projectId = result.projectId;
          if (result.tierId) providerData.tier = result.tierId;
        } else {
          throw new Error(`Unknown PKCE provider: ${providerId}`);
        }

        await saveNativeOAuthCredential(providerId, tokens, accountId, providerData);

        await refreshOAuthProviderModels(providerId);
        oauthSessions.set(sessionId, { ...session, status: 'done' });
      }).catch(err => {
        oauthSessions.set(sessionId, { ...session, status: 'error', error: String(err) });
      });

      sendJson(res, 200, { sessionId, authUrl, pkce: true });
      return;
    }

    // openai-oauth
    const device = await requestOpenAiDeviceCode();
    const url = openAiDeviceCodeUrl();
    const session: OAuthSession = { status: 'pending', url, userCode: device.user_code, providerId };
    oauthSessions.set(sessionId, session);

    pollOpenAiDeviceCodeToken(device).then(async ({ tokens, accountId }) => {
      await saveNativeOAuthCredential(providerId, tokens, accountId);
      await refreshOAuthProviderModels(providerId);
      oauthSessions.set(sessionId, { ...session, status: 'done' });
    }).catch(err => {
      oauthSessions.set(sessionId, { ...session, status: 'error', error: String(err) });
    });

    sendJson(res, 200, { sessionId, url, userCode: device.user_code });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}

function handleOAuthStatus(req: IncomingMessage, res: ServerResponse): void {
  const searchParams = new URL(req.url ?? '', 'http://localhost').searchParams;
  const sessionId = searchParams.get('sessionId') ?? '';
  const session = oauthSessions.get(sessionId);
  if (!session) { sendJson(res, 404, { error: 'Session not found or expired' }); return; }
  sendJson(res, 200, { status: session.status, error: session.error });
  if (session.status !== 'pending') oauthSessions.delete(sessionId);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function callbackPage(type: 'success' | 'error', message: string): string {
  const icon = type === 'success' ? '&#10003;' : '&#10007;';
  const color = type === 'success' ? '#22c55e' : '#ef4444';
  const title = type === 'success' ? 'Authentication successful' : 'Authentication failed';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0">
<div style="text-align:center;padding:2rem;background:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.1);max-width:400px">
<div style="color:${color};font-size:2.5rem">${icon}</div>
<h1 style="margin:.5rem 0">${title}</h1>
<p style="color:#666">${escapeHtml(message)}</p>
</div></body></html>`;
}

function handleOAuthCallback(req: IncomingMessage, res: ServerResponse): void {
  const sp = new URL(req.url ?? '', 'http://localhost').searchParams;
  const code = sp.get('code') ?? '';
  const state = sp.get('state') ?? '';
  const error = sp.get('error') ?? '';

  let matchedSession: OAuthSession | undefined;
  for (const session of oauthSessions.values()) {
    if (session.oauthState === state) { matchedSession = session; break; }
  }

  if (!matchedSession) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(callbackPage('error', 'Unknown or expired OAuth session. Please try signing in again.'));
    return;
  }

  if (error) {
    matchedSession.errorRejecter?.(error);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(callbackPage('error', `Authorization denied: ${error}`));
    return;
  }

  if (!code) {
    matchedSession.errorRejecter?.('No authorization code received');
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(callbackPage('error', 'No authorization code received. Please try again.'));
    return;
  }

  matchedSession.codeResolver?.(code);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(callbackPage('success', 'You can close this tab and return to relay-ai.'));
}

function handleGetApps(res: ServerResponse): void {
  try {
    const apps = getSupportedApps();
    sendJson(res, 200, { apps, recentLaunchFolders: loadPreferences().recentLaunchFolders ?? [] });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}

const AGY_APP_IDS = new Set(['antigravity', 'agy', 'antigravity-ide']);

async function handleLaunchApp(req: IncomingMessage, res: ServerResponse, opts: UiApiOptions): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req));
    const { appId, favorites, cwd } = body;
    let { providerId, modelId } = body as { providerId?: string; modelId?: string };
    if (!appId) {
      sendJson(res, 400, { error: 'Missing appId' });
      return;
    }
    if (!getSupportedApp(appId)) {
      sendJson(res, 400, { error: `Unknown app: ${appId}` });
      return;
    }

    const { installed, path } = detectApp(appId);
    if (!installed || !path) {
      sendJson(res, 400, { error: `App ${appId} is not installed on this system.` });
      return;
    }

    if (!favorites && (providerId || modelId) && (!providerId || !modelId)) {
      sendJson(res, 400, { error: 'Both providerId and modelId are required to launch a specific Relay model.' });
      return;
    }

    // Resolve the first favorite so the terminal can skip its interactive picker.
    // Without this the launch command has no --provider/--model and the terminal
    // shows the full provider wizard even though the user already chose "Favorites".
    if (favorites && !providerId && !modelId) {
      const prefs = loadPreferences();
      const favList = AGY_APP_IDS.has(appId)
        ? (prefs.antigravityCliFavoriteModels ?? [])
        : (prefs.favoriteModels ?? []);
      if (favList.length > 0) {
        providerId = favList[0]!.providerId;
        modelId = favList[0]!.modelId;
      }
    }

    const launchFolder = typeof cwd === 'string' && cwd.trim() ? cwd.trim() : undefined;
    if (launchFolder) {
      try {
        if (!statSync(launchFolder).isDirectory()) {
          sendJson(res, 400, { error: 'Launch folder must be a directory.' });
          return;
        }
      } catch {
        sendJson(res, 400, { error: 'Launch folder does not exist.' });
        return;
      }
      recordLaunchFolder(launchFolder);
    }

    const launchCmd = getRelayLaunchCommand(appId, {
      providerId,
      modelId,
      cwd: launchFolder,
      trace: opts.trace,
    });
    traceUi(
      opts,
      `launch app=${appId} provider=${providerId ?? ''} model=${modelId ?? ''} favorites=${Boolean(favorites)} resolved-from-favorites=${Boolean(favorites && providerId)} cwd=${launchFolder ?? ''} command=${launchCmd}`,
    );

    // Execute command asynchronously to open the terminal window detached
    exec(launchCmd, (err) => {
      if (err) {
        traceUi(opts, `launch error app=${appId} error=${err.message}`);
        console.error('Failed to spawn native terminal window:', err);
      }
    });

    sendJson(res, 200, { ok: true, command: launchCmd });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}

async function handleSetAppPath(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req));
    const { appId, path } = body;
    if (!appId || typeof appId !== 'string') {
      sendJson(res, 400, { error: 'Missing appId' });
      return;
    }

    if (path !== null && (typeof path !== 'string' || !path.trim())) {
      sendJson(res, 400, { error: 'path must be a non-empty string, or null to clear the override.' });
      return;
    }

    const trimmed = typeof path === 'string' ? path.trim() : null;
    if (trimmed && !existsSync(trimmed)) {
      sendJson(res, 400, { error: 'That path does not exist.' });
      return;
    }

    setAppPathOverride(appId, trimmed);
    sendJson(res, 200, { ok: true, apps: getSupportedApps() });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}

async function handleGetServerStatus(res: ServerResponse): Promise<void> {
  try {
    sendJson(res, 200, await getServerStatus());
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}

async function handleGetServerProviders(res: ServerResponse): Promise<void> {
  try {
    const catalog = await fetchModelsWithTimeout({ agent: 'server' });
    sendJson(res, 200, { providers: providerOptionsFromCatalog(catalog) });
  } catch (err) {
    sendCatalogFetchError(res, err, 'Provider fetch');
  }
}

async function handleStartServer(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req)) as Omit<Partial<GatewayServerStartRequest>, 'mode'> & {
      mode?: unknown;
    };
    if (body.mode === 'http-proxy') {
      const result = await startGatewayServer({ mode: 'http-proxy' });
      sendJson(res, 200, result);
      return;
    }
    if (body.mode !== undefined && body.mode !== 'gateway') {
      sendJson(res, 400, { error: 'mode must be "gateway" or "http-proxy"' }); return;
    }
    if (typeof body.favoritesOnly !== 'boolean') {
      sendJson(res, 400, { error: 'favoritesOnly must be a boolean' }); return;
    }
    if (typeof body.maskGatewayIds !== 'boolean') {
      sendJson(res, 400, { error: 'maskGatewayIds must be a boolean' }); return;
    }
    if (body.listenMode !== 'local' && body.listenMode !== 'network') {
      sendJson(res, 400, { error: 'listenMode must be "local" or "network"' }); return;
    }
    const request: ServerStartRequest = {
      mode: 'gateway',
      favoritesOnly: body.favoritesOnly,
      freeModelsOnly: Boolean(body.freeModelsOnly),
      exposedProviders: Array.isArray(body.exposedProviders) ? body.exposedProviders : null,
      maskGatewayIds: body.maskGatewayIds,
      listenMode: body.listenMode,
      passwordMode: body.passwordMode === 'saved' ? 'saved' : 'new',
      password: typeof body.password === 'string' ? body.password : undefined,
      savePassword: Boolean(body.savePassword),
    };
    const result = await startGatewayServer(request);
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err) });
  }
}

async function handleStopServer(res: ServerResponse): Promise<void> {
  try {
    sendJson(res, 200, await stopGatewayServer());
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}

async function handleBrowseFolder(res: ServerResponse): Promise<void> {
  try {
    let resultPath = '';
    const isMac = process.platform === 'darwin';
    const isWindows = process.platform === 'win32';

    if (isMac) {
      const script = 'POSIX path of (choose folder with prompt "Select launch folder:")';
      try {
        const { stdout } = await execAsync(`osascript -e '${script}'`);
        resultPath = stdout.trim();
      } catch (err: any) {
        if (err.code === 1 || String(err.stderr).includes('-128') || String(err.stdout).includes('-128')) {
          sendJson(res, 200, { ok: true, canceled: true });
          return;
        }
        throw err;
      }
    } else if (isWindows) {
      // The try/catch + exit 1 is load-bearing: without it PowerShell reports
      // dialog failures (e.g. "not running in UserInteractive mode" when the
      // UI server was started from a non-interactive session like SSH) as
      // non-terminating errors and still exits 0 with empty stdout, which
      // looks identical to the user canceling.
      //
      // The owner form must be Show()n (invisible: opacity 0, 1x1, no
      // border/taskbar) — WinForms only applies TopMost to the native handle
      // when the form is actually shown, and without a shown TopMost owner
      // the dialog opens at the bottom of the z-order, behind the browser,
      // with no taskbar button: it exists but the user never sees it.
      const psCommand = [
        'try {',
        '  Add-Type -AssemblyName System.Windows.Forms',
        '  $f = New-Object System.Windows.Forms.FolderBrowserDialog',
        '  $f.Description = "Select launch folder"',
        '  $owner = New-Object System.Windows.Forms.Form',
        '  $owner.TopMost = $true',
        '  $owner.ShowInTaskbar = $false',
        '  $owner.FormBorderStyle = "None"',
        '  $owner.Opacity = 0',
        '  $owner.Width = 1',
        '  $owner.Height = 1',
        '  $owner.StartPosition = "CenterScreen"',
        '  $owner.Show()',
        '  $owner.Activate()',
        '  if ($f.ShowDialog($owner) -eq "OK") { $f.SelectedPath }',
        '  $owner.Close()',
        '} catch {',
        '  [Console]::Error.WriteLine($_.Exception.Message)',
        '  exit 1',
        '}',
      ].join('\n');
      try {
        // -Sta is required: System.Windows.Forms dialogs throw
        // ThreadStateException under PowerShell's default MTA apartment state.
        // -EncodedCommand sidesteps cmd.exe quoting: -Command "..." mangled
        // the script (its newlines were never actually stripped).
        const encoded = Buffer.from(psCommand, 'utf16le').toString('base64');
        const { stdout } = await execAsync(`powershell -NoProfile -Sta -EncodedCommand ${encoded}`);
        resultPath = stdout.trim();
      } catch (err) {
        sendJson(res, 500, { error: `Failed to open folder picker: ${err instanceof Error ? err.message : String(err)}` });
        return;
      }
    } else {
      try {
        const { stdout } = await execAsync('zenity --file-selection --directory --title="Select launch folder"');
        resultPath = stdout.trim();
      } catch {
        try {
          const { stdout } = await execAsync('kdialog --getexistingdirectory .');
          resultPath = stdout.trim();
        } catch {
          sendJson(res, 500, { error: 'No GUI folder picker available on this platform' });
          return;
        }
      }
    }

    if (!resultPath) {
      sendJson(res, 200, { ok: true, canceled: true });
      return;
    }

    sendJson(res, 200, { ok: true, path: resultPath });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}
