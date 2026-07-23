import pc from 'picocolors';
import * as p from '@clack/prompts';
import { fetchProviderCatalog, providersForPicker, resolveLocalProviderApiKey } from './provider-catalog.js';
import { loadPreferences, savePreferences } from './config.js';
import { resolveApiKey, readFromCredentialStore } from './env.js';
import { resolveOrCollectApiKey } from './key-setup.js';
import { pickCodexProvider, pickCodexModel } from './codex/prompts.js';
import { resolveBootSelection } from './codex/favorites-launch.js';
import {
  codexCompatibleProviders,
  routableModelsForProvider,
} from './codex/routing.js';
import { startServer, type ServerHandle } from './server/router.js';
import { createGatewayModelCatalog, type ServerModelInfo } from './server/models.js';
import { BACKENDS } from './constants.js';
import { loadServerModels } from './server/index.js';
import { filterServerModelsByFavorites } from './server/catalog-filter.js';
import { writeRelayAiConfig, getClaudeDesktopHome } from './claude-desktop/app-config.js';
import { modelToServerModelInfo } from './claude-desktop/model-catalog.js';
import { getProxyDebugLogPath } from './trace-log.js';
import { readSessionLock, recoverSession, hasStaleSession, writeSessionLock, setupExitCleanup, cleanupSession, backupMetaJson, isConcurrentLiveSession, waitForShutdown } from './claude-desktop/app-session.js';
import { launchOrRestartClaudeApp, claudeAppSupported, isClaudeAppRunning, quitClaudeAppGracefully } from './claude-desktop/app-launch.js';
import type { LocalProvider, LocalProviderModel } from './types.js';
import {
  buildCloudCodeProxyRoute,
  startCloudCodeCatalogBackend,
  type CloudCodeBackend,
} from './cloud-code-backend.js';
import type { ProxyRoute } from './proxy.js';

export { modelToServerModelInfo } from './claude-desktop/model-catalog.js';

export function claudeAppHelpText(): string {
  return `${pc.bold('relay-ai claude-app')} — launch Claude Desktop app in 3P mode with your registry providers

${pc.bold('Usage:')}
  relay-ai claude-app [options]
  relay-ai claude-app --trace
  relay-ai claude-app --restore
  relay-ai claude-app --help
  relay-ai claude-app --version

${pc.bold('Options:')}
  --trace      Write proxy debug logs to ~/.relay-ai/logs/
  --restore    Restore Claude Desktop config after an interrupted app session
  --help       Show this command help
  --version    Show version

${pc.bold('Description:')}
  Picks a provider and model from ~/.relay-ai/providers.json, patches Claude Desktop config
  (with backup + restore on Ctrl+C), starts a local Responses proxy, and opens
  the Claude Desktop app. Keep this terminal open while using Claude.

${pc.bold('Platforms:')}
  macOS and Windows. Linux is not supported.

${pc.bold('Cleanup:')}
  Ctrl+C stops the proxy and restores your previous Claude config.
  After a crash: relay-ai claude-app --restore
`;
}

function providerForClaudePicker(provider: LocalProvider): LocalProvider {
  return { ...provider, models: routableModelsForProvider(provider, 'claude-app') };
}

export async function runClaudeAppCommand(args: string[], boot?: { launchProvider?: string; launchModel?: string }): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(claudeAppHelpText());
    return 0;
  }

  if (args.includes('--restore')) {
    recoverSession();
    console.log('Restored Claude Desktop relay-ai config.');
    return 0;
  }

  const trace = args.includes('--trace');
  const debugLogPath = trace ? getProxyDebugLogPath() : undefined;
  if (trace) console.log(`Debug log: ${debugLogPath}`);

  try {
    claudeAppSupported();
  } catch (err) {
    console.error(pc.red(String(err instanceof Error ? err.message : err)));
    return 1;
  }

  const isTty = Boolean(process.stdin.isTTY);
  if (!isTty) {
    console.error(pc.red('relay-ai claude-app requires an interactive terminal.'));
    return 1;
  }

  if (isConcurrentLiveSession()) {
    console.error(pc.yellow(`Another relay-ai claude-app session may be running.`));
    console.error('Stop it with Ctrl+C in that terminal.');
    return 1;
  }

  if (hasStaleSession()) {
    p.log.warn('Recovered from an interrupted claude-app session.');
    recoverSession();
  }

  const catalogSpinner = p.spinner();
  catalogSpinner.start('Loading your providers...');
  let catalog;
  try {
    catalog = await fetchProviderCatalog({ agent: 'codex-app' });
  } catch (err) {
    catalogSpinner.stop('');
    console.error(pc.red(String(err instanceof Error ? err.message : err)));
    return 1;
  }
  catalogSpinner.stop('');

  const compatible = codexCompatibleProviders(providersForPicker(catalog), 'claude-app');
  if (compatible.length === 0) {
    p.log.warn('No compatible providers in your registry.');
    return 0;
  }

  const prefs = loadPreferences();
  const favorites = prefs.favoriteModels ?? [];
  const hasFavorites = favorites.length > 0;

  let activeProvider: LocalProvider | null = null;
  let selectedModel: any = null;
  let useFavorites = false;

  if (boot?.launchProvider && boot?.launchModel) {
    const bootSelection = resolveBootSelection(
      compatible,
      boot.launchProvider,
      boot.launchModel,
      providerForClaudePicker,
    );
    if ('error' in bootSelection) {
      p.log.error(bootSelection.error);
      return 1;
    }
    activeProvider = bootSelection.provider;
    selectedModel = bootSelection.model;
  } else {
    const pickedProvider = await pickCodexProvider(compatible, prefs, hasFavorites);
    if (!pickedProvider) return 0;

    if (pickedProvider === '__favorites__') {
      useFavorites = true;
    } else {
      activeProvider = providerForClaudePicker(pickedProvider);
      const pickedModel = await pickCodexModel(activeProvider, prefs);
      if (!pickedModel) return 0;
      selectedModel = pickedModel;
    }
  }

  if (activeProvider) {
    const apiKey = await resolveLocalProviderApiKey(activeProvider);
    if (!apiKey) {
      p.log.error(`No credential for ${activeProvider.name}. Run relay-ai providers auth ${activeProvider.id}.`);
      return 1;
    }

    activeProvider.apiKey = apiKey;
  }

  let serverModels: ServerModelInfo[] = [];
  let cloudCodeBackend: CloudCodeBackend | null = null;
  let cloudCodeFavBackend: CloudCodeBackend | null = null;

  if (useFavorites) {
    // Identify cloud-code favorites from the already-fetched catalog
    const antigravityProvider = catalog.find(lp => lp.id === 'antigravity');
    const cloudCodeFavoriteModels = favorites
      .map(fav => {
        if (fav.providerId !== 'antigravity') return null;
        const model = antigravityProvider?.models.find(m => m.id === fav.modelId);
        return model?.modelFormat === 'cloud-code' ? model : null;
      })
      .filter((m): m is import('./types.js').LocalProviderModel => m !== null);

    const regularFavorites = favorites.filter(
      fav => !cloudCodeFavoriteModels.some(m => m.id === fav.modelId && fav.providerId === 'antigravity'),
    );

    // Start cloud-code backend if any cloud-code favorites
    let cloudCodeServerModels: ServerModelInfo[] = [];

    if (cloudCodeFavoriteModels.length > 0 && antigravityProvider?.apiKey) {
      const cloudRoutes: ProxyRoute[] = cloudCodeFavoriteModels.map(model =>
        buildCloudCodeProxyRoute(
          model,
          antigravityProvider.apiKey,
          (antigravityProvider.providerData ?? {}) as Record<string, unknown>,
        ),
      );
      const startingAlias = cloudRoutes[0]!.aliasId;
      cloudCodeFavBackend = await startCloudCodeCatalogBackend(cloudRoutes, startingAlias, trace);
      const favBackend = cloudCodeFavBackend;
      cloudCodeServerModels = cloudCodeFavoriteModels.map(model => modelToServerModelInfo(model, antigravityProvider, {
        isFree: false,
        providerId: 'antigravity',
        sourceBackend: 'antigravity',
        modelFormat: 'anthropic' as const,
        cost: undefined,
        baseUrl: `http://127.0.0.1:${favBackend.port}`,
        completionsUrl: undefined,
        npm: undefined,
        apiBaseUrl: undefined,
        apiKey: favBackend.token,
        authType: undefined,
        oauthAccountId: undefined,
        headers: undefined,
      }));
    }

    // Load remaining (non-cloud-code) favorites via the normal path
    const allModels = await loadServerModels();
    const regularServerModels = filterServerModelsByFavorites(allModels, regularFavorites);
    serverModels = [...cloudCodeServerModels, ...regularServerModels];
  } else if (selectedModel.modelFormat === 'cloud-code') {
    const providerData = (activeProvider!.providerData ?? {}) as Record<string, unknown>;
    const cloudRoute = buildCloudCodeProxyRoute(selectedModel, activeProvider!.apiKey, providerData);
    cloudCodeBackend = await startCloudCodeCatalogBackend([cloudRoute], cloudRoute.aliasId, trace);
    serverModels = [modelToServerModelInfo(selectedModel, activeProvider!, {
      modelFormat: 'anthropic',
      baseUrl: `http://127.0.0.1:${cloudCodeBackend.port}`,
      completionsUrl: undefined,
      npm: undefined,
      apiBaseUrl: undefined,
      apiKey: cloudCodeBackend.token,
      authType: undefined,
      oauthAccountId: undefined,
      headers: undefined,
    })];
  } else {
    serverModels = [modelToServerModelInfo(selectedModel, activeProvider!)];
  }

  let proxyHandle: ServerHandle | null = null;
  let sessionActive = false;
  let uuid = '';

  try {
    backupMetaJson();

    proxyHandle = await startServer({
      host: '127.0.0.1',
      port: 0, // random port
      apiKey: 'dummy',
      serverPassword: null,
      catalog: createGatewayModelCatalog(serverModels, { maskGatewayIds: true }),
      backends: BACKENDS,
      gateway: { maskGatewayIds: true },
      debugLogPath,
    });

    uuid = writeRelayAiConfig(proxyHandle.port);

    writeSessionLock({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      uuid,
      proxyPort: proxyHandle.port
    });
    sessionActive = true;
    setupExitCleanup(uuid);

    if (!useFavorites) {
      const prevRecent = prefs.recentModelsByProvider?.[activeProvider!.id] ?? [];
      const updatedRecent = [selectedModel.id, ...prevRecent.filter((id: string) => id !== selectedModel.id)].slice(0, 3);
      savePreferences({
        lastCodexProvider: activeProvider!.id,
        lastCodexModel: selectedModel.id,
        recentModelsByProvider: { ...prefs.recentModelsByProvider, [activeProvider!.id]: updatedRecent },
      });
    }

    console.log(`\n${pc.green('✔')} Proxy started on port ${proxyHandle.port}`);

    try {
      await launchOrRestartClaudeApp();
    } catch (err) {
      p.log.warn(String(err instanceof Error ? err.message : err));
    }

    console.log(`\n${pc.bold('Claude Desktop 3P Mode Active')}`);
    if (useFavorites) {
      console.log(`${pc.dim('Catalog:')}  Favorite models only`);
    } else {
      console.log(`${pc.dim('Model:')}    ${selectedModel.id}`);
      console.log(`${pc.dim('Provider:')} ${activeProvider!.name}`);
    }
    console.log(`${pc.cyan('Press Ctrl+C to stop and restore config.')}`);

    await waitForShutdown();
    console.log('');
    
    // We do cleanup before prompting so that Claude gets restored ASAP
    // and if the user hits Ctrl+C again during the prompt, it's already restored.
    cleanupSession(uuid);
    sessionActive = false;
    if (cloudCodeBackend) cloudCodeBackend.handle.close();
    if (cloudCodeFavBackend) cloudCodeFavBackend.handle.close();

    if (isClaudeAppRunning()) {
      const shouldClose = await p.confirm({ message: 'Claude Desktop is still running. Close it?' });
      if (shouldClose && !p.isCancel(shouldClose)) {
        quitClaudeAppGracefully();
      }
    }
    return 0;

  } catch (err) {
    if (proxyHandle) await proxyHandle.close();
    if (sessionActive && uuid) {
      cleanupSession(uuid);
    }
    if (cloudCodeBackend) cloudCodeBackend.handle.close();
    if (cloudCodeFavBackend) cloudCodeFavBackend.handle.close();
    return 1;
  }
}
