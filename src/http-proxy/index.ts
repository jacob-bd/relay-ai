import pc from 'picocolors';
import * as p from '@clack/prompts';
import { loadPreferences } from '../config.js';
import { fetchProviderCatalog, resolveLocalProviderApiKey } from '../provider-catalog.js';
import { providersForTarget } from '../target-compatibility.js';
import type { ProxyRoute } from '../proxy.js';
import { buildHttpProxyRoutes, type HttpProxyRouteResult } from './routes.js';
import { startHttpProxy, type HttpProxyHandle } from './server.js';
import { ensureHttpProxyCaBundle } from './ca.js';
import { getInferenceRequestLogPath } from '../trace-log.js';

export interface LoadedHttpProxyRoutes extends HttpProxyRouteResult {
  favoriteCount: number;
}

export async function loadHttpProxyRoutes(): Promise<LoadedHttpProxyRoutes> {
  const favorites = loadPreferences().favoriteModels ?? [];
  if (favorites.length === 0) {
    return { routes: [], unavailable: [], unsupported: [], favoriteCount: 0 };
  }
  const rawCatalog = providersForTarget(await fetchProviderCatalog({ agent: 'claude' }), 'claude');
  const catalog = await Promise.all(rawCatalog.map(async provider => ({
    ...provider,
    apiKey: (await resolveLocalProviderApiKey(provider)) ?? '',
  })));
  return { ...buildHttpProxyRoutes(catalog, favorites), favoriteCount: favorites.length };
}

export function formatHttpProxyModelLines(routes: ProxyRoute[]): string[] {
  if (routes.length === 0) return ['  (no compatible favorite models)'];
  return routes.map(route => `  ${route.aliasId}  ${pc.dim(route.displayName)}`);
}

export function printHttpProxyModels(routes: ProxyRoute[]): void {
  console.log(pc.bold('HTTP proxy model names:'));
  for (const line of formatHttpProxyModelLines(routes)) console.log(line);
}

export function reportSkippedHttpProxyFavorites(loaded: LoadedHttpProxyRoutes): void {
  if (loaded.unavailable.length > 0) {
    p.log.warn(`${loaded.unavailable.length} favorite${loaded.unavailable.length === 1 ? '' : 's'} unavailable or missing credentials.`);
  }
  if (loaded.unsupported.length > 0) {
    p.log.warn(
      `${loaded.unsupported.length} favorite${loaded.unsupported.length === 1 ? '' : 's'} skipped — `
      + 'HTTP proxy mode supports non-Anthropic AI SDK routes only.',
    );
  }
}

export async function startConfiguredHttpProxy(
  port: number,
  debug = false,
): Promise<{ handle: HttpProxyHandle; loaded: LoadedHttpProxyRoutes }> {
  const loaded = await loadHttpProxyRoutes();
  const inferenceLogPath = getInferenceRequestLogPath();
  const handle = await startHttpProxy({
    host: '127.0.0.1',
    port,
    routes: loaded.routes,
    debug,
    inferenceLogPath,
  });
  handle.caCertPath = ensureHttpProxyCaBundle(
    handle.caCertPath,
    process.env['NODE_EXTRA_CA_CERTS'],
  );
  return { handle, loaded };
}

function waitForShutdown(): Promise<void> {
  return new Promise(resolve => {
    const done = () => {
      process.off('SIGINT', done);
      process.off('SIGTERM', done);
      resolve();
    };
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
}

export async function runHttpProxyServerCommand(debug = false): Promise<number> {
  let started: Awaited<ReturnType<typeof startConfiguredHttpProxy>>;
  try {
    started = await startConfiguredHttpProxy(17645, debug);
  } catch (err) {
    p.log.error(`Failed to start HTTP proxy: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const { handle, loaded } = started;
  console.log('');
  console.log(pc.bold(pc.green('Relay AI HTTP proxy running')));
  console.log(`  HTTPS_PROXY=http://127.0.0.1:${handle.port}`);
  console.log(`  HTTP_PROXY=http://127.0.0.1:${handle.port}`);
  console.log(`  NODE_EXTRA_CA_CERTS=${handle.caCertPath}`);
  console.log(`  Request log: ${handle.inferenceLogPath}`);
  console.log('');
  printHttpProxyModels(loaded.routes);
  reportSkippedHttpProxyFavorites(loaded);
  console.log('');
  console.log(pc.dim('Anthropic requests keep Claude Code auth and pass through unchanged.'));
  console.log(pc.dim('Use `/model relay:<provider-id>:<model-id>` for a listed favorite.'));
  console.log(pc.dim('Press Ctrl+C to stop.'));

  await waitForShutdown();
  await handle.close();
  return 0;
}
