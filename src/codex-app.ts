// codex-app.ts — relay-ai codex-app: launch Codex desktop app with registry providers
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { fetchProviderCatalog, providersForPicker } from './provider-catalog.js';
import { loadPreferences, savePreferences } from './config.js';
import { resolveProviderCredential, resolveApiKey, readFromCredentialStore } from './env.js';
import { resolveOrCollectApiKey } from './key-setup.js';
import { oauthAuthRef } from './registry/import-build.js';
import { loadRegistry } from './registry/io.js';
import { startCodexProxy } from './codex-proxy.js';
import type { CodexProxyHandle } from './codex-proxy.js';
import { getCodexProxyDebugLogPath, printTraceLog } from './trace-log.js';
import { buildAppCatalogFile, formatCodexModelLabel, serializeCatalog } from './codex/catalog.js';
import { pickCodexProvider, pickCodexModel, confirmCodexLaunch } from './codex/prompts.js';
import {
  codexCompatibleProviders,
  resolveCodexRoute,
  routableModelsForProvider,
  buildCodexProxyRoutesForProvider,
} from './codex/routing.js';
import { applyAppConfigPatch, previewAppConfigToml } from './codex/app-config.js';
import { PREVIEW_PROXY_PORT, type CodexAppConfigSpec } from './codex/app-profile.js';
import type { LocalProvider, LocalProviderModel } from './types.js';
import {
  backupConfigToml,
  checkAppSessionLock,
  getAppCatalogPath,
  getAppRestoreStatePath,
  getCodexConfigPath,
  recoverInterruptedCodexAppSession,
  restoreCodexAppOverlay,
  saveAppRestoreStateBeforePatch,
  waitForShutdown,
  writeAppSessionLock,
} from './codex/app-session.js';
import { writeOverlayFile } from './codex/session.js';
import { codexAppInstallHint, codexAppSupported, launchOrRestartCodexApp, isCodexAppRunning, quitCodexAppGracefully } from './codex/app-launch.js';
import {
  codexAppIntro,
  codexAppOutro,
  logCodexActiveModel,
  logCodexProxy,
  printCodexAppSessionPanel,
} from './codex/ui.js';
import { resolveFirstAvailableFavorite, type ResolvedFavorite } from './favorites-resolver.js';
import { buildFavoritesAppCatalog, codexCliFavoritesSlug } from './codex/favorites-catalog.js';
import {
  buildVertexRuntimeConfig,
  hasApplicationDefaultCredentials,
  type VertexModelEntry,
} from './server/vertex-config.js';
import { VERTEX_ANTHROPIC_NPM } from './constants.js';
import { resolveContextWindow } from './context-window.js';
import { buildCodexProxyRoutesFromResolved, resolveCodexFavorites } from './codex/favorites-launch.js';
import { getFavoritesAppCatalogPath } from './codex/profile.js';

async function waitForShutdownWithConfirm(): Promise<void> {
  while (true) {
    const signal = await waitForShutdown();
    if (signal !== 'sigint') break; // SIGTERM/SIGHUP: close immediately, no one to ask
    console.log('');
    const choice = await p.select({
      message: 'Close Codex Desktop and restore your Codex config?',
      options: [
        { value: 'yes', label: 'Yes, close Codex and restore config' },
        { value: 'no', label: 'No, keep session running' },
      ],
    });
    if (p.isCancel(choice) || choice === 'yes') break; // Ctrl+C or Yes = close
    // confirmed === false means user typed 'n' → loop back and keep waiting
  }
}

export function codexAppHelpText(): string {
  return `${pc.bold('relay-ai codex-app')} — launch Codex desktop app with your registry providers

${pc.bold('Usage:')}
  relay-ai codex-app [options]
  relay-ai codex-app --vertex
  relay-ai codex-app --restore
  relay-ai codex-app --config
  relay-ai codex-app --help
  relay-ai codex-app --version

${pc.bold('Options:')}
  --vertex     Use Claude models through Google Vertex AI
  --restore    Restore Codex config after an interrupted app session
  --config     Preview the generated Codex app configuration without launching
  --trace      Write proxy debug logs to ~/.relay-ai/logs/ and show errors on exit
  --help       Show this command help
  --version    Show version

${pc.bold('Description:')}
  Picks a provider and model from ~/.relay-ai/providers.json, patches ~/.codex/config.toml
  (with backup + restore on Ctrl+C), starts a local Responses proxy, and opens the
  Codex desktop app. Keep this terminal open while using Codex.

${pc.bold('Platforms:')}
  macOS and Windows. Linux is not supported (no Codex desktop app).

${pc.bold('Cleanup:')}
  Ctrl+C stops the proxy and restores your previous Codex config.
  After crash: relay-ai codex-app --restore

${pc.bold('Preview (no writes):')}
  relay-ai codex-app --config

  See docs/CODEX.md for CLI vs app, files touched, and restore.

${pc.bold('Examples:')}
  relay-ai codex-app
  relay-ai codex-app --vertex
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
    const backupPath = backupConfigToml();
    applyAppConfigPatch(spec);

    writeAppSessionLock({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      configPath: getCodexConfigPath(),
      catalogPaths: [catalogPath],
      restoreStatePath: getAppRestoreStatePath(),
      backupPath,
      proxyPort,
    });
    sessionActive = true;

    p.log.info(`Vertex AI · ${selectedEntry.display_name} — project: ${config.project} / location: ${config.location}`);
    logCodexProxy(proxyPort);
    logCodexActiveModel(selectedEntry.display_name, selectedEntry.id);

    try {
      await launchOrRestartCodexApp();
    } catch (err) {
      p.log.warn(String(err instanceof Error ? err.message : err));
      p.log.info(codexAppInstallHint());
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

    if (isCodexAppRunning()) {
      p.log.step('Stopping Codex Desktop...');
      quitCodexAppGracefully();
    }

    if (sessionActive) {
      restoreCodexAppOverlay();
      sessionActive = false;
    }
    return 0;
  } finally {
    proxyHandle?.close();
    if (sessionActive) restoreCodexAppOverlay();
  }
}

export async function runCodexAppCommand(args: string[], opts: { vertex?: boolean } = {}): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(codexAppHelpText());
    return 0;
  }

  if (args.includes('--restore')) {
    const result = restoreCodexAppOverlay();
    console.log(result.message);
    return result.liveSession ? 1 : 0;
  }

  try {
    codexAppSupported();
  } catch (err) {
    console.error(pc.red(String(err instanceof Error ? err.message : err)));
    return 1;
  }

  const interrupted = recoverInterruptedCodexAppSession();
  const configOnly = args.includes('--config');
  const trace = args.includes('--trace');
  const debugLogPath = getCodexProxyDebugLogPath();
  if (trace && !configOnly) {
    p.log.info(`Debug log: ${debugLogPath}`);
  }

  const isTty = Boolean(process.stdin.isTTY);
  if (!configOnly) {
    const sessionCheck = checkAppSessionLock(isTty);
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
  const favoritesActive = favorites.length > 0;

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

  if (!configOnly) {
    let currentInitialProvider = prefs.lastCodexProvider && compatible.some(o => o.id === prefs.lastCodexProvider)
      ? prefs.lastCodexProvider
      : compatible[0]!.id;
    while (true) {
      const pickedProvider = await pickCodexProvider(compatible, prefs, favoritesActive, currentInitialProvider);
      if (!pickedProvider) return 0;
      
      if (pickedProvider === '__favorites__') {
        const favoriteProviders = compatible.map(providerForCodexPicker);
        const available: Array<{ provider: LocalProvider; model: LocalProviderModel }> = [];
        for (const fav of favorites) {
          const prov = favoriteProviders.find(lp => lp.id === fav.providerId);
          const mod = prov?.models.find(m => m.id === fav.modelId);
          if (prov && mod) available.push({ provider: prov, model: mod });
        }
        if (available.length === 0) {
          p.log.warn('No saved Codex App favorites are currently available.');
          return 0;
        }
        const favOptions = available.map((f, i) => ({
          value: String(i),
          label: `${f.model.name || f.model.id} — ${f.provider.name}`,
          hint: f.model.id,
        }));
        const pickedIdx = await p.select<string>({
          message: 'Starting model?',
          options: favOptions,
          initialValue: '0',
        });
        if (p.isCancel(pickedIdx)) { p.cancel('Cancelled.'); return 0; }
        const sel = available[Number(pickedIdx)]!;
        activeProvider = sel.provider;
        selectedModel = sel.model;
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

  const regEntry = loadRegistry().providers.find(pr => pr.id === activeProvider.id);
  const authRef = regEntry?.authRef
    ?? (activeProvider.apiKey ? `keyring:provider:${activeProvider.id}` : oauthAuthRef(activeProvider.id));
  const apiKey = activeProvider.apiKey?.trim()
    || await resolveProviderCredential(activeProvider.id, authRef);
  if (!apiKey) {
    if (!configOnly) {
      p.log.error(`No credential for ${activeProvider.name}. Run relay-ai providers auth ${activeProvider.id}.`);
    }
    return 1;
  }

  activeProvider.apiKey = apiKey;

  const route = resolveCodexRoute(activeProvider, selectedModel, apiKey);
  const appRoute = { ...route, tier: 'proxy' as const };
  const routable = routableModelsForProvider(activeProvider, 'codex-app');

  let resolvedFavorites: ResolvedFavorite[] = [];
  let providersById: Map<string, LocalProvider> = new Map();

  if (favoritesActive) {
    let zenGoApiKey: string | null = null;
    const hasZenGo = favorites.some(f => f.providerId === 'zen' || f.providerId === 'go') || activeProvider.id === 'zen' || activeProvider.id === 'go';
    if (hasZenGo) {
      if (!configOnly) {
        zenGoApiKey = await resolveOrCollectApiKey(false, false);
      } else {
        const existing = resolveApiKey();
        if (existing) {
          zenGoApiKey = existing;
        } else {
          const stored = await readFromCredentialStore(() => {});
          if (stored) {
            zenGoApiKey = stored;
          }
        }
      }
    }
    const res = resolveCodexFavorites(activeProvider, selectedModel, compatible, favorites, 'codex-app', zenGoApiKey);
    resolvedFavorites = res.resolvedFavorites;
    providersById = res.providersById;
  }

  if (!configOnly) {
    const modelLabel = formatCodexModelLabel(selectedModel);
    const confirmed = await confirmCodexLaunch(
      activeProvider.name,
      modelLabel,
      selectedModel.id,
      appRoute,
    );
    if (!confirmed) return 0;
  }

  let proxyHandle: CodexProxyHandle | null = null;
  let sessionActive = false;
  try {
    const catalogPath = favoritesActive && resolvedFavorites.length > 0
      ? getFavoritesAppCatalogPath()
      : getAppCatalogPath(route.providerId);

    const activeRoute = favoritesActive && resolvedFavorites.length > 0 ? {
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

      if (favoritesActive) {
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

    const proxyPort = favoritesActive && resolvedFavorites.length > 0
      ? (proxyHandle = await startCodexProxy(
        buildCodexProxyRoutesFromResolved(resolvedFavorites, providersById),
        { requireAuth: false, debug: trace },
      )).port
      : (proxyHandle = await startCodexProxy(
        buildCodexProxyRoutesForProvider(activeProvider, apiKey, selectedModel.id, 'codex-app'),
        { requireAuth: false, debug: trace },
      )).port;

    const modelLabel = formatCodexModelLabel(selectedModel);
    const catalogFile = favoritesActive && resolvedFavorites.length > 0
      ? buildFavoritesAppCatalog(resolvedFavorites)
      : buildAppCatalogFile(routable, activeProvider.name, selectedModel.id);

    writeOverlayFile(catalogPath, serializeCatalog(catalogFile));

    const spec: CodexAppConfigSpec = {
      route: activeRoute,
      proxyPort,
      catalogPath,
    };

    saveAppRestoreStateBeforePatch();
    const backupPath = backupConfigToml();
    applyAppConfigPatch(spec);

    writeAppSessionLock({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      configPath: getCodexConfigPath(),
      catalogPaths: [catalogPath],
      restoreStatePath: getAppRestoreStatePath(),
      backupPath,
      proxyPort,
    });
    sessionActive = true;

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
      await launchOrRestartCodexApp();
    } catch (err) {
      p.log.warn(String(err instanceof Error ? err.message : err));
      p.log.info(codexAppInstallHint());
    }

    printCodexAppSessionPanel({
      modelLabel,
      modelId: selectedModel.id,
      providerName: activeProvider.name,
      restoreCommand: 'relay-ai codex-app --restore',
    });

    codexAppOutro(modelLabel);
    await waitForShutdownWithConfirm();
    if (trace) printTraceLog(debugLogPath);
    console.log('');

    if (isCodexAppRunning()) {
      p.log.step('Stopping Codex Desktop...');
      quitCodexAppGracefully();
    }

    if (sessionActive) {
      restoreCodexAppOverlay();
      sessionActive = false;
    }
    return 0;
  } finally {
    proxyHandle?.close();
    if (sessionActive) restoreCodexAppOverlay();
  }
}
