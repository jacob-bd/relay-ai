// In-process lifecycle for the `relay-ai server` gateway, launched from the web UI.
// Runs inside the same Node process as `relay-ai ui` — no child process, no PID file.
// Stops automatically when the UI process exits, same as closing a terminal running
// `relay-ai server` with Ctrl+C.

import { BACKENDS, MAX_MODEL_CATALOG } from '../constants.js';
import {
  getSavedServerPassword,
  getServerExposedProviders,
  getServerFavoritesOnly,
  getServerFreeModelsOnly,
  getServerListenMode,
  getServerMaskGatewayIds,
  loadPreferences,
  setSavedServerPassword,
  setServerExposedProviders,
  setServerFavoritesOnly,
  setServerFreeModelsOnly,
  setServerListenMode,
  setServerMaskGatewayIds,
} from '../config.js';
import type { FavoriteModel } from '../types.js';
import { startServer, type ServerHandle } from '../server/router.js';
import {
  buildDedupedModelRows,
  createGatewayModelCatalog,
  gatewayProviderLabel,
  type GatewayModelOptions,
  type ServerModelInfo,
} from '../server/models.js';
import {
  filterServerModelsByFavorites,
  filterServerModelsByFreeStatus,
  filterServerModelsByProviders,
  summarizeServerProviders,
} from '../server/catalog-filter.js';
import { getLocalIps, loadServerModels, resolveServerUpstreamApiKey } from '../server/index.js';
import {
  startConfiguredHttpProxy,
  type LoadedHttpProxyRoutes,
} from '../http-proxy/index.js';
import type { HttpProxyHandle } from '../http-proxy/server.js';
import { getInferenceRequestLogPath } from '../trace-log.js';

export type ServerListenMode = 'local' | 'network';
export type UiServerMode = 'gateway' | 'http-proxy';

export interface GatewayServerStartRequest {
  mode?: 'gateway';
  favoritesOnly: boolean;
  freeModelsOnly: boolean;
  exposedProviders: string[] | null;
  maskGatewayIds: boolean;
  listenMode: ServerListenMode;
  /** Only relevant when listenMode is 'network'. */
  passwordMode?: 'saved' | 'new';
  password?: string;
  savePassword?: boolean;
}

export interface HttpProxyServerStartRequest {
  mode: 'http-proxy';
}

export type ServerStartRequest = GatewayServerStartRequest | HttpProxyServerStartRequest;

type RunningConfig = Omit<GatewayServerStartRequest, 'mode' | 'passwordMode' | 'password' | 'savePassword'>;

interface GatewayRunningState {
  mode: 'gateway';
  handle: ServerHandle;
  config: RunningConfig;
  serverPassword: string | null;
  /** Derived once from `models` at start time — the exposed model set never changes while running. */
  providerSummary: string;
  modelRows: ServerModelRow[];
}

interface HttpProxyRunningState {
  mode: 'http-proxy';
  handle: HttpProxyHandle;
  models: HttpProxyModelRow[];
  unavailableFavorites: number;
  unsupportedFavorites: number;
}

type RunningState = GatewayRunningState | HttpProxyRunningState;

export interface ServerModelRow {
  providerLabel: string;
  name: string;
  anthropicId: string;
  openaiId: string;
}

export interface ServerSavedConfig {
  favoritesOnly: boolean;
  freeModelsOnly: boolean;
  exposedProviders: string[] | null;
  maskGatewayIds: boolean;
  listenMode: ServerListenMode;
  hasSavedPassword: boolean;
}

export interface ServerNetworkUrl {
  name: string;
  anthropicUrl: string;
  openaiUrl: string;
}

export interface HttpProxyModelRow {
  id: string;
  displayName: string;
}

export interface ServerStatusPayload {
  running: boolean;
  saved: ServerSavedConfig;
  mode?: UiServerMode;
  listenMode?: ServerListenMode;
  anthropicUrl?: string;
  openaiUrl?: string;
  networkUrls?: ServerNetworkUrl[];
  apiKey?: string;
  exposedProviders?: string[] | null;
  favoritesOnly?: boolean;
  freeModelsOnly?: boolean;
  maskGatewayIds?: boolean;
  providerSummary?: string;
  models?: ServerModelRow[];
  proxyUrl?: string;
  caCertPath?: string;
  proxyModels?: HttpProxyModelRow[];
  unavailableFavorites?: number;
  unsupportedFavorites?: number;
  requestLogPath?: string;
}

let running: RunningState | null = null;
let startInFlight: Promise<{ ok: true; status: ServerStatusPayload } | { ok: false; error: string }> | null = null;

// The OS keychain read behind getSavedServerPassword() is a blocking native call, and this
// flag is polled every few seconds from the UI — cache it briefly so the poll loop doesn't
// hit the keychain on every tick. Refreshed immediately below whenever we save a password.
const SAVED_PASSWORD_CACHE_TTL_MS = 30_000;
let hasSavedPasswordCache: { value: boolean; expiresAt: number } | null = null;

async function hasSavedPasswordCached(): Promise<boolean> {
  const now = Date.now();
  if (hasSavedPasswordCache && hasSavedPasswordCache.expiresAt > now) return hasSavedPasswordCache.value;
  const value = Boolean(await getSavedServerPassword());
  hasSavedPasswordCache = { value, expiresAt: now + SAVED_PASSWORD_CACHE_TTL_MS };
  return value;
}

function buildModelRows(models: ServerModelInfo[], gateway?: GatewayModelOptions): ServerModelRow[] {
  const groups = new Map<string, ServerModelInfo[]>();
  for (const model of models) {
    const label = gatewayProviderLabel(model);
    const list = groups.get(label);
    if (list) list.push(model);
    else groups.set(label, [model]);
  }

  const rows: ServerModelRow[] = [];
  for (const [providerLabel, groupModels] of groups) {
    for (const row of buildDedupedModelRows(groupModels, gateway)) rows.push({ providerLabel, ...row });
  }
  return rows.sort((a, b) => a.providerLabel.localeCompare(b.providerLabel) || a.name.localeCompare(b.name));
}

async function buildSavedConfig(): Promise<ServerSavedConfig> {
  return {
    favoritesOnly: getServerFavoritesOnly(),
    freeModelsOnly: getServerFreeModelsOnly(),
    exposedProviders: getServerExposedProviders(),
    maskGatewayIds: getServerMaskGatewayIds(),
    listenMode: getServerListenMode(),
    hasSavedPassword: await hasSavedPasswordCached(),
  };
}

export async function getServerStatus(): Promise<ServerStatusPayload> {
  const saved = await buildSavedConfig();
  if (!running) return { running: false, saved };

  if (running.mode === 'http-proxy') {
    return {
      running: true,
      saved,
      mode: 'http-proxy',
      proxyUrl: `http://127.0.0.1:${running.handle.port}`,
      caCertPath: running.handle.caCertPath,
      proxyModels: running.models,
      unavailableFavorites: running.unavailableFavorites,
      unsupportedFavorites: running.unsupportedFavorites,
      requestLogPath: running.handle.inferenceLogPath,
    };
  }

  const { handle, config, serverPassword, providerSummary, modelRows } = running;

  const payload: ServerStatusPayload = {
    running: true,
    saved,
    mode: 'gateway',
    listenMode: config.listenMode,
    anthropicUrl: `http://127.0.0.1:${handle.port}/anthropic`,
    openaiUrl: `http://127.0.0.1:${handle.port}/openai/v1`,
    exposedProviders: config.exposedProviders,
    favoritesOnly: config.favoritesOnly,
    freeModelsOnly: config.freeModelsOnly,
    maskGatewayIds: config.maskGatewayIds,
    providerSummary,
    models: modelRows,
    requestLogPath: handle.inferenceLogPath,
  };

  if (config.listenMode === 'network') {
    payload.networkUrls = getLocalIps().map(({ name, address }: { name: string; address: string }) => ({
      name,
      anthropicUrl: `http://${address}:${handle.port}/anthropic`,
      openaiUrl: `http://${address}:${handle.port}/openai/v1`,
    }));
    payload.apiKey = serverPassword ?? undefined;
  } else {
    payload.apiKey = 'any non-empty value';
  }

  return payload;
}

export function startGatewayServer(
  req: ServerStartRequest,
): Promise<{ ok: true; status: ServerStatusPayload } | { ok: false; error: string }> {
  if (running) return Promise.resolve({ ok: false, error: 'Server is already running. Stop it first.' });
  // Two near-simultaneous start requests would otherwise both pass the `running`
  // check above and race through the async setup below — serialize on the
  // in-flight promise instead of just the (only-set-at-the-end) `running` flag.
  if (startInFlight) return startInFlight;
  startInFlight = doStartGatewayServer(req).finally(() => { startInFlight = null; });
  return startInFlight;
}

async function doStartGatewayServer(
  req: ServerStartRequest,
): Promise<{ ok: true; status: ServerStatusPayload } | { ok: false; error: string }> {
  if (req.mode === 'http-proxy') return doStartHttpProxyServer();

  if (req.listenMode !== 'local' && req.listenMode !== 'network') {
    return { ok: false, error: 'Invalid listen mode.' };
  }

  const apiKey = await resolveServerUpstreamApiKey();
  if (!apiKey) {
    return { ok: false, error: 'No providers configured. Add a provider in Providers & Keys first.' };
  }

  let serverPassword: string | null = null;
  if (req.listenMode === 'network') {
    if (req.passwordMode === 'saved') {
      const saved = await getSavedServerPassword();
      if (!saved) return { ok: false, error: 'No saved password found — enter a new password.' };
      serverPassword = saved;
    } else {
      const trimmed = (req.password ?? '').trim();
      if (!trimmed) return { ok: false, error: 'A server password is required for network mode.' };
      serverPassword = trimmed;
      if (req.savePassword) {
        await setSavedServerPassword(trimmed);
        hasSavedPasswordCache = { value: true, expiresAt: Date.now() + SAVED_PASSWORD_CACHE_TTL_MS };
      }
    }
  }

  let models: ServerModelInfo[];
  try {
    models = await loadServerModels();
  } catch (err) {
    return { ok: false, error: `Failed to load models: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (req.exposedProviders) models = filterServerModelsByProviders(models, req.exposedProviders);

  if (req.favoritesOnly) {
    const favorites: FavoriteModel[] = loadPreferences().favoriteModels ?? [];
    if (favorites.length === 0) {
      return { ok: false, error: 'No favorite models configured. Add favorites in the Favorites tab first.' };
    }
    models = filterServerModelsByFavorites(models, favorites).slice(0, MAX_MODEL_CATALOG);
    if (models.length === 0) {
      return { ok: false, error: 'No favorite models matched the current provider filter.' };
    }
  }

  if (req.freeModelsOnly) {
    models = filterServerModelsByFreeStatus(models);
    if (models.length === 0) {
      return { ok: false, error: 'No free models matched the current server filters.' };
    }
  }

  if (models.length === 0) {
    return { ok: false, error: 'No models to expose. Add providers or adjust the exposed-provider filter.' };
  }

  // Persist wizard choices so the terminal `relay-ai server` quick-start path and this
  // panel stay in sync, matching the CLI wizard's own save-as-you-go behavior.
  setServerFavoritesOnly(req.favoritesOnly);
  setServerFreeModelsOnly(req.freeModelsOnly);
  if (req.exposedProviders) setServerExposedProviders(req.exposedProviders);
  setServerMaskGatewayIds(req.maskGatewayIds);
  setServerListenMode(req.listenMode);

  const host = req.listenMode === 'network' ? '0.0.0.0' : '127.0.0.1';
  const gateway = req.maskGatewayIds ? { maskGatewayIds: true as const } : undefined;
  const inferenceLogPath = getInferenceRequestLogPath();

  let handle: ServerHandle;
  try {
    handle = await startServer({
      host,
      port: 17645,
      apiKey,
      serverPassword,
      catalog: createGatewayModelCatalog(models, gateway),
      backends: BACKENDS,
      gateway,
      inferenceLogPath,
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    const message = code === 'EADDRINUSE'
      ? 'Port 17645 is already in use — stop the other relay-ai server instance first.'
      : `Failed to start server: ${err instanceof Error ? err.message : String(err)}`;
    return { ok: false, error: message };
  }

  running = {
    mode: 'gateway',
    handle,
    serverPassword,
    config: {
      favoritesOnly: req.favoritesOnly,
      freeModelsOnly: req.freeModelsOnly,
      exposedProviders: req.exposedProviders,
      maskGatewayIds: req.maskGatewayIds,
      listenMode: req.listenMode,
    },
    providerSummary: summarizeServerProviders(models),
    modelRows: buildModelRows(models, gateway),
  };

  return { ok: true, status: await getServerStatus() };
}

function proxyModelRows(loaded: LoadedHttpProxyRoutes): HttpProxyModelRow[] {
  return loaded.routes.map(route => ({
    id: route.aliasId,
    displayName: route.displayName,
  }));
}

async function doStartHttpProxyServer(): Promise<
  { ok: true; status: ServerStatusPayload } | { ok: false; error: string }
> {
  let started: Awaited<ReturnType<typeof startConfiguredHttpProxy>>;
  try {
    started = await startConfiguredHttpProxy(17645);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    const message = code === 'EADDRINUSE'
      ? 'Port 17645 is already in use — stop the other relay-ai server instance first.'
      : `Failed to start HTTP proxy: ${err instanceof Error ? err.message : String(err)}`;
    return { ok: false, error: message };
  }

  running = {
    mode: 'http-proxy',
    handle: started.handle,
    models: proxyModelRows(started.loaded),
    unavailableFavorites: started.loaded.unavailable.length,
    unsupportedFavorites: started.loaded.unsupported.length,
  };
  return { ok: true, status: await getServerStatus() };
}

export async function stopGatewayServer(): Promise<{ ok: true }> {
  if (running) {
    await running.handle.close();
    running = null;
  }
  return { ok: true };
}
