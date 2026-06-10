// src/cli.ts
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findClaudeBinary, launchClaude } from './launch.js';
import { resolveApiKey, detectConflicts, buildChildEnv } from './env.js';
import { resolveOrCollectApiKey } from './key-setup.js';
import { needsFirstRunSetup, runFirstRunWizard } from './first-run.js';
import { MAX_MODEL_CATALOG } from './constants.js';
import { startProxy, startProxyCatalog } from './proxy.js';
import type { ProxyHandle, ProxyRoute } from './proxy.js';
import {
  buildCatalogRoutes,
  localModelToRoute,
  makeRouteResolver,
  zenGoModelToRoute,
} from './catalog.js';
import { runServerCommand } from './server/index.js';
import type { ModelFormat } from './types.js';
import { loadPreferences, savePreferences } from './config.js';
import { pickLocalModel, browseAllModels } from './prompts.js';
import { fetchProviderCatalog, fetchZenGoModels, providersForPicker } from './provider-catalog.js';
import { BACKENDS, VERSION } from './constants.js';
import type { ParsedArgs, ModelInfo, FavoriteModel } from './types.js';
import { addFavorite, removeFavorite } from './favorites.js';
import { runProvidersCommand, providersHelpText } from './providers-command.js';
import { prepareClaudeTraceLog, printTraceLog } from './trace-log.js';
const STARTER_CLAUDE_FLAGS = new Set(['--dry-run', '--setup', '--trace', '--help', '-h', '--version', '-v']);

function emptyParsed(command: ParsedArgs['command']): ParsedArgs {
  return {
    command,
    showHelp: false,
    showVersion: false,
    dryRun: false,
    setup: false,
    trace: false,
    vertex: false,
    claudeArgs: [],
  };
}

export function parseArgs(args: string[]): ParsedArgs {
  if (args.length === 0) return { ...emptyParsed('root'), showHelp: true };

  const [first, ...rest] = args;

  if (first === '--help' || first === '-h') {
    return { ...emptyParsed('root'), showHelp: true };
  }
  if (first === '--version' || first === '-v') {
    return { ...emptyParsed('root'), showVersion: true };
  }

  if (first === 'server') {
    const parsed = emptyParsed('server');
    for (const arg of rest) {
      if (arg === '--help' || arg === '-h') parsed.showHelp = true;
      else if (arg === '--version' || arg === '-v') parsed.showVersion = true;
      else if (arg === '--vertex') parsed.vertex = true;
      else if (!parsed.error) parsed.error = `Unknown server option: ${arg}`;
    }
    return parsed;
  }

  if (first === 'models') {
    const parsed = emptyParsed('models');
    for (const arg of rest) {
      if (arg === '--help' || arg === '-h') parsed.showHelp = true;
      else if (arg === '--version' || arg === '-v') parsed.showVersion = true;
      else if (!parsed.error) parsed.error = `Unknown models option: ${arg}`;
    }
    return parsed;
  }

  if (first === 'providers') {
    const parsed = emptyParsed('providers');
    parsed.claudeArgs = rest;
    for (const arg of rest) {
      if (arg === '--help' || arg === '-h') parsed.showHelp = true;
      else if (arg === '--version' || arg === '-v') parsed.showVersion = true;
    }
    return parsed;
  }

  if (first !== 'claude') {
    return {
      ...emptyParsed('root'),
      error: first.startsWith('-') ? `Unknown root option: ${first}` : `Unknown command: ${first}`,
    };
  }

  const parsed = emptyParsed('claude');
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]!;
    if (arg === '--') {
      parsed.claudeArgs.push(...rest.slice(i + 1));
      break;
    }

    if (!STARTER_CLAUDE_FLAGS.has(arg)) {
      parsed.claudeArgs.push(arg);
      continue;
    }

    if (arg === '--dry-run') parsed.dryRun = true;
    if (arg === '--setup') parsed.setup = true;
    if (arg === '--trace') parsed.trace = true;
    if (arg === '--help' || arg === '-h') parsed.showHelp = true;
    if (arg === '--version' || arg === '-v') parsed.showVersion = true;
  }

  return parsed;
}

export function rootHelpText(): string {
  return `${pc.bold('relay-ai')} v${VERSION}
Launch AI coding tools with OpenCode Zen, Go, or local providers (Groq, Mistral,
OpenAI, Gemini, Ollama, and more).

${pc.bold('Usage:')}
  relay-ai claude [options] [claude-flags]
  relay-ai models
  relay-ai providers
  relay-ai server
  relay-ai --help
  relay-ai --version

${pc.bold('Commands:')}
  claude      Launch Claude Code — cloud Zen/Go or local OpenCode providers
  models      Manage favorite models for mid-session /model switching (max ${MAX_MODEL_CATALOG})
  providers   Add, import, and manage your AI providers
  server      Run a foreground API gateway (Zen, Go, and local providers)
  codex       planned

${pc.bold('Migration:')}
  Bare relay-ai prints this help instead of launching Claude Code.
  Use relay-ai claude for the wizard and launcher.

${pc.bold('Examples:')}
  relay-ai claude
  relay-ai models
  relay-ai server
  relay-ai claude -c
  relay-ai claude --resume abc-123
  relay-ai claude -- --print "hello"`;
}

export function claudeHelpText(): string {
  return `${pc.bold('relay-ai claude')} v${VERSION}
Launch Claude Code with OpenCode Zen, Go, or local providers as the API backend.

${pc.bold('Usage:')}
  relay-ai claude [options] [claude-flags]
  relay-ai claude --help
  relay-ai claude --version

${pc.bold('Options:')}
  --dry-run    Run the wizard but show a preview instead of launching Claude Code
  --setup      Re-configure your subscription tier
  --trace      Write debug logs to ~/.relay-ai/logs/ and show errors on exit
  --help       Show this command help
  --version    Show version

${pc.bold('Providers:')}
  Cloud (Zen/Go)  Requires OPENCODE_API_KEY — get one at https://opencode.ai/auth
  Local           Requires OpenCode CLI with providers configured (Groq, Mistral,
                  OpenAI, Gemini, Ollama, etc.). Shown in the wizard when available.

${pc.bold('Model switching:')}
  Run relay-ai models to save favorites (max ${MAX_MODEL_CATALOG}).
  When favorites exist, launch starts a multi-route proxy and Claude Code /model
  lists your starting model plus favorites for live switching.
  With no favorites, launch uses a single model as before.

${pc.bold('Note:')}
  Claude Code may save the launched model to ~/.claude/settings.json.
  Bare claude later can still show that model — reset with claude --model sonnet.

${pc.bold('Examples:')}
  relay-ai claude
  relay-ai claude -c
  relay-ai claude --resume abc-123
  relay-ai claude abc-123
  relay-ai claude --dry-run -c
  relay-ai claude --setup
  relay-ai claude --trace --resume abc-123
  relay-ai claude -- --print "hello"
  relay-ai claude -- --dangerously-skip-permissions`;
}

export function serverHelpText(): string {
  return `${pc.bold('relay-ai server')} v${VERSION}
Run a foreground API gateway for Zen, Go, local OpenCode providers, or Vertex AI.

${pc.bold('Usage:')}
  relay-ai server
  relay-ai server --vertex
  relay-ai server --help
  relay-ai server --version

${pc.bold('Behavior:')}
  Default: interactive wizard for exposed providers, discovery id masking (for
  Claude Desktop / Cowork), optional favorites-only catalog, then listen mode.
  --vertex: Anthropic-compatible gateway to Claude on Google Vertex AI using
  local gcloud Application Default Credentials (no OpenCode API key).
  Binds to port 17645. Network mode asks for a server password.

${pc.bold('Vertex env:')}
  ANTHROPIC_VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT — your GCP project
  GOOGLE_CLOUD_LOCATION or CLOUD_ML_REGION — region (default: global)
  Optional catalog: ~/.relay-ai/vertex-models.json (see vertex-models.example.json)

${pc.bold('Endpoints:')}
  Anthropic-compatible:  ANTHROPIC_BASE_URL=http://127.0.0.1:17645/anthropic
  OpenAI-compatible:     OPENAI_BASE_URL=http://127.0.0.1:17645/openai/v1
  API key: use anything locally; use the server password in network mode.`;
}

export function modelsHelpText(): string {
  return `${pc.bold('relay-ai models')} v${VERSION}
Manage favorite models for mid-session switching in Claude Code.

${pc.bold('Usage:')}
  relay-ai models
  relay-ai models --help
  relay-ai models --version

${pc.bold('Behavior:')}
  Opens an interactive manager to add or remove favorites.
  Pick from Zen, Go, or any configured local OpenCode provider.
  Favorites are saved to ~/.relay-ai/config.json (max ${MAX_MODEL_CATALOG}).

${pc.bold('How it works:')}
  When favorites exist, relay-ai claude starts a multi-route catalog proxy.
  Claude Code /model lists your starting model plus favorites — switch live
  without restarting. Mix cloud and local favorites in one session.
  With no favorites, launch uses a single model as before.

${pc.bold('Examples:')}
  relay-ai models
  relay-ai claude    # switch menu active when favorites are set`;
}

function printHelp(text: string): void {
  console.log(`\n${text}\n`);
}

async function launchClaudeViaCatalog(
  catalogRoutes: ProxyRoute[],
  startingRoute: ProxyRoute,
  contextWindow: number | undefined,
  trace: boolean,
  claudeArgs: string[],
): Promise<number> {
  let proxyHandle: ProxyHandle;
  try {
    proxyHandle = await startProxyCatalog(catalogRoutes, startingRoute.aliasId, trace);
    p.log.info(
      `Switch menu active — proxy on port ${proxyHandle.port} ` +
      pc.dim(`(${catalogRoutes.length} model${catalogRoutes.length !== 1 ? 's' : ''} in /model)`),
    );
  } catch (err) {
    p.log.error(`Failed to start proxy: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const childEnv = buildChildEnv(
    `http://127.0.0.1:${proxyHandle.port}`,
    startingRoute.aliasId,
    'catalog-proxy',
    proxyHandle.port,
    contextWindow,
    true,
  );

  const debugLogPath = prepareClaudeTraceLog();
  const traceArgs = trace ? ['--debug-file', debugLogPath] : [];
  if (trace) p.log.info(`Debug log: ${debugLogPath}`);

  const exitCode = await launchClaude(childEnv, startingRoute.aliasId, [...traceArgs, ...claudeArgs]);
  proxyHandle.close();
  if (trace) printTraceLog(debugLogPath);
  return exitCode;
}

function printDryRun(
  backendName: string,
  modelId: string,
  baseUrl: string,
  modelFormat: ModelFormat,
  claudeArgs: string[],
  conflicts: Array<{ name: string; value: string }>,
  disableExperimentalBetas: boolean,
  npm?: string,
): void {
  console.log('');
  console.log(pc.bold(pc.cyan('  DRY RUN — would execute:')));
  console.log('');

  const claudeCmd = ['claude', '--model', modelId, ...claudeArgs].join(' ');
  console.log(`  ${pc.bold('Command:')}  ${claudeCmd}`);
  console.log(`  ${pc.bold('Backend:')}  ${backendName}`);
  if (modelFormat === 'openai') {
    console.log(`  ${pc.bold('Proxy:')}    would start local SDK adapter proxy ${pc.dim('(Vercel AI SDK)')}`);
    if (npm) console.log(`             ${pc.dim(`npm: ${npm}`)}`);
  }
  console.log('');

  console.log(`  ${pc.bold('Env vars SET:')}`);
  if (modelFormat === 'openai') {
    console.log(`    ANTHROPIC_BASE_URL=http://127.0.0.1:<port>  ${pc.dim('(local proxy)')}`);
  } else {
    console.log(`    ANTHROPIC_BASE_URL=${baseUrl}`);
  }
  console.log(`    ANTHROPIC_API_KEY=<your OPENCODE_API_KEY>`);
  console.log(`    ANTHROPIC_MODEL=${modelId}`);
  if (disableExperimentalBetas) {
    console.log(`    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1  ${pc.dim('(direct upstream — strips beta headers)')}`);
  } else {
    console.log(`    ${pc.dim('(experimental betas enabled — tool search via local proxy)')}`);
  }
  console.log(`    ENABLE_TOOL_SEARCH=true  ${pc.dim('(defer MCP tools like native Claude Code)')}`);
  console.log(`    CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=0  ${pc.dim('(keep full system prompt on proxy routes)')}`);
  console.log('');

  if (conflicts.length > 0) {
    console.log(`  ${pc.bold('Env vars REMOVED:')}`);
    for (const c of conflicts) {
      console.log(`    ${pc.dim(c.name)}=${pc.dim(c.value)}`);
    }
    console.log('');
  }

  console.log(pc.dim('  (dry run complete — Claude Code was NOT launched)'));
  console.log('');
}

export async function runModelsCommand(): Promise<number> {
  p.intro(pc.bold('  Relay AI — Favorite Models'));

  const spinner = p.spinner();
  spinner.start('Loading providers...');

  const catalog = await fetchProviderCatalog();
  spinner.stop('');

  const allProviders = providersForPicker(catalog);

  if (allProviders.length === 0) {
    p.log.warn('No providers found.');
    p.log.info('OpenCode Zen/Go is always available. Local providers appear when OpenCode is running.');
    p.outro('Done.');
    return 0;
  }

  // Build a flat name lookup: "providerId:modelId" → display label
  const modelLookup = new Map<string, { modelName: string; providerName: string }>();
  for (const ap of allProviders) {
    for (const m of ap.models) {
      modelLookup.set(`${ap.id}:${m.id}`, { modelName: m.name || m.id, providerName: ap.name });
    }
  }

  const prefs = loadPreferences();
  let favorites = prefs.favoriteModels ?? [];
  let favoritesDirty = false;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    type MenuChoice = string;
    const options: Array<{ value: MenuChoice; label: string; hint: string }> = [];

    // One entry per saved favorite; selecting it removes it
    for (let i = 0; i < favorites.length; i++) {
      const fav = favorites[i]!;
      const entry = modelLookup.get(`${fav.providerId}:${fav.modelId}`);
      const label = entry
        ? `★ ${entry.modelName} (${entry.providerName})`
        : pc.dim(`★ ${fav.modelId} — provider gone`);
      options.push({ value: `fav-${i}`, label, hint: 'select to remove' });
    }

    const atCap = favorites.length >= MAX_MODEL_CATALOG;
    options.push({
      value: '__add__',
      label: atCap ? pc.dim(`+ Add a model → (limit of ${MAX_MODEL_CATALOG} reached)`) : '+ Add a model →',
      hint: atCap
        ? 'Remove a favorite first to make room'
        : `${allProviders.length} provider${allProviders.length !== 1 ? 's' : ''} available`,
    });
    options.push({ value: '__done__', label: 'Done', hint: '' });

    const header = favorites.length === 0
      ? `Favorites (0/${MAX_MODEL_CATALOG})`
      : `Favorites (${favorites.length}/${MAX_MODEL_CATALOG}) — select to remove`;

    const choice = await p.select<string>({
      message: header,
      options,
      initialValue: '__done__',
    });

    if (p.isCancel(choice) || choice === '__done__') break;

    if (choice === '__add__') {
      if (atCap) {
        p.log.warn(`Limit of ${MAX_MODEL_CATALOG} favorites reached — remove one first.`);
        continue;
      }

      const providerOptions = allProviders.map(ap => ({
        value: ap.id,
        label: ap.name,
        hint: `${ap.models.length} model${ap.models.length !== 1 ? 's' : ''}`,
      }));
      const pickedProviderId = await p.select<string>({
        message: 'Which provider?',
        options: providerOptions,
      });
      if (p.isCancel(pickedProviderId)) continue;

      const provider = allProviders.find(ap => ap.id === pickedProviderId)!;
      const browsed = await browseAllModels(provider, prefs);
      if (!browsed) continue;

      const fav: FavoriteModel = { providerId: provider.id, modelId: browsed.id };
      const result = addFavorite(favorites, fav);
      if (!result.ok) {
        if (result.reason === 'duplicate') {
          p.log.warn(`${browsed.name || browsed.id} is already in your favorites.`);
        } else {
          p.log.warn(`Limit of ${MAX_MODEL_CATALOG} favorites reached — remove one first.`);
        }
        continue;
      }
      favorites = result.list;
      favoritesDirty = true;
      p.log.success(`Added ${browsed.name || browsed.id} (${provider.name}) to favorites.`);
    } else if ((choice as string).startsWith('fav-')) {
      const idx = parseInt((choice as string).slice(4), 10);
      const fav = favorites[idx]!;
      const entry = modelLookup.get(`${fav.providerId}:${fav.modelId}`);
      const label = entry ? `${entry.modelName} (${entry.providerName})` : fav.modelId;
      favorites = removeFavorite(favorites, fav);
      favoritesDirty = true;
      p.log.success(`Removed ${label} from favorites.`);
    }
  }

  if (favoritesDirty) {
    savePreferences({ favoriteModels: favorites });
  }

  p.outro(
    favorites.length === 0
      ? 'No favorites saved — launch will use single-model mode.'
      : pc.green(`${favorites.length} favorite${favorites.length !== 1 ? 's' : ''} saved — /model menu will show these on next launch.`),
  );
  return 0;
}

export async function runClaudeCommand(parsed: ParsedArgs): Promise<number> {
  const { dryRun, setup, trace, claudeArgs } = parsed;

  // Prerequisite: claude binary
  const claudePath = findClaudeBinary();
  if (!claudePath) {
    console.error(pc.red('\nError: claude binary not found on PATH.\n'));
    console.error('Install Claude Code:');
    console.error('  npm install -g @anthropic-ai/claude-code\n');
    return 1;
  }

  const prefs = dryRun ? {} as ReturnType<typeof loadPreferences> : loadPreferences();
  const conflicts = detectConflicts();

  const favorites = dryRun ? [] : (prefs.favoriteModels ?? []);
  const switchMenuActive = favorites.length > 0;
  const hasZenGoFavorites = favorites.some(f => f.providerId === 'zen' || f.providerId === 'go');

  p.intro(pc.bold('  Relay AI'));

  if (setup && !dryRun) {
    p.log.info('Provider setup now lives in relay-ai providers — opening that next is recommended.');
  }

  if (!dryRun && await needsFirstRunSetup()) {
    const firstRun = await runFirstRunWizard(trace);
    if (firstRun === 'cancel') return 0;
  }

  // When the switch menu needs Zen/Go catalog routes, resolve the API key and
  // fetch model info now (before the provider branch) so both branches can use them.
  let earlyEffectiveKey: string | null = null;
  let earlyZenModels: ModelInfo[] = [];
  let earlyGoModels: ModelInfo[] = [];

  if (switchMenuActive && hasZenGoFavorites && !dryRun) {
    const apiKey = await resolveOrCollectApiKey(false, trace);
    if (!apiKey) return 0;
    earlyEffectiveKey = apiKey;

    const zenGoSpinner = p.spinner();
    zenGoSpinner.start('Fetching OpenCode models for switch menu...');
    try {
      const backends: Array<'zen' | 'go'> = [];
      if (favorites.some(f => f.providerId === 'zen')) backends.push('zen');
      if (favorites.some(f => f.providerId === 'go')) backends.push('go');
      const fetched = await fetchZenGoModels(backends, false);
      earlyZenModels = fetched.zenModels;
      earlyGoModels = fetched.goModels;
      zenGoSpinner.stop('');
    } catch (err) {
      zenGoSpinner.stop('');
      const detail = err instanceof Error ? err.message : String(err);
      p.log.warn(`Could not fetch OpenCode models (${detail}) — Zen/Go favorites will be skipped from /model catalog`);
    }
  }

  const catalogSpinner = p.spinner();
  catalogSpinner.start('Loading your providers...');
  let catalog: Awaited<ReturnType<typeof fetchProviderCatalog>>;
  try {
    catalog = await fetchProviderCatalog({ persistCache: !dryRun });
  } catch (err) {
    catalogSpinner.stop('');
    console.error(pc.red(String(err instanceof Error ? err.message : err)));
    return 1;
  }
  catalogSpinner.stop('');

  const allProviders = providersForPicker(catalog);
  if (allProviders.length === 0) {
    p.log.warn('No providers available.');
    p.log.info(pc.dim('Run relay-ai providers add or import to get started.'));
    return 0;
  }

  const providerOptions = allProviders.map(lp => ({
    value: lp.id,
    label: lp.name,
    hint: `${lp.models.length} model${lp.models.length !== 1 ? 's' : ''} available`,
  }));

  const initialProvider =
    prefs.lastProvider && providerOptions.some(o => o.value === prefs.lastProvider)
      ? prefs.lastProvider
      : providerOptions[0]!.value;

  const chosen = await p.select<string>({
    message: 'Which provider?',
    options: providerOptions,
    initialValue: initialProvider,
  });

  if (p.isCancel(chosen)) {
    p.cancel('Cancelled.');
    return 0;
  }

  const providerChoice = chosen as string;
  let activeProvider = allProviders.find(lp => lp.id === providerChoice)!;
  const isZenGo = providerChoice === 'zen' || providerChoice === 'go';

  let zenGoApiKey = earlyEffectiveKey;
  if (isZenGo && !dryRun) {
    zenGoApiKey = zenGoApiKey ?? await resolveOrCollectApiKey(false, trace);
    if (!zenGoApiKey) return 0;
    activeProvider = { ...activeProvider, apiKey: zenGoApiKey };
  }

  const selectedModel = await pickLocalModel(activeProvider, conflicts, prefs);
  if (!selectedModel) return 0;

  if (!dryRun) {
    const prevRecent = prefs.recentModelsByProvider?.[activeProvider.id] ?? [];
    const updatedRecent = [selectedModel.id, ...prevRecent.filter(id => id !== selectedModel.id)].slice(0, 3);
    savePreferences({
      lastProvider: activeProvider.id,
      lastModel: selectedModel.id,
      recentModelsByProvider: { ...prefs.recentModelsByProvider, [activeProvider.id]: updatedRecent },
    });
  }

  const localProviders = catalog.localProviders.length > 0 ? catalog.localProviders : null;
  const effectiveZenGoKey = isZenGo ? (zenGoApiKey ?? 'dry-run-placeholder') : zenGoApiKey;

  const zenGoModelInfo = isZenGo
    ? (providerChoice === 'zen' ? catalog.zenModels : catalog.goModels).find(m => m.id === selectedModel.id)
    : undefined;

  if (switchMenuActive) {
    const resolveRoute = makeRouteResolver(
      localProviders,
      catalog.zenModels,
      catalog.goModels,
      effectiveZenGoKey,
    );
    const startingRoute = isZenGo && zenGoModelInfo
      ? zenGoModelToRoute(zenGoModelInfo, activeProvider.apiKey)
      : localModelToRoute(activeProvider, selectedModel);
    if (!startingRoute) {
      p.log.error('Could not resolve a proxy route for the selected model.');
      return 1;
    }
    const { routes: catalogRoutes, droppedFavorites } = buildCatalogRoutes(startingRoute, favorites, resolveRoute);
    if (droppedFavorites.length > 0) {
      p.log.warn(
        `Skipping ${droppedFavorites.length} favorite${droppedFavorites.length === 1 ? '' : 's'} `
        + 'that are no longer available in /model',
      );
    }

    if (dryRun) {
      const endpoint = isZenGo
        ? BACKENDS[providerChoice as 'zen' | 'go'].baseUrl
        : (selectedModel.baseUrl ?? selectedModel.completionsUrl ?? '(unknown)');
      console.log('');
      console.log(pc.bold(pc.cyan('  DRY RUN — would execute (switch-menu mode):')));
      console.log('');
      console.log(`  ${pc.bold('Provider:')}      ${activeProvider.name}`);
      console.log(`  ${pc.bold('Starting model:')} ${selectedModel.id}`);
      console.log(`  ${pc.bold('Endpoint:')}      ${endpoint}`);
      console.log(`  ${pc.bold('/model catalog:')} ${catalogRoutes.length} model(s)`);
      catalogRoutes.forEach(r => console.log(`    ${pc.dim(r.displayName)}`));
      console.log('');
      console.log(pc.dim('  (dry run complete — Claude Code was NOT launched)'));
      console.log('');
      return 0;
    }

    return launchClaudeViaCatalog(
      catalogRoutes,
      startingRoute,
      selectedModel.contextWindow,
      trace,
      claudeArgs,
    );
  }

  // ── Single-model path ──

  if (dryRun) {
    if (isZenGo && zenGoModelInfo) {
      const backend = BACKENDS[zenGoModelInfo.sourceBackend];
      printDryRun(
        backend.name,
        zenGoModelInfo.id,
        backend.baseUrl,
        zenGoModelInfo.modelFormat,
        claudeArgs,
        conflicts,
        zenGoModelInfo.modelFormat !== 'openai',
        zenGoModelInfo.modelFormat === 'openai' ? '@ai-sdk/openai-compatible' : undefined,
      );
      return 0;
    }
    const formatDesc = selectedModel.modelFormat === 'anthropic'
      ? 'direct passthrough'
      : 'via SDK adapter proxy';
    const endpoint = selectedModel.modelFormat === 'anthropic'
      ? (selectedModel.baseUrl ?? '(unknown)')
      : (selectedModel.npm ?? 'SDK');
    console.log('');
    console.log(pc.bold(pc.cyan('  DRY RUN — would execute:')));
    console.log('');
    console.log(`  ${pc.bold('Provider:')}  ${activeProvider.name}`);
    console.log(`  ${pc.bold('Model:')}     ${selectedModel.id}`);
    console.log(`  ${pc.bold('Format:')}    ${selectedModel.modelFormat} (${formatDesc})`);
    console.log(`  ${pc.bold(selectedModel.modelFormat === 'anthropic' ? 'Endpoint:' : 'SDK npm:')} ${endpoint}`);
    console.log(`  ${pc.bold('Key:')}       ${activeProvider.name} provider key`);
    console.log('');
    console.log(pc.dim('  (dry run complete — Claude Code was NOT launched)'));
    console.log('');
    return 0;
  }

  if (isZenGo && zenGoModelInfo) {
    const backend = BACKENDS[zenGoModelInfo.sourceBackend];
    const disableExperimentalBetas = zenGoModelInfo.modelFormat !== 'openai';
    let proxyHandle: ProxyHandle | null = null;
    if (zenGoModelInfo.modelFormat === 'openai') {
      try {
        proxyHandle = await startProxy(
          `${backend.baseUrl}/v1/chat/completions`,
          zenGoModelInfo.id,
          trace,
          zenGoModelInfo.contextWindow,
          { npm: '@ai-sdk/openai-compatible', baseURL: `${backend.baseUrl}/v1` },
        );
        p.log.info(`Translation proxy started on port ${proxyHandle.port}`);
      } catch (err) {
        p.log.error(`Failed to start translation proxy: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
      }
    }

    const childEnv = buildChildEnv(
      backend.baseUrl,
      zenGoModelInfo.id,
      activeProvider.apiKey,
      proxyHandle?.port,
      zenGoModelInfo.contextWindow,
    );
    if (disableExperimentalBetas) {
      childEnv['CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS'] = '1';
    }

    const debugLogPath = prepareClaudeTraceLog();
    const traceArgs = trace ? ['--debug-file', debugLogPath] : [];
    if (trace) p.log.info(`Debug log: ${debugLogPath}`);

    const exitCode = await launchClaude(childEnv, zenGoModelInfo.id, [...traceArgs, ...claudeArgs]);
    proxyHandle?.close();
    if (trace) printTraceLog(debugLogPath);
    return exitCode;
  }

  let proxyHandle: ProxyHandle | null = null;
  let childEnv: NodeJS.ProcessEnv;

  if (selectedModel.modelFormat === 'anthropic') {
    childEnv = buildChildEnv(
      selectedModel.baseUrl!,
      selectedModel.id,
      activeProvider.apiKey,
      undefined,
      selectedModel.contextWindow,
    );
  } else {
    try {
      proxyHandle = await startProxy(
        selectedModel.completionsUrl ?? '',
        selectedModel.id,
        trace,
        selectedModel.contextWindow,
        {
          npm: selectedModel.npm,
          baseURL: selectedModel.apiBaseUrl,
          upstreamModelId: selectedModel.upstreamModelId,
        },
      );
      p.log.info(
        `SDK adapter proxy started on port ${proxyHandle.port}` +
        (selectedModel.npm ? pc.dim(` (${selectedModel.npm})`) : ''),
      );
    } catch (err) {
      p.log.error(`Failed to start SDK adapter proxy: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
    childEnv = buildChildEnv(
      `http://127.0.0.1:${proxyHandle.port}`,
      selectedModel.id,
      activeProvider.apiKey,
      proxyHandle.port,
      selectedModel.contextWindow,
    );
  }

  if (selectedModel.modelFormat === 'anthropic') {
    childEnv['CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS'] = '1';
  }

  const debugLogPath = prepareClaudeTraceLog();
  const traceArgs = trace ? ['--debug-file', debugLogPath] : [];
  if (trace) p.log.info(`Debug log: ${debugLogPath}`);

  const exitCode = await launchClaude(childEnv, selectedModel.id, [...traceArgs, ...claudeArgs]);
  proxyHandle?.close();
  if (trace) printTraceLog(debugLogPath);
  return exitCode;
}

export async function main(args: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(args);

  if (parsed.error) {
    console.error(pc.red(`\nError: ${parsed.error}\n`));
    printHelp(rootHelpText());
    return 1;
  }

  if (parsed.command === 'root') {
    if (parsed.showVersion) {
      console.log(VERSION);
    } else {
      printHelp(rootHelpText());
    }
    return 0;
  }

  if (parsed.command === 'server') {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    if (parsed.showHelp) {
      printHelp(serverHelpText());
      return 0;
    }
    return runServerCommand({ vertex: parsed.vertex });
  }

  if (parsed.command === 'models') {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    if (parsed.showHelp) {
      printHelp(modelsHelpText());
      return 0;
    }
    return runModelsCommand();
  }

  if (parsed.command === 'providers') {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    if (parsed.showHelp) {
      printHelp(providersHelpText());
      return 0;
    }
    return runProvidersCommand(parsed.claudeArgs);
  }

  if (parsed.showVersion) {
    console.log(VERSION);
    return 0;
  }
  if (parsed.showHelp) {
    printHelp(claudeHelpText());
    return 0;
  }

  return runClaudeCommand(parsed);
}

function isCliEntryPoint(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isCliEntryPoint()) {
  main().then((exitCode) => {
    process.exit(exitCode);
  }).catch((err: unknown) => {
    if (err === Symbol.for('clack:cancel')) {
      process.exit(0);
    }
    console.error(pc.red('\nUnexpected error:'), err);
    process.exit(1);
  });
}
