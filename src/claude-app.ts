import pc from 'picocolors';
import * as p from '@clack/prompts';
import { fetchProviderCatalog, providersForPicker } from './provider-catalog.js';
import { loadPreferences, savePreferences } from './config.js';
import { pickCodexProvider, pickCodexModel } from './codex/prompts.js';
import { resolveBootSelection } from './codex/favorites-launch.js';
import {
  codexCompatibleProviders,
  routableModelsForProvider,
} from './codex/routing.js';
import { startServer, type ServerHandle } from './server/router.js';
import { createGatewayModelCatalog } from './server/models.js';
import { BACKENDS } from './constants.js';
import { writeRelayAiConfig } from './claude-desktop/app-config.js';
import {
  buildClaudeAppServerCatalog,
  resolveClaudeAppCatalog,
} from './claude-desktop/model-catalog.js';
import { getProxyDebugLogPath } from './trace-log.js';
import { recoverSession, hasStaleSession, writeSessionLock, setupExitCleanup, cleanupSession, backupMetaJson, isConcurrentLiveSession, waitForShutdown } from './claude-desktop/app-session.js';
import { launchOrRestartClaudeApp, claudeAppSupported, isClaudeAppRunning, quitClaudeAppGracefully } from './claude-desktop/app-launch.js';
import type { LocalProvider, LocalProviderModel } from './types.js';
import type { CloudCodeBackend } from './cloud-code-backend.js';
import { resolveFirstAvailableFavorite } from './favorites-resolver.js';

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
  Picks a provider and model from ~/.relay-ai/providers.json, combines the selected model
  with your available saved favorites, patches Claude Desktop config (with backup + restore
  on Ctrl+C), starts a local Responses proxy, and opens the Claude Desktop app.
  Keep this terminal open while using Claude.

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
  let selectedModel: LocalProviderModel | null = null;
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
      const firstFavorite = resolveFirstAvailableFavorite(favorites, compatible);
      if (!firstFavorite) {
        p.log.warn('No saved Claude App favorites are currently available.');
        return 0;
      }
      activeProvider = firstFavorite.provider;
      selectedModel = firstFavorite.model;
    } else {
      activeProvider = providerForClaudePicker(pickedProvider);
      const pickedModel = await pickCodexModel(activeProvider, prefs);
      if (!pickedModel || pickedModel === 'back') return 0;
      selectedModel = pickedModel;
    }
  }

  if (!activeProvider || !selectedModel) {
    p.log.error('No Claude App launch model was selected.');
    return 1;
  }

  const catalogResolution = await resolveClaudeAppCatalog(
    activeProvider,
    selectedModel,
    compatible,
    favorites,
  );
  if (!catalogResolution.ok) {
    p.log.error(catalogResolution.error);
    return 1;
  }

  if (catalogResolution.droppedFavorites.length > 0) {
    const skipped = catalogResolution.droppedFavorites
      .map(favorite => `${favorite.providerId}/${favorite.modelId}`)
      .join(', ');
    p.log.warn(`Skipped unavailable or unauthorized favorite(s): ${skipped}`);
  }
  if (catalogResolution.capacitySkippedFavorites.length > 0) {
    const skipped = catalogResolution.capacitySkippedFavorites
      .map(favorite => `${favorite.providerId}/${favorite.modelId}`)
      .join(', ');
    p.log.warn(`Skipped favorite(s) beyond the 20-model catalog limit: ${skipped}`);
  }

  let cloudCodeBackend: CloudCodeBackend | null = null;

  let proxyHandle: ServerHandle | null = null;
  let sessionActive = false;
  let uuid = '';

  try {
    const builtCatalog = await buildClaudeAppServerCatalog(
      catalogResolution.entries,
      catalogResolution.providersById,
      trace,
    );
    const serverModels = builtCatalog.serverModels;
    cloudCodeBackend = builtCatalog.backend;

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
      const prevRecent = prefs.recentModelsByProvider?.[activeProvider.id] ?? [];
      const updatedRecent = [selectedModel.id, ...prevRecent.filter((id: string) => id !== selectedModel.id)].slice(0, 3);
      savePreferences({
        lastCodexProvider: activeProvider.id,
        lastCodexModel: selectedModel.id,
        recentModelsByProvider: { ...prefs.recentModelsByProvider, [activeProvider.id]: updatedRecent },
      });
    }

    console.log(`\n${pc.green('✔')} Proxy started on port ${proxyHandle.port}`);

    try {
      await launchOrRestartClaudeApp();
    } catch (err) {
      p.log.warn(String(err instanceof Error ? err.message : err));
    }

    console.log(`\n${pc.bold('Claude Desktop 3P Mode Active')}`);
    console.log(`${pc.dim('Model:')}    ${selectedModel.id}`);
    console.log(`${pc.dim('Provider:')} ${activeProvider.name}`);
    if (serverModels.length > 1) {
      console.log(`${pc.dim('Catalog:')}  ${serverModels.length} models (selected + favorites)`);
    }
    console.log(`${pc.cyan('Press Ctrl+C to stop and restore config.')}`);

    await waitForShutdown();
    console.log('');
    
    // We do cleanup before prompting so that Claude gets restored ASAP
    // and if the user hits Ctrl+C again during the prompt, it's already restored.
    cleanupSession(uuid);
    sessionActive = false;
    if (cloudCodeBackend) cloudCodeBackend.handle.close();

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
    p.log.error(String(err instanceof Error ? err.message : err));
    return 1;
  }
}
