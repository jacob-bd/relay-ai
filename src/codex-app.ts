// codex-app.ts — relay-ai codex-app / chatgpt: launch the ChatGPT desktop app (Codex mode) with registry providers
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { join } from 'node:path';
import { fetchProviderCatalog, providersForPicker, resolveLocalProviderApiKey } from './provider-catalog.js';
import { loadPreferences, savePreferences } from './config.js';
import { resolveApiKey, readFromCredentialStore } from './env.js';
import { resolveOrCollectApiKey } from './key-setup.js';
import { startCodexProxy } from './codex-proxy.js';
import type { CodexProxyHandle, CodexProxyRoute } from './codex-proxy.js';
import { getCodexProxyDebugLogPath, printTraceLog } from './trace-log.js';
import { buildAppCatalogFile, formatCodexModelLabel, serializeCatalog } from './codex/catalog.js';
import { captureNativeCodexCatalog } from './codex/native-catalog.js';
import { runCodexCommandSync } from './codex/process.js';
import { buildCodexMixedLaunchPlan, prepareCodexMixedRelayRoutes } from './codex/mixed-launch.js';
import { supportsMultiAgentV2 } from './codex/multi-agent.js';
import { mixedProxyBaseUrl } from './codex/routing.js';
import { pickCodexProvider, pickCodexModel, pickCodexLaunchMode, confirmCodexLaunch } from './codex/prompts.js';
import {
  codexCompatibleProviders,
  resolveCodexRoute,
  routableModelsForProvider,
  type CodexRoute,
} from './codex/routing.js';
import { buildCodexAppProviderCatalogRoutes } from './codex/app-provider-routes.js';
import { applyAppConfigPatch, previewAppConfigToml } from './codex/app-config.js';
import { verifyCodexAppReadiness } from './codex/app-readiness.js';
import { PREVIEW_PROXY_PORT, type CodexAppConfigSpec } from './codex/app-profile.js';
import type { LocalProvider, LocalProviderModel } from './types.js';
import {
  backupConfigToml,
  checkAppSessionLock,
  getAppCatalogPath,
  getAppRestoreStatePath,
  getCodexConfigPath,
  fileSha256,
  recoverInterruptedCodexAppSession,
  restoreCodexAppOverlay,
  saveAppRestoreStateBeforePatch,
  waitForShutdown,
  writeAppSessionLock,
} from './codex/app-session.js';
import { writeOverlayFile } from './codex/session.js';
import { codexAppInstallHint, codexAppSupported, findEmbeddedCodexBinary, launchOrRestartCodexApp, isCodexAppRunning, quitCodexAppGracefully } from './codex/app-launch.js';
import {
  codexAppIntro,
  codexAppOutro,
  logCodexActiveModel,
  logCodexProxy,
  printCodexAppSessionPanel,
} from './codex/ui.js';
import type { ResolvedFavorite } from './favorites-resolver.js';
import { buildFavoritesAppCatalog, codexCliFavoritesSlug } from './codex/favorites-catalog.js';
import {
  buildVertexRuntimeConfig,
  hasApplicationDefaultCredentials,
  type VertexModelEntry,
} from './server/vertex-config.js';
import { VERTEX_ANTHROPIC_NPM } from './constants.js';
import { resolveContextWindow } from './context-window.js';
import {
  buildCodexProxyRoutesFromResolved,
  assertConfiguredCodexSubagentsResolved,
  pickFavoriteStartingModel,
  resolveBootSelection,
  resolveCodexFavorites,
  resolveCodexMixedModels,
} from './codex/favorites-launch.js';
import { getFavoritesAppCatalogPath } from './codex/profile.js';
import { getRelayAiCodexDir } from './codex/session.js';
import { prepareCodexRouteAuditLog } from './codex/route-audit.js';
import {
  buildCloudCodeProxyRoute,
  buildOAuthAnthropicProxyRoute,
  startCloudCodeCatalogBackend,
  type CloudCodeBackend,
} from './cloud-code-backend.js';
import type { ProxyRoute } from './proxy.js';

function codexProxyRouteToCodexRoute(route: CodexProxyRoute, fallbackProviderId: string): CodexRoute {
  return {
    tier: 'proxy',
    modelId: route.modelId,
    providerId: route.providerId ?? fallbackProviderId,
    npm: route.npm,
    apiKey: route.apiKey,
    baseURL: route.baseURL,
    upstreamModelId: route.upstreamModelId,
    authType: route.authType,
    oauthAccountId: route.oauthAccountId,
    contextWindow: route.contextWindow,
    supportedParameters: route.supportedParameters,
    reasoning: route.reasoning,
    interleavedReasoningField: route.interleavedReasoningField,
    headers: route.headers,
    refreshToken: route.refreshToken,
  };
}

export function codexAppUsesExplicitSelection(
  configOnly: boolean,
  launchProvider?: string,
  launchModel?: string,
): boolean {
  // configOnly is intentionally accepted so the preview behavior stays an
  // explicit, regression-tested part of this decision.
  void configOnly;
  return Boolean(launchProvider && launchModel);
}

type AppShutdownSignal = 'sigint' | 'sigterm' | 'sighup';

async function waitForShutdownWithConfirm(): Promise<AppShutdownSignal> {
  while (true) {
    const signal = await waitForShutdown();
    if (signal !== 'sigint') return signal; // SIGTERM/SIGHUP: close immediately, no one to ask
    console.log('');
    const choice = await p.select({
      message: 'Close ChatGPT Desktop and restore your Codex config?',
      options: [
        { value: 'yes', label: 'Yes, close ChatGPT Desktop and restore config' },
        { value: 'no', label: 'No, keep session running' },
      ],
    });
    if (p.isCancel(choice) || choice === 'yes') return signal; // Ctrl+C or Yes = close
    // choice === 'no' → loop back and keep waiting
  }
}

export function unattendedShutdownClosesApp(assumeYes: boolean, signal: AppShutdownSignal): boolean {
  return assumeYes && signal !== 'sigint';
}

export async function maybeCloseRunningCodexApp(): Promise<void> {
  if (!isCodexAppRunning()) return;

  const shouldClose = await p.confirm({ message: 'ChatGPT Desktop is still running. Close it?' });
  if (shouldClose && !p.isCancel(shouldClose)) {
    p.log.step('Stopping ChatGPT Desktop...');
    quitCodexAppGracefully();
  }
}

export function codexAppHelpText(): string {
  return `${pc.bold('relay-ai codex-app')} — launch the ChatGPT desktop app (Codex mode) with your registry providers
${pc.dim('(OpenAI merged the Codex app into ChatGPT desktop on 2026-07-09; "chatgpt" is an alias for this command)')}

${pc.bold('Usage:')}
  relay-ai codex-app [options]
  relay-ai chatgpt [options]
  relay-ai codex-app --vertex
  relay-ai codex-app --restore
  relay-ai codex-app --config
  relay-ai codex-app --help
  relay-ai codex-app --version

${pc.bold('Options:')}
  --vertex     Use Claude models through Google Vertex AI
  --with-native Load native Codex models beside Relay models for this launch
  --relay-only Keep the current Relay-only launch behavior
  --yes, -y     Approve a fully specified launch/restart without prompting
  --restore    Restore Codex config after an interrupted app session
  --config     Preview the generated Codex app configuration without launching
  --trace      Write proxy debug logs to ~/.relay-ai/logs/ and show errors on exit
  --help       Show this command help
  --version    Show version

${pc.bold('Description:')}
  Picks a provider and model from ~/.relay-ai/providers.json, patches ~/.codex/config.toml
  (with backup + restore on Ctrl+C), starts a local Responses proxy, and opens the
  ChatGPT desktop app in Codex mode. Keep this terminal open while using Codex.

${pc.bold('Platforms:')}
  macOS, Windows, and Linux (ChatGPT desktop app preview).

${pc.bold('Cleanup:')}
  Ctrl+C stops the proxy and restores your previous Codex config.
  After crash: relay-ai codex-app --restore

${pc.bold('Preview (no writes):')}
  relay-ai codex-app --config

  See docs/CODEX.md for CLI vs app, files touched, and restore.

${pc.bold('Examples:')}
  relay-ai codex-app
  relay-ai codex-app --vertex
  relay-ai codex-app --provider antigravity --model gemini-3.1-pro-high --with-native --yes
  relay-ai codex-app --config
  relay-ai codex-app --restore
  
${pc.bold('Favorites:')}
  When you have saved favorites via ${pc.cyan('relay-ai models')}, the Codex App
  picker will show your starting model + favorites for mid-session switching.
  Zen/Go favorites are included when an OpenCode API key is available.`;
}

function providerForCodexPicker(provider: LocalProvider): LocalProvider {
  return { ...provider, models: routableModelsForProvider(provider, 'codex-app') };
}

function vertexEntryToLocalModel(entry: VertexModelEntry): import('./types.js').LocalProviderModel {
  return {
    id: entry.id,
    name: entry.display_name,
    family: 'claude',
    brand: 'Anthropic',
    modelFormat: 'openai',
    upstreamModelId: entry.upstream_id ?? entry.id,
    baseUrl: '',
    npm: VERTEX_ANTHROPIC_NPM,
    contextWindow: resolveContextWindow(entry.id),
  };
}

async function runCodexAppVertexLaunch(configOnly: boolean, trace = false): Promise<number> {
  if (!hasApplicationDefaultCredentials()) {
    p.log.error('Google Application Default Credentials not found.');
    p.log.info('Run: gcloud auth application-default login');
    return 1;
  }

  const config = buildVertexRuntimeConfig();
  if (!config) {
    p.log.error('ANTHROPIC_VERTEX_PROJECT_ID (or GOOGLE_CLOUD_PROJECT) is not set.');
    p.log.info('Set your project: export ANTHROPIC_VERTEX_PROJECT_ID=your-project-id');
    return 1;
  }

  let selectedEntry: VertexModelEntry;
  if (config.models.length === 1) {
    selectedEntry = config.models[0]!;
  } else {
    const choice = await p.select({
      message: 'Select a starting Vertex AI model:',
      options: config.models.map(m => ({ value: m, label: m.display_name, hint: m.id })),
    });
    if (p.isCancel(choice)) { p.cancel('Cancelled.'); return 0; }
    selectedEntry = choice as VertexModelEntry;
  }

  process.env['ANTHROPIC_VERTEX_PROJECT_ID'] = config.project;
  process.env['GOOGLE_CLOUD_LOCATION'] = config.location;

  const vertexConfig = { project: config.project, location: config.location };
  const vertexModels = config.models.map(vertexEntryToLocalModel);
  const catalogPath = getAppCatalogPath('vertex');

  const route = {
    tier: 'proxy' as const,
    modelId: selectedEntry.id,
    upstreamModelId: selectedEntry.upstream_id ?? selectedEntry.id,
    npm: VERTEX_ANTHROPIC_NPM,
    apiKey: '',
    providerId: 'vertex',
    contextWindow: resolveContextWindow(selectedEntry.id),
  };

  if (configOnly) {
    const home = process.env['HOME'] ?? '';
    const shortenPath = (fp: string) => home ? fp.replace(home, '~') : fp;
    console.log('');
    console.log(pc.bold(pc.cyan('  CONFIG PREVIEW — relay-ai codex-app --vertex')));
    console.log('');
    console.log(`  ${pc.bold('Mode:')}     Vertex AI`);
    console.log(`  ${pc.bold('Project:')} ${config.project}`);
    console.log(`  ${pc.bold('Location:')} ${config.location}`);
    console.log(`  ${pc.bold('Model:')}    ${selectedEntry.display_name}`);
    console.log(`  ${pc.bold('Catalog:')} ${vertexModels.length} model${vertexModels.length !== 1 ? 's' : ''} available`);
    console.log('');
    console.log(`  ${pc.bold('Catalog file:')}`);
    console.log(`    ${pc.dim(shortenPath(catalogPath))}`);
    console.log('');
    console.log(pc.dim('  No app was launched.'));
    console.log(pc.dim('  Run ') + pc.cyan('relay-ai codex-app --vertex') + pc.dim(' to launch.'));
    console.log('');
    return 0;
  }

  let proxyHandle: CodexProxyHandle | null = null;
  let sessionActive = false;
  try {
    proxyHandle = await startCodexProxy(
      vertexModels.map(m => ({
        modelId: m.id,
        upstreamModelId: m.upstreamModelId,
        npm: VERTEX_ANTHROPIC_NPM,
        apiKey: '',
        providerId: 'vertex',
        vertex: vertexConfig,
        contextWindow: m.contextWindow,
      })),
      { requireAuth: false, debug: trace },
    );
    const proxyPort = proxyHandle.port;

    const catalogFile = buildAppCatalogFile(vertexModels, 'Vertex AI', selectedEntry.id);
    writeOverlayFile(catalogPath, serializeCatalog(catalogFile));

    const spec: CodexAppConfigSpec = {
      route,
      proxyPort,
      catalogPath,
    };

    saveAppRestoreStateBeforePatch();
    sessionActive = true;
    const backupPath = backupConfigToml();
    applyAppConfigPatch(spec);
    await verifyCodexAppReadiness(spec);

    writeAppSessionLock({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      configPath: getCodexConfigPath(),
      catalogPaths: [catalogPath],
      restoreStatePath: getAppRestoreStatePath(),
      backupPath,
      proxyPort,
      patchedConfigSha256: fileSha256(getCodexConfigPath()),
      ...(backupPath ? { originalConfigSha256: fileSha256(backupPath) } : {}),
    });

    p.log.info(`Vertex AI · ${selectedEntry.display_name} — project: ${config.project} / location: ${config.location}`);
    logCodexProxy(proxyPort);
    logCodexActiveModel(selectedEntry.display_name, selectedEntry.id);

    try {
      await launchOrRestartCodexApp();
    } catch (err) {
      p.log.warn(String(err instanceof Error ? err.message : err));
      p.log.info(codexAppInstallHint());
      throw err;
    }

    printCodexAppSessionPanel({
      modelLabel: selectedEntry.display_name,
      modelId: selectedEntry.id,
      providerName: 'Vertex AI',
      restoreCommand: 'relay-ai codex-app --restore',
    });

    codexAppOutro(selectedEntry.display_name);
    await waitForShutdownWithConfirm();
    console.log('');

    if (sessionActive) {
      restoreCodexAppOverlay();
      sessionActive = false;
    }
    await maybeCloseRunningCodexApp();
    return 0;
  } finally {
    proxyHandle?.close();
    if (sessionActive) restoreCodexAppOverlay();
  }
}

export async function runCodexAppCommand(args: string[], opts: { vertex?: boolean; launchProvider?: string; launchModel?: string; codexLaunchMode?: 'mixed' | 'relay-only'; assumeYes?: boolean } = {}): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(codexAppHelpText());
    return 0;
  }

  if (args.includes('--restore')) {
    const result = restoreCodexAppOverlay();
    console.log(result.message);
    return result.liveSession ? 1 : 0;
  }

  const configOnly = args.includes('--config');
  if (opts.assumeYes && !configOnly) {
    if (opts.vertex || !opts.launchProvider || !opts.launchModel || !opts.codexLaunchMode) {
      console.error(pc.red('--yes requires --provider, --model, and either --with-native or --relay-only.'));
      return 1;
    }
  }

  try {
    codexAppSupported();
  } catch (err) {
    console.error(pc.red(String(err instanceof Error ? err.message : err)));
    return 1;
  }

  const interrupted = recoverInterruptedCodexAppSession();
  const trace = args.includes('--trace');
  const debugLogPath = getCodexProxyDebugLogPath();
  if (trace && !configOnly) {
    p.log.info(`Debug log: ${debugLogPath}`);
  }

  const isTty = Boolean(process.stdin.isTTY);
  if (!configOnly) {
    const sessionCheck = checkAppSessionLock(isTty || Boolean(opts.assumeYes));
    if (!sessionCheck.ok) {
      if (sessionCheck.reason === 'non_tty') {
        console.error(pc.red('relay-ai codex-app requires an interactive terminal.'));
        return 1;
      }
      console.error(pc.yellow(`Another relay-ai codex-app session may be running (pid ${sessionCheck.lock.pid}).`));
      console.error('Stop it with Ctrl+C in that terminal, or run relay-ai codex-app --restore after it exits.');
      return 1;
    }
  }

  if (!configOnly) {
    codexAppIntro();
    if (interrupted.recovered) {
      p.log.warn('Recovered from an interrupted codex-app session (restored Codex config).');
    }
  }

  if (opts.vertex) {
    return runCodexAppVertexLaunch(configOnly, trace);
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

  const compatible = codexCompatibleProviders(providersForPicker(catalog), 'codex-app');
  if (compatible.length === 0) {
    if (!configOnly) {
      p.log.warn('No Codex-compatible providers in your registry.');
      p.log.info('Add a provider with relay-ai providers add.');
    }
    return 0;
  }

  const prefs = loadPreferences();
  const favorites = prefs.favoriteModels ?? [];
  let mixedMode = opts.codexLaunchMode === 'mixed';
  if (!configOnly && isTty && !(opts.launchProvider && opts.launchModel) && opts.codexLaunchMode === undefined) {
    const selectedLaunchMode = await pickCodexLaunchMode();
    if (!selectedLaunchMode) return 0;
    mixedMode = selectedLaunchMode === 'mixed';
  }
  const favoritesActive = favorites.length > 0 && !mixedMode;

  if (favoritesActive && !configOnly) {
    p.log.info(
      `Favorites mode active — Codex App picker will show ${favorites.length + 1} models (1 starting + ${favorites.length} favorites).`,
    );
    p.log.info('Edit with `relay-ai models`.');
  }

  let activeProvider = providerForCodexPicker(
    compatible.find(lp => lp.id === prefs.lastCodexProvider) ?? compatible[0]!,
  );
  let selectedModel = activeProvider.models.find(m => m.id === prefs.lastCodexModel)
    ?? activeProvider.models[0]!;

  // --config must preview the exact unattended launch selection. Ignoring
  // explicit flags here made a safe preview silently show the previously saved
  // model instead of the requested provider/model pair.
  if (codexAppUsesExplicitSelection(configOnly, opts.launchProvider, opts.launchModel)) {
    const bootSelection = resolveBootSelection(
      compatible,
      opts.launchProvider!,
      opts.launchModel!,
      providerForCodexPicker,
    );
    if ('error' in bootSelection) {
      p.log.error(bootSelection.error);
      return 1;
    }
    activeProvider = bootSelection.provider;
    selectedModel = bootSelection.model;
  } else if (!configOnly) {
    let currentInitialProvider = prefs.lastCodexProvider && compatible.some(o => o.id === prefs.lastCodexProvider)
      ? prefs.lastCodexProvider
      : compatible[0]!.id;
    while (true) {
      const pickedProvider = await pickCodexProvider(compatible, prefs, favoritesActive, currentInitialProvider);
      if (!pickedProvider) return 0;
      
      if (pickedProvider === '__favorites__') {
        const favoritePick = await pickFavoriteStartingModel(
          compatible,
          favorites,
          'codex-app',
          'Codex App',
          providerForCodexPicker,
        );
        if (favoritePick === 'cancelled' || favoritePick === 'unavailable') return 0;
        activeProvider = favoritePick.provider;
        selectedModel = favoritePick.model;
        break;
      } else {
        activeProvider = providerForCodexPicker(pickedProvider as LocalProvider);
        const pickedModelResult = await pickCodexModel(activeProvider, prefs);
        if (pickedModelResult === 'back') {
          currentInitialProvider = activeProvider.id;
          continue;
        }
        if (!pickedModelResult) return 0;
        selectedModel = pickedModelResult;
        break;
      }
    }
  }

  const apiKey = await resolveLocalProviderApiKey(activeProvider);
  if (!apiKey) {
    if (!configOnly) {
      p.log.error(`No credential for ${activeProvider.name}. Run relay-ai providers auth ${activeProvider.id}.`);
    }
    return 1;
  }

  activeProvider.apiKey = apiKey;

  let cloudCodeBackend: CloudCodeBackend | null = null;
  let cloudCodeBackendFav: CloudCodeBackend | null = null;
  const appProviderRoutes = mixedMode || favoritesActive
    ? null
    : await buildCodexAppProviderCatalogRoutes(activeProvider, apiKey, selectedModel.id, trace);
  cloudCodeBackend = appProviderRoutes?.backend ?? null;

  const route = appProviderRoutes
    ? codexProxyRouteToCodexRoute(appProviderRoutes.selectedRoute, activeProvider.id)
    : resolveCodexRoute(activeProvider, selectedModel, apiKey);
  const appRoute = { ...route, tier: 'proxy' as const };
  const routable = appProviderRoutes?.routable ?? routableModelsForProvider(activeProvider, 'codex-app');
  const catalogModels = appProviderRoutes?.catalogModels ?? routable;

  let resolvedFavorites: ResolvedFavorite[] = [];
  let providersById: Map<string, LocalProvider> = new Map();

  if (favoritesActive) {
    const res = await resolveCodexFavorites(activeProvider, selectedModel, compatible, favorites, 'codex-app');
    resolvedFavorites = res.resolvedFavorites;
    providersById = res.providersById;
  }

  let mixedPlan: ReturnType<typeof buildCodexMixedLaunchPlan> | null = null;
  if (mixedMode) {
    try {
      const embeddedBinary = findEmbeddedCodexBinary();
      if (!embeddedBinary) throw new Error('Embedded ChatGPT/Codex runtime was not found; mixed Desktop mode is unavailable on this installation');
      const version = runCodexCommandSync(embeddedBinary, ['--version']).stdout.trim();
      const mixedModels = await resolveCodexMixedModels({
        activeProvider,
        selectedModel,
        compatible,
        generalFavorites: favorites,
        subagentFavorites: prefs.codexSubagentModels ?? [],
      });
      if (mixedModels.capacitySkipped.length > 0) {
        p.log.warn(
          `Skipped ${mixedModels.capacitySkipped.length} favorite(s) because the mixed catalog is full: `
            + mixedModels.capacitySkipped.map(f => `${f.providerId}:${f.modelId}`).join(', '),
        );
      }
      assertConfiguredCodexSubagentsResolved(prefs.codexSubagentModels ?? [], mixedModels);
      const multiAgentV2Supported = mixedModels.subagents.length === 0 || supportsMultiAgentV2(embeddedBinary);
      if (!multiAgentV2Supported) {
        throw new Error('This ChatGPT/Codex runtime does not support multi_agent_v2, which is required for the configured Codex SubAgent');
      }
      const nativeCatalog = await captureNativeCodexCatalog({ target: 'app', binaryPath: embeddedBinary, codexVersion: version });
      const preparedRoutes = await prepareCodexMixedRelayRoutes(mixedModels, trace);
      cloudCodeBackendFav = preparedRoutes.cloudCodeBackend;
      mixedPlan = buildCodexMixedLaunchPlan({
        nativeCatalog,
        models: mixedModels,
        relayRoutes: preparedRoutes.routes,
        multiAgentV2Supported,
      });
    } catch (err) {
      cloudCodeBackendFav?.handle.close();
      cloudCodeBackendFav = null;
      console.error(pc.red(`\nMixed Codex App mode is unavailable: ${err instanceof Error ? err.message : err}`));
      console.error('Use relay-ai codex-app --relay-only to continue with Relay models.');
      return 1;
    }
  }

  if (!configOnly && !opts.assumeYes) {
    const modelLabel = formatCodexModelLabel(selectedModel);
    const confirmed = await confirmCodexLaunch(
      activeProvider.name,
      modelLabel,
      selectedModel.id,
      appRoute,
    );
    if (!confirmed) {
      cloudCodeBackend?.handle.close();
      return 0;
    }
  }

  let proxyHandle: CodexProxyHandle | null = null;
  let sessionActive = false;
  try {
    const catalogPath = mixedPlan
      ? join(getRelayAiCodexDir(), 'app-models-mixed.json')
      : favoritesActive && resolvedFavorites.length > 0
        ? getFavoritesAppCatalogPath()
        : getAppCatalogPath(route.providerId);

    const activeRoute = mixedPlan ? {
      tier: 'proxy' as const,
      modelId: mixedPlan.selectedSlug,
      providerId: activeProvider.id,
      npm: '',
      upstreamModelId: '',
      apiKey: '',
      contextWindow: selectedModel.contextWindow,
    } : favoritesActive && resolvedFavorites.length > 0 ? {
      tier: 'proxy' as const,
      modelId: codexCliFavoritesSlug(activeProvider.id, selectedModel.id),
      providerId: activeProvider.id,
      npm: '',
      upstreamModelId: '',
      apiKey: '',
      contextWindow: selectedModel.contextWindow,
    } : appRoute;

    const specBase = { route: activeRoute, catalogPath };

    if (configOnly) {
      const home = process.env['HOME'] ?? '';
      const shortenPath = (fp: string) => home ? fp.replace(home, '~') : fp;

      console.log('');
      console.log(pc.bold(pc.cyan('  CONFIG PREVIEW — relay-ai codex-app')));
      console.log('');

      if (mixedPlan) {
        console.log(`  ${pc.bold('Mode:')}     Native + Relay mixed catalog`);
        console.log(`  ${pc.bold('Native:')}   ${mixedPlan.nativeModelIds.size} native Codex models`);
        console.log(`  ${pc.bold('Relay:')}    ${mixedPlan.relayRoutes.length} Relay routes (${mixedPlan.subagentModelCount} Codex SubAgent model)`);
      } else if (favoritesActive) {
        console.log(`  ${pc.bold('Mode:')}     Favorites Catalog (${resolvedFavorites.length} model${resolvedFavorites.length !== 1 ? 's' : ''})`);
        console.log('');
        console.log(`  ${pc.bold('Models:')}`);
        for (const r of resolvedFavorites) {
          console.log(`    ${pc.cyan(r.model.id)}  ${pc.dim(`(${r.providerName})`)}`);
        }
      } else {
        console.log(`  ${pc.bold('Mode:')}     Single model`);
        console.log(`  ${pc.bold('Provider:')} ${activeProvider.name}`);
        console.log(`  ${pc.bold('Model:')}    ${formatCodexModelLabel(selectedModel)}`);
        console.log(`  ${pc.bold('Catalog:')}  ${routable.length} model${routable.length !== 1 ? 's' : ''} available`);
      }

      console.log('');
      console.log(`  ${pc.bold('config.toml patch preview:')}`);
      const tomlPreview = previewAppConfigToml({
        ...specBase,
        proxyPort: PREVIEW_PROXY_PORT,
        ...(mixedPlan?.multiAgentV2Enabled ? { multiAgentV2Enabled: true } : {}),
        ...(mixedPlan ? { proxyBaseUrl: `${mixedProxyBaseUrl(PREVIEW_PROXY_PORT, mixedPlan.capability)}/v1` } : {}),
      });
      for (const line of tomlPreview.split('\n')) {
        console.log(`    ${pc.dim(line)}`);
      }

      console.log('');
      console.log(`  ${pc.bold('Catalog file:')}`);
      console.log(`    ${pc.dim(shortenPath(catalogPath))}`);
      console.log('');
      console.log(pc.dim('  No app was launched.'));
      console.log(pc.dim('  Run ') + pc.cyan('relay-ai codex-app') + pc.dim(' to launch.'));
      console.log('');

      return 0;
    }

    let proxyPort: number;
    const routeAuditPath = mixedPlan ? prepareCodexRouteAuditLog() : undefined;
    if (mixedPlan) {
      proxyHandle = await startCodexProxy(mixedPlan.relayRoutes, {
        requireAuth: false,
        debug: trace,
        routeAuditPath,
        mixedNative: {
          nativeModelIds: mixedPlan.nativeModelIds,
          subagentRouteModelId: mixedPlan.subagentRouteModelId,
          capability: mixedPlan.capability,
          nativePayloadRelayModel: mixedPlan.nativePayloadRelayModel,
        },
      });
      proxyPort = proxyHandle.port;
      p.log.info(`Route audit (metadata only): ${routeAuditPath}`);
    } else if (favoritesActive && resolvedFavorites.length > 0) {
      const needsBackend = (r: typeof resolvedFavorites[0]) => {
        const m = r.model as LocalProviderModel;
        const prov = providersById.get(r.providerId);
        return m.modelFormat === 'cloud-code'
          || (m.modelFormat === 'anthropic' && prov?.authType === 'oauth');
      };
      const backendResolved = resolvedFavorites.filter(needsBackend);
      const regularResolved = resolvedFavorites.filter(r => !needsBackend(r));

      let backendCodexRoutes: import('./codex-proxy.js').CodexProxyRoute[] = [];
      if (backendResolved.length > 0) {
        const backendRoutes: ProxyRoute[] = backendResolved.map(r => {
          const provider = providersById.get(r.providerId);
          const providerData = (provider?.providerData ?? {}) as Record<string, unknown>;
          const m = r.model as LocalProviderModel;
          const route = m.modelFormat === 'cloud-code'
            ? buildCloudCodeProxyRoute(m, r.apiKey, providerData)
            : buildOAuthAnthropicProxyRoute(m, r.apiKey, r.providerId, providerData);
          return { ...route, oauthAccountId: provider?.oauthAccountId, providerData };
        });
        const startingAlias = backendRoutes[0]!.aliasId;
        cloudCodeBackendFav = await startCloudCodeCatalogBackend(backendRoutes, startingAlias, trace);
        backendCodexRoutes = backendRoutes.map(cr => ({
          modelId: cr.aliasId,
          npm: '@ai-sdk/anthropic',
          apiKey: cloudCodeBackendFav!.token,
          baseURL: `http://127.0.0.1:${cloudCodeBackendFav!.port}`,
          upstreamModelId: cr.aliasId,
          providerId: cr.providerId ?? 'antigravity',
          authType: 'oauth' as const,
          oauthAccountId: cr.oauthAccountId,
          providerData: cr.providerData,
          contextWindow: cr.contextWindow,
        }));
      }

      const regularRoutes = buildCodexProxyRoutesFromResolved(regularResolved, providersById);
      proxyHandle = await startCodexProxy(
        [...backendCodexRoutes, ...regularRoutes],
        { requireAuth: false, debug: trace },
      );
      proxyPort = proxyHandle.port;
    } else {
      if (!appProviderRoutes) {
        throw new Error('Codex App provider routes were not initialized');
      }
      proxyHandle = await startCodexProxy(
        appProviderRoutes.routes,
        { requireAuth: false, debug: trace },
      );
      proxyPort = proxyHandle.port;
    }

    const modelLabel = formatCodexModelLabel(selectedModel);
    const catalogFile = mixedPlan
      ? mixedPlan.catalog
      : favoritesActive && resolvedFavorites.length > 0
        ? buildFavoritesAppCatalog(resolvedFavorites)
        : buildAppCatalogFile(catalogModels, activeProvider.name, appRoute.modelId);

    writeOverlayFile(catalogPath, serializeCatalog(catalogFile));

    const spec: CodexAppConfigSpec = {
      route: activeRoute,
      proxyPort,
      catalogPath,
      ...(mixedPlan?.multiAgentV2Enabled ? { multiAgentV2Enabled: true } : {}),
      ...(mixedPlan ? { proxyBaseUrl: `${mixedProxyBaseUrl(proxyPort, mixedPlan.capability)}/v1` } : {}),
    };

    saveAppRestoreStateBeforePatch();
    sessionActive = true;
    const backupPath = backupConfigToml();
    applyAppConfigPatch(spec);
    await verifyCodexAppReadiness(spec);

    writeAppSessionLock({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      configPath: getCodexConfigPath(),
      catalogPaths: [catalogPath],
      restoreStatePath: getAppRestoreStatePath(),
      backupPath,
      proxyPort,
      patchedConfigSha256: fileSha256(getCodexConfigPath()),
      ...(backupPath ? { originalConfigSha256: fileSha256(backupPath) } : {}),
    });

    const prevRecent = prefs.recentModelsByProvider?.[activeProvider.id] ?? [];
    const updatedRecent = [selectedModel.id, ...prevRecent.filter(id => id !== selectedModel.id)].slice(0, 3);
    savePreferences({
      lastCodexProvider: activeProvider.id,
      lastCodexModel: selectedModel.id,
      recentModelsByProvider: { ...prefs.recentModelsByProvider, [activeProvider.id]: updatedRecent },
    });

    logCodexProxy(proxyPort);

    logCodexActiveModel(modelLabel, selectedModel.id);

    try {
      await launchOrRestartCodexApp(undefined, opts.assumeYes);
    } catch (err) {
      p.log.warn(String(err instanceof Error ? err.message : err));
      p.log.info(codexAppInstallHint());
      throw err;
    }

    printCodexAppSessionPanel({
      modelLabel,
      modelId: selectedModel.id,
      providerName: activeProvider.name,
      restoreCommand: 'relay-ai codex-app --restore',
    });

    codexAppOutro(modelLabel);
    const shutdownSignal = await waitForShutdownWithConfirm();
    if (trace) printTraceLog(debugLogPath);
    console.log('');

    if (sessionActive) {
      restoreCodexAppOverlay();
      sessionActive = false;
    }
    if (unattendedShutdownClosesApp(Boolean(opts.assumeYes), shutdownSignal)) {
      if (isCodexAppRunning()) {
        p.log.step('Stopping ChatGPT Desktop after unattended Relay shutdown...');
        quitCodexAppGracefully();
      }
    } else {
      await maybeCloseRunningCodexApp();
    }
    return 0;
  } finally {
    proxyHandle?.close();
    if (cloudCodeBackend) {
      cloudCodeBackend.handle.close();
    }
    if (cloudCodeBackendFav) {
      cloudCodeBackendFav.handle.close();
    }
    if (sessionActive) restoreCodexAppOverlay();
  }
}
