import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { loadPreferences, savePreferences } from '../config.js';
import { fetchProviderCatalog } from '../provider-catalog.js';
import { saveProviderCredential, resolveProviderCredential } from '../env.js';
import { readBody, sendJson } from '../http-utils.js';
import { loadRegistry } from '../registry/io.js';
import { refreshProviderModels, refreshAllProviderModels } from '../registry/refresh-models.js';
import { listAddableTemplates, PROVIDER_TEMPLATES } from '../provider-templates.js';
import { addProviderFromTemplate, type AddTemplateResult } from '../registry/add-template.js';
import { addCustomEndpointProvider, type CustomEndpointKind } from '../registry/custom-endpoint.js';
import { saveNativeOAuthCredential } from '../registry/provider-auth.js';
import { removeProviderFromRegistry } from '../registry/crud.js';
import { requestXaiDeviceCode, pollXaiDeviceCodeToken } from '../oauth/xai.js';
import { requestOpenAiDeviceCode, pollOpenAiDeviceCodeToken, openAiDeviceCodeUrl } from '../oauth/openai.js';
import {
  buildClaudeCodeAuthUrl,
  completeClaudeCodeExchange,
  generateCliUserID,
  guiCallbackRedirectUri,
} from '../oauth/claude-code.js';
import {
  buildAntigravityAuthUrl,
  completeAntigravityExchange,
} from '../oauth/antigravity-oauth.js';

const MODELS_TIMEOUT_MS = 30_000;

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

async function fetchModelsWithTimeout() {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), MODELS_TIMEOUT_MS),
  );
  return Promise.race([fetchProviderCatalog(), timeout]);
}

function sendCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export function handleUiApiRequest(req: IncomingMessage, res: ServerResponse): void {
  sendCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = req.url ?? '';

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
    const providers = catalog.localProviders.map(p => ({
      id: p.id,
      name: p.name,
      hasKey: Boolean(p.apiKey),
      authType: p.authType ?? 'api',
      modelCount: rawCountById.get(p.id) ?? p.models.length,
      models: p.models.map(m => ({ id: m.id, name: m.name })),
    }));

    // OAuth providers with 0 models are excluded by materializeOne (no models = not materialized).
    // Surface them anyway so their card appears and the user can click Refresh Models.
    const materializedIds = new Set(catalog.localProviders.map(p => p.id));
    for (const rp of registry.providers) {
      if (rp.authType !== 'oauth' || !rp.enabled || materializedIds.has(rp.id)) continue;
      const credential = await resolveProviderCredential(rp.id, rp.authRef).catch(() => null);
      if (!credential) continue;
      providers.push({
        id: rp.id,
        name: rp.name,
        hasKey: true,
        authType: 'oauth',
        modelCount: 0,
        models: [],
      });
    }

    sendJson(res, 200, {
      providers,
      zenModels: catalog.zenModels.map(m => ({ id: m.id, name: m.name, providerId: 'zen', providerName: 'OpenCode Zen', contextWindow: m.contextWindow })),
      goModels: catalog.goModels.map(m => ({ id: m.id, name: m.name, providerId: 'go', providerName: 'OpenCode Go', contextWindow: m.contextWindow })),
    });
  } catch (err) {
    const isTimeout = String(err).includes('timeout');
    sendJson(res, isTimeout ? 504 : 500, { error: isTimeout ? 'Model fetch timed out' : String(err) });
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
    custom: false,
  }));

  const oauthTemplates = PROVIDER_TEMPLATES
    .filter(t => t.authType === 'oauth' && t.supported && t.addable !== false && !configured.has(t.id))
    .sort((a, b) => a.name.localeCompare(b.name))
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
      kind?: string; displayName?: string; baseUrl?: string; apiKey?: string;
    };
    const { kind, displayName, baseUrl, apiKey = '' } = body;
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
    const { templateId, key } = body;
    if (!templateId || typeof templateId !== 'string') {
      sendJson(res, 400, { error: 'templateId required' }); return;
    }
    if (!key || typeof key !== 'string' || !key.trim()) {
      sendJson(res, 400, { error: 'key must be a non-empty string' }); return;
    }
    const { listSupportedTemplates } = await import('../provider-templates.js');
    const template = listSupportedTemplates().find(t => t.id === templateId);
    if (!template) {
      sendJson(res, 404, { error: `Template '${templateId}' not found` }); return;
    }
    const result: AddTemplateResult = await addProviderFromTemplate(template, key.trim());
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

const DEVICE_CODE_PROVIDER_IDS = new Set(['xai-oauth', 'openai-oauth']);
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

    if (PKCE_PROVIDER_IDS.has(providerId)) {
      // PKCE / browser-redirect flow (claude-code, future: antigravity).
      const host = (req.headers.host as string | undefined) ?? '127.0.0.1';
      const redirectUri = guiCallbackRedirectUri(host);

      let pkce: Awaited<ReturnType<typeof buildClaudeCodeAuthUrl>>;
      if (providerId === 'claude-code') {
        pkce = await buildClaudeCodeAuthUrl(redirectUri);
      } else if (providerId === 'antigravity') {
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

        if (providerId === 'claude-code') {
          const result = await completeClaudeCodeExchange(
            code, codeVerifier, oauthState, redirectUri,
          );
          tokens = result.tokens;
          const { bootstrap } = result;
          providerData = { cliUserID: generateCliUserID() };
          if (bootstrap.accountId) { providerData.accountUUID = bootstrap.accountId; accountId = bootstrap.accountId; }
          if (bootstrap.organizationId) providerData.organizationUUID = bootstrap.organizationId;
          if (bootstrap.organizationName) providerData.organizationName = bootstrap.organizationName;
          if (bootstrap.plan) providerData.plan = bootstrap.plan;
        } else if (providerId === 'antigravity') {
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
