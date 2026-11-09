import { warnDisabledPoolMembers } from './pool/disabled.js';
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
import { createGatewayModelCatalog, type GatewayModelOptions } from './server/models.js';
import { BACKENDS, MAX_MODEL_CATALOG } from './constants.js';
import { applyDeploymentMode3p, writeRelayAiConfig } from './claude-desktop/app-config.js';
import {
  buildClaudeAppServerCatalog,
  expandClaudeAppEffortVariants,
  resolveClaudeAppCatalog,
} from './claude-desktop/model-catalog.js';
import {getProxyDebugLogPath, localIsoTimestamp } from './trace-log.js';
import { recoverSession, hasStaleSession, writeSessionLock, setupExitCleanup, cleanupSession, backupMetaJson, isConcurrentLiveSession, waitForShutdown } from './claude-desktop/app-session.js';
import { launchOrRestartClaudeApp, claudeAppSupported, isClaudeAppRunning, quitClaudeAppGracefully } from './claude-desktop/app-launch.js';
import type { LocalProvider, LocalProviderModel } from './types.js';
import type { CloudCodeBackend } from './cloud-code-backend.js';
import { pickFavoriteStartModel } from './codex/favorites-launch.js';
import { pickerRefresh } from './picker-refresh.js';
import { prepareClaudeAutoPool, type ClaudeAutoPool } from './pool/claude-launch.js';
import { CLAUDE_POOL_MODEL_ID } from './pool/claude-runtime.js';
import type { ServerModelInfo } from './server/models.js';
import { printUiUrlLast } from './ui-background.js';

export { modelToServerModelInfo } from './claude-desktop/model-catalog.js';

/**
 * Synthetic catalog entry for the opt-in free pool. Its id is the shared
 * `claude-pool` alias, so a request carrying that id reaches the server's pool
 * interception instead of any provider route. The gateway never masks it:
 * masking only rewrites `anthropic-*` aliases.
 */
export function claudePoolServerModel(
  pool: Pick<ClaudeAutoPool, 'displayName' | 'contextWindow'>,
): ServerModelInfo {
  return {
    id: CLAUDE_POOL_MODEL_ID,
    name: pool.displayName,
    isFree: true,
    brand: 'Relay',
    providerLabel: 'Relay',
    providerId: 'relay-pool',
    sourceBackend: 'relay-pool',
    modelFormat: 'unsupported',
    contextWindow: pool.contextWindow,
  };
}

const CLAUDE_APP_GATEWAY_OPTIONS: GatewayModelOptions = {
  maskGatewayIds: true,
  longContextDisplay: 'single-1m',
};

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
  macOS, Windows, and Linux.

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
    const result = recoverSession();
    console.log(result.message);
    return result.blocked || result.liveSession ? 1 : 0;
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
  // True when the Relay Free Pool is what the session starts on: no Relay starting model, just the pool plus favorites.
  let startOnPool = false;

  // Relay Free Pool joins every Claude Desktop launch when the opt-in pool is
  // enabled and at least one member has fresh, servable Claude evidence. The
  // pool shares the Claude Code eligibility gates, but it is fed the default
  // registry catalog that verification used (not the Claude-Desktop-filtered
  // catalog), so endpoint receipts match.
  let autoPool: ClaudeAutoPool | undefined;
  if (prefs.freePool?.enabled === true) {
    try {
      const poolProviders = await fetchProviderCatalog();
      autoPool = prepareClaudeAutoPool(prefs, poolProviders);
      if (autoPool) await warnDisabledPoolMembers(poolProviders, autoPool.pool);
    } catch (err) {
      p.log.warn(`Relay Free Pool is enabled but could not be prepared: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (boot?.launchProvider === 'relay-free-pool' && boot.launchModel === 'relay-free-pool') {
    if (!autoPool) {
      p.log.error('Relay Free Pool is not ready for Claude Desktop. Turn it on and add a tested member in relay-ai ui (Free Pool).');
      return 1;
    }
    startOnPool = true;
  } else if (boot?.launchProvider && boot?.launchModel) {
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
    providerPick: while (true) {
      const pickedProvider = await pickCodexProvider(compatible, prefs, hasFavorites, undefined, Boolean(autoPool));
      if (!pickedProvider) return 0;
      if (pickedProvider === '__pool__') {
        startOnPool = true;
        break providerPick;
      }

      if (pickedProvider === '__favorites__') {
        const favoriteStart = await pickFavoriteStartModel(
          compatible,
          favorites,
          'codex-app',
          prefs,
          async () => {
            const fresh = codexCompatibleProviders(providersForPicker(await fetchProviderCatalog({ agent: 'codex-app' })), 'claude-app');
            for (const lp of compatible) {
              const loaded = fresh.find(f => f.id === lp.id);
              if (loaded) lp.models = loaded.models;
            }
          },
          providerForClaudePicker,
        );
        if (favoriteStart === 'back') continue providerPick;
        if (!favoriteStart) {
          p.log.warn('No saved Claude App favorites are currently available.');
          return 0;
        }
        useFavorites = true;
        activeProvider = favoriteStart.provider;
        selectedModel = favoriteStart.model;
        break providerPick;
      } else {
        activeProvider = providerForClaudePicker(pickedProvider);
        const pickerProvider = activeProvider;
        const pickedModel = await pickCodexModel(activeProvider, prefs, pickerRefresh(pickerProvider, async () => {
          const fresh = codexCompatibleProviders(providersForPicker(await fetchProviderCatalog({ agent: 'codex-app' })), 'claude-app')
            .find(lp => lp.id === pickerProvider.id);
          return fresh && providerForClaudePicker(fresh);
        }));
        if (pickedModel === 'back') continue providerPick;
        if (!pickedModel) return 0;
        selectedModel = pickedModel;
        break providerPick;
      }
    }
  }

  if (!startOnPool && (!activeProvider || !selectedModel)) {
    p.log.error('No Claude App launch model was selected.');
    return 1;
  }
  // Reserve one catalog slot for the synthetic pool entry so the cap still
  // holds and capacity-skipped favorites are reported normally.
  const catalogLimit = MAX_MODEL_CATALOG - (autoPool ? 1 : 0);

  const catalogResolution = await resolveClaudeAppCatalog(
    startOnPool ? undefined : activeProvider ?? undefined,
    startOnPool ? undefined : selectedModel ?? undefined,
    compatible,
    favorites,
    catalogLimit,
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
    p.log.warn(`Skipped favorite(s) beyond the ${MAX_MODEL_CATALOG}-model catalog limit: ${skipped}`);
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
    const serverModels = expandClaudeAppEffortVariants(builtCatalog.serverModels, catalogLimit);
    if (autoPool) {
      // Started on the pool: list it first. Otherwise it follows the chosen model and favorites.
      if (startOnPool) serverModels.unshift(claudePoolServerModel(autoPool));
      else serverModels.push(claudePoolServerModel(autoPool));
    }
    cloudCodeBackend = builtCatalog.backend;

    backupMetaJson();

    proxyHandle = await startServer({
      host: '127.0.0.1',
      port: 0, // random port
      apiKey: 'dummy',
      serverPassword: null,
      catalog: createGatewayModelCatalog(serverModels, CLAUDE_APP_GATEWAY_OPTIONS),
      backends: BACKENDS,
      gateway: CLAUDE_APP_GATEWAY_OPTIONS,
      pool: autoPool
        ? { runtime: autoPool.runtime, displayName: autoPool.displayName }
        : undefined,
      debugLogPath,
    });

    uuid = writeRelayAiConfig(proxyHandle.port);

    // Claude Desktop ignores the gateway config while its own
    // `deploymentMode` is pinned to "1p" — the app then boots first-party and
    // never contacts the proxy, so none of the catalog models show up and
    // nothing reports an error. Force 3P for the session; cleanup restores it.
    const deploymentModeChange = applyDeploymentMode3p();

    writeSessionLock({
      pid: process.pid,
      startedAt: localIsoTimestamp(),
      uuid,
      proxyPort: proxyHandle.port,
      ...(deploymentModeChange ? { previousDeploymentMode: deploymentModeChange.previous } : {}),
    });
    sessionActive = true;
    setupExitCleanup(uuid);

    if (!startOnPool && activeProvider && selectedModel) {
      const prevRecent = prefs.recentModelsByProvider?.[activeProvider.id] ?? [];
      const updatedRecent = [selectedModel.id, ...prevRecent.filter((id: string) => id !== selectedModel.id)].slice(0, 3);
      savePreferences({
        lastClaudeAppProvider: activeProvider.id,
        lastClaudeAppModel: selectedModel.id,
        recentModelsByProvider: { ...prefs.recentModelsByProvider, [activeProvider.id]: updatedRecent },
      });
    }

    console.log(`\n${pc.green('✔')} Proxy started on port ${proxyHandle.port}`);
    if (deploymentModeChange?.previous === '1p') {
      p.log.info('Claude Desktop was pinned to first-party mode; switched it to third-party for this session.');
    }

    try {
      await launchOrRestartClaudeApp();
    } catch (err) {
      p.log.warn(String(err instanceof Error ? err.message : err));
    }

    console.log(`\n${pc.bold('Claude Desktop 3P Mode Active')}`);
    if (startOnPool && autoPool) {
      console.log(`${pc.dim('Model:')}    ${autoPool.displayName}`);
      console.log(`${pc.dim('Provider:')} Relay Free Pool`);
    } else if (activeProvider && selectedModel) {
      console.log(`${pc.dim('Model:')}    ${selectedModel.id}`);
      console.log(`${pc.dim('Provider:')} ${activeProvider.name}`);
    }
    if (serverModels.length > 1) {
      const parts = ['selected'];
      if (hasFavorites) parts.push('favorites');
      if (autoPool) parts.push(autoPool.displayName);
      console.log(`${pc.dim('Catalog:')}  ${serverModels.length} models (${parts.join(' + ')})`);
    }
    console.log(`${pc.cyan('Press Ctrl+C to stop and restore config.')}`);
    printUiUrlLast();

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
