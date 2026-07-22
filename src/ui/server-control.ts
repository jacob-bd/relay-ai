// In-process lifecycle for the `relay-ai server` gateway, launched from the web UI.
// Runs inside the same Node process as `relay-ai ui` — no child process, no PID file.
// Stops automatically when the UI process exits, same as closing a terminal running
// `relay-ai server` with Ctrl+C.

import { BACKENDS, MAX_MODEL_CATALOG } from '../constants.js';
import {
  getEnvServerPassword,
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
  openAiIdCollisions,
  type GatewayModelOptions,
  type ServerModelInfo,
} from '../server/models.js';
import {
  filterServerModelsByFavorites,
  filterServerModelsByFreeStatus,
  filterServerModelsByProviders,
  summarizeServerProviders,
} from '../server/catalog-filter.js';
import { resolveAdvertiseAddresses, resolveAdvertiseGatewayPort, formatGatewayUrls } from '../server/advertise-addrs.js';
import { loadServerModels, resolveServerUpstreamApiKey } from '../server/index.js';

export type ServerListenMode = 'local' | 'network';

export interface ServerStartRequest {
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

type RunningConfig = Omit<ServerStartRequest, 'passwordMode' | 'password' | 'savePassword'>;

interface RunningState {
  handle: ServerHandle;
  config: RunningConfig;
  serverPassword: string | null;
  /** Derived once from `models` at start time — the exposed model set never changes while running. */
  providerSummary: string;
  modelRows: ServerModelRow[];
}

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
  /** True when RELAY_AI_SERVER_PASSWORD is set. */
  hasEnvPassword: boolean;
  /**
   * Prefills the Server form from RELAY_AI_SERVER_PASSWORD (Docker / Compose).
   * Not used for keychain-saved passwords. Shown masked with a reveal toggle in the UI.
   */
  prefillPassword?: string;
}

export interface ServerNetworkUrl {
  name: string;
  anthropicUrl: string;
  openaiUrl: string;
}

export interface ServerStatusPayload {
  running: boolean;
  saved: ServerSavedConfig;
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

  // Collisions must be computed across the full exposed catalog, not per provider group,
  // or a cross-provider OpenAI id clash never gets scoped.
  const collisions = openAiIdCollisions(models);
  const rows: ServerModelRow[] = [];
  for (const [providerLabel, groupModels] of groups) {
    for (const row of buildDedupedModelRows(groupModels, gateway, collisions)) rows.push({ providerLabel, ...row });
  }
  return rows.sort((a, b) => a.providerLabel.localeCompare(b.providerLabel) || a.name.localeCompare(b.name));
}

async function buildSavedConfig(): Promise<ServerSavedConfig> {
  const envPassword = getEnvServerPassword();
  return {
    favoritesOnly: getServerFavoritesOnly(),
    freeModelsOnly: getServerFreeModelsOnly(),
    exposedProviders: getServerExposedProviders(),
    maskGatewayIds: getServerMaskGatewayIds(),
    listenMode: getServerListenMode(),
    hasSavedPassword: await hasSavedPasswordCached(),
    hasEnvPassword: Boolean(envPassword),
    ...(envPassword ? { prefillPassword: envPassword } : {}),
  };
}

export async function getServerStatus(opts?: { requestHost?: string }): Promise<ServerStatusPayload> {
  const saved = await buildSavedConfig();
  if (!running) return { running: false, saved };

  const { handle, config, serverPassword, providerSummary, modelRows } = running;
  const publicPort = resolveAdvertiseGatewayPort(handle.port);
  const loopback = formatGatewayUrls('127.0.0.1', publicPort);

  const payload: ServerStatusPayload = {
    running: true,
    saved,
    listenMode: config.listenMode,
    anthropicUrl: loopback.anthropicUrl,
    openaiUrl: loopback.openaiUrl,
    exposedProviders: config.exposedProviders,
    favoritesOnly: config.favoritesOnly,
    freeModelsOnly: config.freeModelsOnly,
    maskGatewayIds: config.maskGatewayIds,
    providerSummary,
    models: modelRows,
  };

  if (config.listenMode === 'network') {
    payload.networkUrls = resolveAdvertiseAddresses({ requestHost: opts?.requestHost }).map(
      ({ name, address }) => {
        const urls = formatGatewayUrls(address, publicPort);
        return { name, anthropicUrl: urls.anthropicUrl, openaiUrl: urls.openaiUrl };
      },
    );
    payload.apiKey = serverPassword ?? undefined;
  } else {
    payload.apiKey = 'any non-empty value';
  }

  return payload;
}

export function startGatewayServer(
  req: ServerStartRequest,
  opts?: { requestHost?: string },
): Promise<{ ok: true; status: ServerStatusPayload } | { ok: false; error: string }> {
  if (running) return Promise.resolve({ ok: false, error: 'Server is already running. Stop it first.' });
  // Two near-simultaneous start requests would otherwise both pass the `running`
  // check above and race through the async setup below — serialize on the
  // in-flight promise instead of just the (only-set-at-the-end) `running` flag.
  if (startInFlight) return startInFlight;
  startInFlight = doStartGatewayServer(req, opts).finally(() => { startInFlight = null; });
  return startInFlight;
}

async function doStartGatewayServer(
  req: ServerStartRequest,
  opts?: { requestHost?: string },
): Promise<{ ok: true; status: ServerStatusPayload } | { ok: false; error: string }> {
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
      const configured = (await getSavedServerPassword()) ?? getEnvServerPassword();
      if (!configured) {
        return {
          ok: false,
          error: 'No configured password found — set RELAY_AI_SERVER_PASSWORD, or enter a new password.',
        };
      }
      serverPassword = configured;
    } else {
      const trimmed = (req.password ?? '').trim();
      // Empty field: prefer env (Docker Compose), then keychain-saved.
      if (!trimmed) {
        const configured = getEnvServerPassword() ?? (await getSavedServerPassword());
        if (!configured) return { ok: false, error: 'A server password is required for network mode.' };
        serverPassword = configured;
      } else {
        serverPassword = trimmed;
        if (req.savePassword) {
          await setSavedServerPassword(trimmed);
          hasSavedPasswordCache = { value: true, expiresAt: Date.now() + SAVED_PASSWORD_CACHE_TTL_MS };
        }
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
  if (!req.favoritesOnly) {
    // null / empty = all providers (used with free-models-only to expose every free model).
    setServerExposedProviders(req.exposedProviders ?? []);
  }
  setServerMaskGatewayIds(req.maskGatewayIds);
  setServerListenMode(req.listenMode);

  const host = req.listenMode === 'network' ? '0.0.0.0' : '127.0.0.1';
  const gateway = req.maskGatewayIds ? { maskGatewayIds: true as const } : undefined;

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
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    const message = code === 'EADDRINUSE'
      ? 'Port 17645 is already in use — stop the other relay-ai server instance first.'
      : `Failed to start server: ${err instanceof Error ? err.message : String(err)}`;
    return { ok: false, error: message };
  }

  running = {
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

  return { ok: true, status: await getServerStatus({ requestHost: opts?.requestHost }) };
}

export async function stopGatewayServer(): Promise<{ ok: true; stopped: boolean }> {
  if (running) {
    await running.handle.close();
    running = null;
    return { ok: true, stopped: true };
  }
  return { ok: true, stopped: false };
}
