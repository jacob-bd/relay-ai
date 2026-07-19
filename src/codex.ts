// codex.ts — relay-ai codex: launch OpenAI Codex CLI with registry providers
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { fetchProviderCatalog, providersForPicker, resolveLocalProviderApiKey } from './provider-catalog.js';
import { loadPreferences, recordLaunchSelection } from './config.js';
import { resolveApiKey, readFromCredentialStore } from './env.js';
import { resolveOrCollectApiKey } from './key-setup.js';
import { startCodexProxy } from './codex-proxy.js';
import type { CodexProxyHandle } from './codex-proxy.js';
import { buildCatalogFile, formatCodexModelLabel, serializeCatalog } from './codex/catalog.js';
import { buildCodexProfileToml, getCatalogOutputPath, getProfileOutputPath } from './codex/profile.js';
import { findCodexBinary, buildCodexChildEnv, launchCodex } from './codex/launch.js';
import { pickCodexProvider, pickCodexModel, confirmCodexLaunch, rejectManagedFlags } from './codex/prompts.js';
import {
  codexCliIntro,
  codexCliOutro,
  logCodexActiveModel,
  logCodexProxy,
  printCodexCliCleanupPanel,
} from './codex/ui.js';
import {
  codexCompatibleProviders,
  resolveCodexRoute,
  routableModelsForProvider,
  type CodexRoute,
} from './codex/routing.js';
import { getReasoningCapabilities } from './provider-factory.js';
import {
  checkSessionLock,
  recoverInterruptedCodexSession,
  remainingOverlayPaths,
  restoreCodexOverlay,
  writeOverlayFile,
  writeSessionLock,
} from './codex/session.js';
import {
  buildVertexRuntimeConfig,
  hasApplicationDefaultCredentials,
  type VertexModelEntry,
} from './server/vertex-config.js';
import { VERTEX_ANTHROPIC_NPM } from './constants.js';
import { resolveContextWindow } from './context-window.js';
import type { ResolvedFavorite } from './favorites-resolver.js';
import {
  buildFavoritesCodexCatalog,
  codexCliFavoritesSlug,
  defaultReasoningEffortForFavorite,
} from './codex/favorites-catalog.js';
import {
  buildCodexProxyRoutesFromResolved,
  pickFavoriteStartingModel,
  resolveCodexFavorites,
} from './codex/favorites-launch.js';
import { getFavoritesCatalogPath } from './codex/profile.js';
import type { LocalProvider, LocalProviderModel } from './types.js';
import {
  buildSingleModelCloudCodeRoute,
  needsCloudCodeBackend,
  partitionAndStartCloudCodeBackend,
  type CloudCodeBackend,
} from './cloud-code-backend.js';
import { getCodexProxyDebugLogPath, printTraceLog } from './trace-log.js';
import { setAgentStdoutMode, isAgentStdoutMode } from './agent-io.js';
import {
  findProviderAndModel,
  planLaunchWizard,
  wantsCleanAgentStdout,
} from './launch-target.js';

export { findCodexBinary } from './codex/launch.js';
export { codexCompatibleProviders } from './codex/routing.js';

export function codexHelpText(): string {
  return `${pc.bold('relay-ai codex')} — launch OpenAI Codex CLI with your registry providers

${pc.bold('Usage:')}
  relay-ai codex [options] [codex-flags]
  relay-ai codex --vertex
  relay-ai codex --restore
  relay-ai codex --config
  relay-ai codex --help
  relay-ai codex --version

${pc.bold('Options:')}
  --trace      Write proxy debug logs to ~/.relay-ai/logs/ and show errors on exit
  --provider   Boot provider id (skip wizard when paired with --model or non-interactive)
  --model      Boot model id (skip wizard when paired with --provider or non-interactive)
  --vertex     Use Claude models through Google Vertex AI
  --restore    Remove interrupted-session overlay files
  --config     Preview/write launch configuration without starting Codex
  --help       Show this command help
  --version    Show version

${pc.bold('Description:')}
  Picks a provider and model from ~/.relay-ai/providers.json, writes a temporary
  relay-ai-launch profile (never touches ~/.codex/config.toml), and launches Codex.
  Overlay files are removed automatically when Codex exits; use --restore after a crash.
  Anthropic and other registry models route through a local Responses API proxy.

${pc.bold('Prerequisites:')}
  npm install -g @openai/codex

${pc.bold('Cleanup:')}
  Temporary files: ~/.codex/relay-ai-launch.config.toml and ~/.relay-ai/codex/*
  Auto-removed on normal exit. After crash or force-quit: relay-ai codex --restore

${pc.bold('Passing flags to Codex:')}
  Add Codex flags directly — no "--" separator needed.
  relay-ai launches with sandbox disabled (danger-full-access) by default so shell
  tools can reach the network. Override with your own -s flag if you want a tighter sandbox.
  relay-ai manages --profile, -m, -p (profile), --provider, and --model; other flags go to Codex.
  See docs/CODEX.md for sandbox, network, and troubleshooting.

${pc.bold('OAuth:')}
  For ChatGPT Plus/Pro, run relay-ai providers auth openai-oauth first.

${pc.bold('Examples:')}
  relay-ai codex
  relay-ai codex --trace
  relay-ai codex --provider zen --model deepseek-v4-flash-free
  relay-ai codex --provider zen --model deepseek-v4-flash-free exec "fix the bug"
  relay-ai codex -s workspace-write
  relay-ai codex --restore
  relay-ai codex --help
${pc.bold('Favorites:')}
  When you have saved favorites via ${pc.cyan('relay-ai models')}, the Codex
  picker will show your starting model + favorites for mid-session switching.
  Zen/Go favorites are included when an OpenCode API key is available.`;
}

async function writeLaunchArtifacts(
  route: CodexRoute,
  selectedModel: import('./types.js').LocalProviderModel,
  providerName: string,
  proxyPort?: number,
): Promise<{ profilePath: string; catalogPath: string }> {
  const catalogPath = getCatalogOutputPath(route.providerId);
  const catalog = buildCatalogFile([selectedModel], providerName);
  writeOverlayFile(catalogPath, serializeCatalog(catalog));
  const profilePath = getProfileOutputPath();
  const caps = getReasoningCapabilities(route.npm, route.upstreamModelId, {
    providerId: route.providerId,
    apiBaseUrl: route.baseURL,
    supportedParameters: route.supportedParameters,
    reasoning: route.reasoning,
    interleavedReasoningField: route.interleavedReasoningField,
  });
  writeOverlayFile(profilePath, buildCodexProfileToml({
    route,
    proxyPort,
    catalogPath,
    modelReasoningEffort: caps.defaultLevel || undefined,
  }));
  return { profilePath, catalogPath };
}

async function writeFavoritesLaunchArtifacts(
  resolved: ResolvedFavorite[],
  starting: ResolvedFavorite,
  proxyPort: number,
): Promise<{ profilePath: string; catalogPath: string }> {
  const catalogPath = getFavoritesCatalogPath();
  const catalog = buildFavoritesCodexCatalog(undefined, resolved);
  writeOverlayFile(catalogPath, serializeCatalog(catalog));
  const profilePath = getProfileOutputPath();
  const model = starting.model as import('./types.js').LocalProviderModel;
  const dummyRoute: CodexRoute = {
    tier: 'proxy',
    modelId: codexCliFavoritesSlug(starting.providerId, model.id),
    providerId: 'relay-ai-proxy',
    npm: model.npm ?? '@ai-sdk/openai-compatible',
    upstreamModelId: model.upstreamModelId || model.id,
    apiKey: '',
  };
  writeOverlayFile(profilePath, buildCodexProfileToml({
    route: dummyRoute,
    proxyPort,
    catalogPath,
    modelReasoningEffort: defaultReasoningEffortForFavorite(starting),
  }));
  return { profilePath, catalogPath };
}

function printCodexCleanupReminder(hadProxy: boolean): void {
  if (isAgentStdoutMode()) return;
  const left = remainingOverlayPaths();
  if (left.length > 0) {
    p.log.warn('Temporary Codex overlay files may still be on disk.');
    p.log.info('Run: relay-ai codex --restore');
    return;
  }
  const parts = ['Temporary Codex profile removed.'];
  if (hadProxy) parts.push('Local Responses proxy stopped.');
  parts.push('If a future session acts stuck: relay-ai codex --restore');
  p.log.info(parts.join(' '));
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

async function runCodexVertexLaunch(
  passthroughArgs: string[],
  trace: boolean,
): Promise<number> {
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
      message: 'Select a Vertex AI model:',
      options: config.models.map(m => ({ value: m, label: m.display_name, hint: m.id })),
    });
    if (p.isCancel(choice)) { p.cancel('Cancelled.'); return 0; }
    selectedEntry = choice as VertexModelEntry;
  }

  process.env['ANTHROPIC_VERTEX_PROJECT_ID'] = config.project;
  process.env['GOOGLE_CLOUD_LOCATION'] = config.location;

  const vertexConfig = { project: config.project, location: config.location };
  const allModels = config.models.map(vertexEntryToLocalModel);
  const allRoutes = allModels.map(m => ({
    modelId: m.id,
    upstreamModelId: m.upstreamModelId,
    npm: VERTEX_ANTHROPIC_NPM,
    apiKey: '',
    providerId: 'vertex',
    vertex: vertexConfig,
  }));

  const startingRoute: CodexRoute = {
    tier: 'proxy',
    modelId: selectedEntry.id,
    upstreamModelId: selectedEntry.upstream_id ?? selectedEntry.id,
    npm: VERTEX_ANTHROPIC_NPM,
    apiKey: '',
    providerId: 'vertex',
  };

  const debugLogPath = getCodexProxyDebugLogPath();
  let proxyHandle: CodexProxyHandle | null = null;
  try {
    p.log.info(`Vertex AI · ${selectedEntry.display_name} — project: ${config.project} / location: ${config.location}`);
    proxyHandle = await startCodexProxy(allRoutes, { debug: trace });
    const proxyPort = proxyHandle.port;

    const catalogPath = getCatalogOutputPath('vertex');
    writeOverlayFile(catalogPath, serializeCatalog(buildCatalogFile(allModels, 'Vertex AI')));
    const profilePath = getProfileOutputPath();
    const caps = getReasoningCapabilities(VERTEX_ANTHROPIC_NPM, selectedEntry.id);
    writeOverlayFile(profilePath, buildCodexProfileToml({
      route: startingRoute,
      proxyPort,
      catalogPath,
      modelReasoningEffort: caps.defaultLevel || undefined,
    }));

    writeSessionLock({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      profilePath,
      catalogPaths: [catalogPath],
      proxyPort,
    });

    if (!isAgentStdoutMode()) {
      logCodexProxy(proxyPort);
      logCodexActiveModel(selectedEntry.display_name, selectedEntry.id);
      printCodexCliCleanupPanel('relay-ai codex --restore');
    }

    const childEnv = buildCodexChildEnv(startingRoute, proxyPort);
    const exitCode = await launchCodex(selectedEntry.id, childEnv, passthroughArgs);
    if (trace) printTraceLog(debugLogPath);
    printCodexCleanupReminder(true);
    return exitCode;
  } finally {
    proxyHandle?.close();
    restoreCodexOverlay();
  }
}

export async function runCodexCommand(
  codexArgs: string[],
  trace = false,
  launch: { launchProvider?: string; launchModel?: string; vertex?: boolean } = {},
): Promise<number> {
  if (codexArgs.includes('--help') || codexArgs.includes('-h')) {
    console.log(codexHelpText());
    return 0;
  }

  if (codexArgs.includes('--restore')) {
    const removed = restoreCodexOverlay();
    if (removed.length) {
      console.log(`Restored: removed ${removed.length} relay-ai Codex overlay file(s).`);
    } else {
      console.log('Nothing to restore.');
    }
    return 0;
  }

  const codexPath = findCodexBinary();
  if (!codexPath) {
    console.error(pc.red('\nError: codex binary not found on PATH.\n'));
    console.error('Install OpenAI Codex CLI:');
    console.error('  npm install -g @openai/codex\n');
    return 1;
  }

  const interrupted = recoverInterruptedCodexSession();

  const configOnly = codexArgs.includes('--config');
  const passthroughArgs = rejectManagedFlags(codexArgs.filter(a => a !== '--config'));
  const agentStdout = wantsCleanAgentStdout('codex', passthroughArgs);
  setAgentStdoutMode(agentStdout);
  const debugLogPath = getCodexProxyDebugLogPath();
  if (trace && !configOnly) {
    p.log.info(`Debug log: ${debugLogPath}`);
  }

  const isTty = Boolean(process.stdin.isTTY);
  if (launch.vertex) {
    if (!configOnly) {
      const sessionCheck = checkSessionLock(isTty);
      if (!sessionCheck.ok) {
        if (sessionCheck.reason === 'non_tty') {
          console.error(pc.red('relay-ai codex --vertex requires an interactive terminal.'));
          return 1;
        }
        console.error(pc.yellow(`Another relay-ai codex session may be running (pid ${sessionCheck.lock.pid}).`));
        console.error('Run relay-ai codex --restore to clean up, or wait for it to finish.');
        return 1;
      }
    }
    return runCodexVertexLaunch(passthroughArgs, trace);
  }

  const prefs = loadPreferences();
  const launchPlan = planLaunchWizard({
    explicit: { providerId: launch.launchProvider, modelId: launch.launchModel },
    childArgs: passthroughArgs,
    agent: 'codex',
    prefs,
  });
  if (launchPlan.error) {
    console.error(pc.red(`\nError: ${launchPlan.error}\n`));
    return 1;
  }
  const allowNonTty = !!(launchPlan.skip && launchPlan.target);

  if (!configOnly) {
    const sessionCheck = checkSessionLock(isTty || allowNonTty);
    if (!sessionCheck.ok) {
      if (sessionCheck.reason === 'non_tty') {
        console.error(pc.red(
          'relay-ai codex requires an interactive terminal (or use --provider and --model for non-interactive launch).',
        ));
        return 1;
      }
      console.error(pc.yellow(`Another relay-ai codex session may be running (pid ${sessionCheck.lock.pid}).`));
      console.error('Run relay-ai codex --restore to clean up, or wait for it to finish.');
      return 1;
    }
  }

  if (!configOnly) {
    if (!agentStdout) codexCliIntro();
    if (interrupted.recovered && !agentStdout) {
      p.log.warn(
        'Found leftover Codex files from an interrupted session (closed terminal, crash, or force-quit).',
      );
      p.log.info(
        `Removed ${interrupted.removedCount ?? 'those'} file(s) automatically. `
        + 'If anything still looks wrong: relay-ai codex --restore',
      );
    }
  }

  let catalog;
  if (agentStdout) {
    try {
      catalog = await fetchProviderCatalog({ agent: 'codex' });
    } catch (err) {
      console.error(pc.red(String(err instanceof Error ? err.message : err)));
      return 1;
    }
  } else {
    const catalogSpinner = p.spinner();
    catalogSpinner.start('Loading your providers...');
    try {
      catalog = await fetchProviderCatalog({ agent: 'codex' });
    } catch (err) {
      catalogSpinner.stop('');
      console.error(pc.red(String(err instanceof Error ? err.message : err)));
      return 1;
    }
    catalogSpinner.stop('');
  }

  const compatible = codexCompatibleProviders(providersForPicker(catalog), 'codex');
  if (compatible.length === 0) {
    if (!configOnly) {
      p.log.warn('No Codex-compatible providers in your registry.');
      p.log.info('Add a provider with relay-ai providers add, or sign in with relay-ai providers auth openai-oauth.');
    }
    return 0;
  }

  const favorites = prefs.favoriteModels ?? [];
  const favoritesActive = favorites.length > 0 && !launchPlan.skip;
  if (favoritesActive && !configOnly) {
    p.log.info(
      `Favorites mode active — Codex picker will show ${favorites.length + 1} models (1 starting + ${favorites.length} favorites).`,
    );
    p.log.info('Edit with `relay-ai models`.');
  }
  let activeProvider = compatible.find(lp => lp.id === prefs.lastCodexProvider) ?? compatible[0]!;
  let selectedModel = activeProvider.models.find(m => m.id === prefs.lastCodexModel) ?? activeProvider.models[0]!;

  if (!configOnly && launchPlan.skip && launchPlan.target) {
    const resolved = findProviderAndModel(compatible, launchPlan.target);
    if (!resolved) {
      p.log.error(
        `Provider/model not found: ${launchPlan.target.providerId} / ${launchPlan.target.modelId}`,
      );
      return 1;
    }
    activeProvider = resolved.provider;
    selectedModel = resolved.model;
    if (!agentStdout) {
      p.log.step(`Using ${selectedModel.name || selectedModel.id} (${activeProvider.name})`);
    }
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
          'codex',
          'Codex',
          provider => ({ ...provider, models: routableModelsForProvider(provider, 'codex') }),
        );
        if (favoritePick === 'cancelled' || favoritePick === 'unavailable') return 0;
        activeProvider = favoritePick.provider;
        selectedModel = favoritePick.model;
        break;
      } else {
        activeProvider = pickedProvider as LocalProvider;
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

  let resolvedFavorites: ResolvedFavorite[] = [];
  let providersById: Map<string, LocalProvider> = new Map();

  if (favoritesActive) {
    const res = await resolveCodexFavorites(
      activeProvider,
      selectedModel,
      compatible,
      favorites,
      'codex',
    );
    resolvedFavorites = res.resolvedFavorites;
    providersById = res.providersById;
  }

  const apiKey = await resolveLocalProviderApiKey(activeProvider);
  if (!apiKey) {
    if (!configOnly) {
      p.log.error(`No credential for ${activeProvider.name}. Run relay-ai providers auth ${activeProvider.id} or add an API key.`);
    }
    return 1;
  }

  const route = resolveCodexRoute(activeProvider, selectedModel, apiKey);

  if (!configOnly && !(launchPlan.skip && launchPlan.target)) {
    const modelLabel = formatCodexModelLabel(selectedModel);
    const confirmed = await confirmCodexLaunch(
      activeProvider.name,
      modelLabel,
      selectedModel.id,
      route,
    );
    if (!confirmed) return 0;
  }

  let proxyHandle: CodexProxyHandle | null = null;
  let cloudCodeBackend: CloudCodeBackend | null = null;
  let cloudCodeBackendFav: CloudCodeBackend | null = null;
  try {
    let proxyPort: number | undefined;
    if (favoritesActive && resolvedFavorites.length > 0) {
      const needsBackend = (r: typeof resolvedFavorites[0]) => {
        const m = r.model as LocalProviderModel;
        const prov = providersById.get(r.providerId);
        return needsCloudCodeBackend(m, prov?.authType);
      };
      const backendResolved = resolvedFavorites.filter(needsBackend);
      const regularResolved = resolvedFavorites.filter(r => !needsBackend(r));

      let backendCodexRoutes: import('./codex-proxy.js').CodexProxyRoute[] = [];

      if (backendResolved.length > 0) {
        const partitioned = await partitionAndStartCloudCodeBackend(
          backendResolved.map(r => {
            const provider = providersById.get(r.providerId);
            return {
              providerId: r.providerId,
              model: r.model as LocalProviderModel,
              apiKey: r.apiKey,
              oauthAccountId: provider?.oauthAccountId,
              providerData: (provider?.providerData ?? {}) as Record<string, unknown>,
            };
          }),
          (cr, backend, original) => ({
            modelId: cr.aliasId,
            npm: '@ai-sdk/anthropic',
            apiKey: backend.token,
            baseURL: `http://127.0.0.1:${backend.port}`,
            upstreamModelId: cr.aliasId,
            providerId: cr.providerId ?? 'antigravity',
            authType: 'oauth' as const,
            oauthAccountId: original.oauthAccountId,
            providerData: original.providerData,
            contextWindow: cr.contextWindow,
          }),
          trace,
        );
        cloudCodeBackendFav = partitioned.backend;
        backendCodexRoutes = partitioned.backendItems;
      }

      const regularRoutes = buildCodexProxyRoutesFromResolved(regularResolved, providersById);
      const allRoutes = [...backendCodexRoutes, ...regularRoutes];

      proxyHandle = await startCodexProxy(allRoutes, { requireAuth: true, debug: trace });
      proxyPort = proxyHandle.port;
    } else if (route.tier === 'cloud-code') {
      const providerData = (activeProvider.providerData ?? {}) as Record<string, unknown>;
      const { proxyRoute: cloudRoute, backend } = await buildSingleModelCloudCodeRoute(
        selectedModel,
        apiKey,
        route.providerId,
        providerData,
        trace,
      );
      cloudCodeBackend = backend;
      proxyHandle = await startCodexProxy([{
        modelId: cloudRoute.aliasId,
        npm: '@ai-sdk/anthropic',
        apiKey: cloudCodeBackend.token,
        baseURL: `http://127.0.0.1:${cloudCodeBackend.port}`,
        upstreamModelId: cloudRoute.aliasId,
        providerId: route.providerId,
        authType: route.authType,
        oauthAccountId: route.oauthAccountId,
        providerData,
        contextWindow: route.contextWindow,
        supportedParameters: route.supportedParameters,
        reasoning: route.reasoning,
        interleavedReasoningField: route.interleavedReasoningField,
      }], { debug: trace });
      proxyPort = proxyHandle.port;
    } else if (route.authType === 'oauth' && selectedModel.modelFormat === 'anthropic') {
      const providerData = (activeProvider.providerData ?? {}) as Record<string, unknown>;
      const { proxyRoute: oauthRoute, backend } = await buildSingleModelCloudCodeRoute(
        selectedModel,
        apiKey,
        route.providerId,
        providerData,
        trace,
      );
      cloudCodeBackend = backend;
      proxyHandle = await startCodexProxy([{
        modelId: oauthRoute.aliasId,
        npm: '@ai-sdk/anthropic',
        apiKey: cloudCodeBackend.token,
        baseURL: `http://127.0.0.1:${cloudCodeBackend.port}`,
        upstreamModelId: oauthRoute.aliasId,
        providerId: route.providerId,
        authType: route.authType,
        oauthAccountId: route.oauthAccountId,
        providerData,
        contextWindow: route.contextWindow,
        supportedParameters: route.supportedParameters,
        reasoning: route.reasoning,
        interleavedReasoningField: route.interleavedReasoningField,
      }], { debug: trace });
      proxyPort = proxyHandle.port;
    } else if (route.tier === 'proxy') {
      proxyHandle = await startCodexProxy([{
        modelId: route.modelId,
        npm: route.npm,
        apiKey: route.apiKey,
        baseURL: route.baseURL,
        upstreamModelId: route.upstreamModelId,
        providerId: route.providerId,
        authType: route.authType,
        oauthAccountId: route.oauthAccountId,
        providerData: route.providerData,
        supportedParameters: route.supportedParameters,
        reasoning: route.reasoning,
        interleavedReasoningField: route.interleavedReasoningField,
        headers: route.headers,
      }], { debug: trace });
      proxyPort = proxyHandle.port;
    }

    const startingFavorite = resolvedFavorites.find(
      r => r.providerId === activeProvider.id && r.model.id === selectedModel.id,
    ) ?? resolvedFavorites[0];
    const { profilePath, catalogPath } = favoritesActive && resolvedFavorites.length > 0 && proxyPort && startingFavorite
      ? await writeFavoritesLaunchArtifacts(resolvedFavorites, startingFavorite, proxyPort)
      : await writeLaunchArtifacts(route, selectedModel, activeProvider.name, proxyPort);

    writeSessionLock({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      profilePath,
      catalogPaths: [catalogPath],
      proxyPort,
    });

    if (configOnly) {
      const home = process.env['HOME'] ?? '';
      const shortenPath = (p: string) => home ? p.replace(home, '~') : p;

      console.log('');
      console.log(pc.bold(pc.cyan('  CONFIG PREVIEW — relay-ai codex')));
      console.log('');

      if (favoritesActive && resolvedFavorites.length > 0) {
        console.log(`  ${pc.bold('Mode:')}     Favorites Catalog (${resolvedFavorites.length} model${resolvedFavorites.length !== 1 ? 's' : ''})`);
        console.log('');
        console.log(`  ${pc.bold('Models:')}`);
        for (const r of resolvedFavorites) {
          console.log(`    ${pc.cyan(r.model.id)}  ${pc.dim(`(${r.providerName})`)}`);
        }
      } else {
        console.log(`  ${pc.bold('Mode:')}     Single model`);
        console.log(`  ${pc.bold('Provider:')} ${activeProvider.name}`);
        console.log(`  ${pc.bold('Model:')}    ${selectedModel.id}`);
      }

      console.log('');
      console.log(`  ${pc.bold('Files written:')}`);
      console.log(`    ${pc.dim(shortenPath(profilePath))}`);
      console.log(`    ${pc.dim(shortenPath(catalogPath))}`);
      console.log('');
      console.log(pc.dim('  No Codex process was started.'));
      console.log(pc.dim('  Run ') + pc.cyan('relay-ai codex') + pc.dim(' to launch.'));
      console.log('');

      restoreCodexOverlay();
      return 0;
    }

    recordLaunchSelection('codex', activeProvider.id, selectedModel.id, prefs);

    const modelLabel = formatCodexModelLabel(selectedModel);

    if (!agentStdout) {
      if ((route.tier === 'proxy' || route.tier === 'cloud-code') && proxyPort) {
        logCodexProxy(proxyPort);
      }
    }

    const favoritesLaunch = favoritesActive && resolvedFavorites.length > 0;
    const launchModelId = favoritesLaunch
      ? codexCliFavoritesSlug(activeProvider.id, selectedModel.id)
      : selectedModel.id;
    if (!agentStdout) {
      logCodexActiveModel(modelLabel, launchModelId);
      printCodexCliCleanupPanel('relay-ai codex --restore');
      codexCliOutro(activeProvider.name, modelLabel, launchModelId);
    }
    const dummyRoute: CodexRoute = {
      tier: 'proxy',
      modelId: launchModelId,
      providerId: 'relay-ai-proxy',
      npm: selectedModel.npm ?? '@ai-sdk/openai-compatible',
      upstreamModelId: selectedModel.upstreamModelId || selectedModel.id,
      apiKey: '',
    };
    const childEnv = buildCodexChildEnv(
      (favoritesLaunch || route.tier === 'cloud-code') ? dummyRoute : route,
      proxyPort,
    );
    const hadProxy = (route.tier === 'proxy' || route.tier === 'cloud-code' || favoritesLaunch) && !!proxyPort;
    const exitCode = await launchCodex(launchModelId, childEnv, passthroughArgs);
    if (trace) printTraceLog(debugLogPath);
    printCodexCleanupReminder(hadProxy);
    return exitCode;
  } finally {
    proxyHandle?.close();
    if (cloudCodeBackend) {
      cloudCodeBackend.handle.close();
    }
    if (cloudCodeBackendFav) {
      cloudCodeBackendFav.handle.close();
    }
    restoreCodexOverlay();
  }
}
