// src/cli.ts
import pc from 'picocolors';
import { relayIntro, relayOutro, providerSelectOption, fmtModel, fmtEnabledStar } from './ui.js';
import * as p from '@clack/prompts';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findClaudeBinary, launchClaude } from './launch.js';
import { resolveApiKey, detectConflicts, buildChildEnv, readGlobalOpencodeCredential } from './env.js';
import { claudeCodeClientModelId } from './context-model-id.js';
import { resolveOrCollectApiKey } from './key-setup.js';
import { needsFirstRunSetup, runFirstRunWizard } from './first-run.js';
import { MAX_MODEL_CATALOG } from './constants.js';
import { startProxy, startProxyCatalog } from './proxy.js';
import type { ProxyHandle, ProxyRoute } from './proxy.js';
import {
  buildCatalogRoutes,
  makeRouteResolver,
} from './catalog.js';
import { runServerCommand } from './server/index.js';
import type { ModelFormat } from './types.js';
import { loadPreferences, savePreferences, recordLaunchSelection } from './config.js';
import { pickLocalModel, browseAllModels } from './prompts.js';
import { fetchProviderCatalog, providersForPicker, resolveLocalProviderApiKey } from './provider-catalog.js';
import { BACKENDS, VERSION } from './constants.js';
import type { ParsedArgs, ModelInfo, FavoriteModel, LocalProvider, LocalProviderModel } from './types.js';
import { addFavorite, removeFavorite } from './favorites.js';
import {
  browseByProviderChoice,
  buildGlobalFavoriteIndex,
  pickGlobalFavoriteModel,
} from './favorites-picker.js';
import { resolveFirstAvailableFavorite } from './favorites-resolver.js';
import { runProvidersCommand, providersHelpText } from './providers-command.js';
import { runCodexCommand, codexHelpText } from './codex.js';
import { runCodexAppCommand } from './codex-app.js';
import { runClaudeAppCommand } from './claude-app.js';
import { prepareClaudeTraceLog, printTraceLog } from './trace-log.js';
import { refreshModelsDevCacheAsync } from './registry/models-dev.js';
import { setAgentStdoutMode, isAgentStdoutMode } from './agent-io.js';
import {
  findProviderAndModel,
  normalizeClaudeAgentArgs,
  planLaunchWizard,
  wantsCleanAgentStdout,
} from './launch-target.js';
import { generateAiDoc, installAiDoc, printAiInstallResult } from './ai-doc.js';
const STARTER_CLAUDE_FLAGS = new Set(['--dry-run', '--setup', '--trace', '--help', '-h', '--version', '-v']);
const RELAY_LAUNCH_FLAGS = new Set(['--provider', '--model']);

function parseRelayLaunchFlag(
  arg: string,
  rest: string[],
  index: number,
  parsed: ParsedArgs,
): number | 'error' {
  if (arg === '--provider' || arg === '--model') {
    const value = rest[index + 1];
    if (!value || value.startsWith('-')) {
      parsed.error = `Missing value for ${arg}`;
      return 'error';
    }
    if (arg === '--provider') parsed.launchProvider = value;
    else parsed.launchModel = value;
    return index + 1;
  }
  if (arg.startsWith('--provider=')) {
    parsed.launchProvider = arg.slice('--provider='.length);
    return index;
  }
  if (arg.startsWith('--model=')) {
    parsed.launchModel = arg.slice('--model='.length);
    return index;
  }
  return index;
}

function tryConsumeRelayLaunchFlag(
  arg: string,
  rest: string[],
  index: number,
  parsed: ParsedArgs,
): { next: number } | { error: true } | null {
  if (!RELAY_LAUNCH_FLAGS.has(arg) && !arg.startsWith('--provider=') && !arg.startsWith('--model=')) {
    return null;
  }
  const next = parseRelayLaunchFlag(arg, rest, index, parsed);
  if (next === 'error') return { error: true };
  return { next };
}

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
  if (args.includes('--ai')) {
    return {
      ...emptyParsed('root'),
      showAi: true,
      aiInstall: args.includes('--install'),
      aiInstallForce: args.includes('--force'),
    };
  }

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

  if (first === 'models' || first === 'favorites') {
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

  if (first === 'codex-app') {
    const parsed = emptyParsed('codex-app');
    parsed.claudeArgs = rest;
    for (const arg of rest) {
      if (arg === '--help' || arg === '-h') parsed.showHelp = true;
      else if (arg === '--version' || arg === '-v') parsed.showVersion = true;
      else if (arg === '--vertex') parsed.vertex = true;
    }
    return parsed;
  }

  if (first === 'claude-app') {
    const parsed = emptyParsed('claude-app');
    parsed.claudeArgs = rest;
    for (const arg of rest) {
      if (arg === '--help' || arg === '-h') parsed.showHelp = true;
      else if (arg === '--version' || arg === '-v') parsed.showVersion = true;
    }
    return parsed;
  }

  if (first === 'codex') {
    const parsed = emptyParsed('codex');
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i]!;
      if (arg === '--trace') {
        parsed.trace = true;
        continue;
      }
      if (arg === '--vertex') {
        parsed.vertex = true;
        continue;
      }
      if (arg === '--help' || arg === '-h') {
        parsed.showHelp = true;
        continue;
      }
      if (arg === '--version' || arg === '-v') {
        parsed.showVersion = true;
        continue;
      }
      const consumed = tryConsumeRelayLaunchFlag(arg, rest, i, parsed);
      if (consumed !== null) {
        if ('error' in consumed) return parsed;
        i = consumed.next;
        continue;
      }
      parsed.claudeArgs.push(arg);
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

    const consumed = tryConsumeRelayLaunchFlag(arg, rest, i, parsed);
    if (consumed !== null) {
      if ('error' in consumed) return parsed;
      i = consumed.next;
      continue;
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
Launch AI coding tools with OpenCode Zen / Go or local providers (Groq, Mistral,
OpenAI, Gemini, Ollama, and more).

${pc.bold('Usage:')}
  relay-ai claude [options] [claude-flags]
  relay-ai claude-app [options]
  relay-ai codex [options] [codex-flags]
  relay-ai codex-app [options]
  relay-ai server [options]
  relay-ai models
  relay-ai favorites
  relay-ai providers
  relay-ai --help
  relay-ai --version
  relay-ai --ai              Full reference for AI agents (run this when unsure)
  relay-ai --ai --install    Install or upgrade agent skill when version changed
  relay-ai --ai --install --force  Reinstall skill even if already current

${pc.bold('Root options:')}
  -h, --help       Show this help
  -v, --version    Show version
  --ai             Print the full reference for AI agents
  --ai --install   Install or upgrade the relay-ai agent skill
  --force          Reinstall the agent skill when used with --ai --install

${pc.bold('Commands:')}
  claude      Launch Claude Code — pick a provider from your registry
  models      Manage favorite models for mid-session /model switching (max ${MAX_MODEL_CATALOG})
  favorites   Alias for models
  providers   Add, import, and manage your AI providers
  server      Run a foreground API gateway (OpenCode Zen / Go and local providers)
  codex       Launch OpenAI Codex CLI with registry providers
  codex-app   Launch Codex desktop app with registry providers (macOS + Windows)
  claude-app  Launch Claude Desktop app with registry providers (macOS + Windows)

${pc.bold('Migration:')}
  Bare relay-ai prints this help instead of launching Claude Code.
  Use relay-ai claude for the wizard and launcher.

${pc.bold('Examples:')}
  relay-ai claude
  relay-ai models
  relay-ai providers
  relay-ai codex
  relay-ai codex-app
  relay-ai claude-app
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
  --setup      Hint: use relay-ai providers to add or manage providers
  --trace      Write debug logs to ~/.relay-ai/logs/ and show errors on exit
  --provider   Boot provider id (skip wizard when paired with --model or in print mode)
  --model      Boot model id (skip wizard when paired with --provider or in print mode)
  --help       Show this command help
  --version    Show version

${pc.bold('Providers:')}
  Cloud (Zen/Go)  Requires OPENCODE_API_KEY — get one at https://opencode.ai/auth
  Registry        Configure with relay-ai providers add or import (Groq, Mistral,
                  Nvidia, DeepSeek, OpenAI, custom endpoints, etc.).

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
  relay-ai claude --provider groq --model llama-3.3-70b-versatile
  relay-ai claude --provider groq --model llama-3.3-70b-versatile -p "review this file"
  relay-ai claude -- --print "hello"
  relay-ai claude -- --dangerously-skip-permissions`;
}

export function serverHelpText(): string {
  return `${pc.bold('relay-ai server')} v${VERSION}
Run a foreground API gateway for registry providers, Zen/Go, or Vertex AI.

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
  Optional catalog: ~/.relay-ai/vertex-models.json (see assets/vertex-models.example.json)

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
  Search all providers at once (paginated results) or browse one provider at a time.
  Pick from Zen, Go, or any provider in your registry.
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
    proxyHandle.token,
    proxyHandle.port,
    contextWindow,
    true,
  );

  const debugLogPath = prepareClaudeTraceLog();
  const traceArgs = trace ? ['--debug-file', debugLogPath] : [];
  if (trace) p.log.info(`Debug log: ${debugLogPath}`);

  const exitCode = await launchClaude(
    childEnv,
    claudeCodeClientModelId(startingRoute.aliasId, contextWindow),
    [...traceArgs, ...claudeArgs],
  );
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
  relayIntro('Favorite Models');

  const spinner = p.spinner();
  spinner.start('Loading providers...');

  const catalog = await fetchProviderCatalog();
  spinner.stop('');

  const allProviders = providersForPicker(catalog);

  if (allProviders.length === 0) {
    p.log.warn('No providers found.');
    p.log.info(`${pc.dim('OpenCode Zen/Go is always available. Add providers with ')}${pc.cyan('relay-ai providers')}${pc.dim('.')}`);
    relayOutro('Done');
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
        ? `${fmtEnabledStar(true)} ${fmtModel(entry.modelName)} ${pc.dim(`(${entry.providerName})`)}`
        : pc.dim(`★ ${fav.modelId} — provider gone`);
      options.push({ value: `fav-${i}`, label, hint: 'select to remove' });
    }

    const atCap = favorites.length >= MAX_MODEL_CATALOG;
    options.push({
      value: '__add__',
      label: atCap ? pc.dim(`+ Add a model → (limit of ${MAX_MODEL_CATALOG} reached)`) : pc.cyan('+ Add a model →'),
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

      const globalCount = buildGlobalFavoriteIndex(allProviders).length;
      const addPath = await p.select<string>({
        message: 'Add a favorite',
        options: [
          {
            value: 'global',
            label: pc.cyan('Search all providers'),
            hint: `${globalCount} models · ${allProviders.length} provider${allProviders.length !== 1 ? 's' : ''}`,
          },
          {
            value: 'provider',
            label: pc.cyan('Browse by provider →'),
            hint: 'Pick one provider first',
          },
        ],
      });
      if (p.isCancel(addPath)) continue;

      let provider: LocalProvider | undefined;
      let browsed: LocalProviderModel | undefined;

      if (addPath === 'global') {
        const globalPick = await pickGlobalFavoriteModel(allProviders, favorites);
        if (globalPick === null) continue;
        if (globalPick !== browseByProviderChoice) {
          provider = allProviders.find(ap => ap.id === globalPick.providerId);
          browsed = globalPick.model;
        }
      }

      if (!browsed) {
        const providerOptions = allProviders.map(ap => providerSelectOption(ap));
        const pickedProviderId = await p.select<string>({
          message: 'Which provider?',
          options: providerOptions,
        });
        if (p.isCancel(pickedProviderId)) continue;

        provider = allProviders.find(ap => ap.id === pickedProviderId)!;
        browsed = await browseAllModels(provider, prefs) ?? undefined;
        if (!browsed) continue;
      }

      const fav: FavoriteModel = { providerId: provider!.id, modelId: browsed.id };
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
      p.log.success(`Added ${browsed.name || browsed.id} (${provider!.name}) to favorites.`);
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

  relayOutro(
    favorites.length === 0
      ? 'No favorites saved'
      : `${favorites.length} favorite${favorites.length !== 1 ? 's' : ''} saved`,
    favorites.length === 0
      ? pc.dim('Launch uses single-model mode')
      : pc.cyan('/model menu ready on next launch'),
  );
  return 0;
}

export async function runClaudeCommand(parsed: ParsedArgs): Promise<number> {
  const { dryRun, setup, trace, launchProvider, launchModel } = parsed;
  const claudeArgs = normalizeClaudeAgentArgs(parsed.claudeArgs);
  const agentStdout = wantsCleanAgentStdout('claude', claudeArgs);
  setAgentStdoutMode(agentStdout);

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
  const launchPlan = planLaunchWizard({
    explicit: { providerId: launchProvider, modelId: launchModel },
    childArgs: claudeArgs,
    agent: 'claude',
    prefs,
  });
  if (launchPlan.error) {
    console.error(pc.red(`\nError: ${launchPlan.error}\n`));
    return 1;
  }
  const switchMenuActive = favorites.length > 0 && !launchPlan.skip;

  if (!agentStdout) relayIntro('Claude Code');

  if (setup && !dryRun && !agentStdout) {
    p.log.info('Provider setup now lives in relay-ai providers — opening that next is recommended.');
  }

  if (!dryRun && await needsFirstRunSetup()) {
    const firstRun = await runFirstRunWizard(trace);
    if (firstRun === 'cancel') return 0;
  }

  let catalog: Awaited<ReturnType<typeof fetchProviderCatalog>>;
  if (agentStdout) {
    try {
      catalog = await fetchProviderCatalog();
    } catch (err) {
      console.error(pc.red(String(err instanceof Error ? err.message : err)));
      return 1;
    }
  } else {
    const catalogSpinner = p.spinner();
    catalogSpinner.start('Loading your providers...');
    try {
      catalog = await fetchProviderCatalog();
    } catch (err) {
      catalogSpinner.stop('');
      console.error(pc.red(String(err instanceof Error ? err.message : err)));
      return 1;
    }
    catalogSpinner.stop('');
  }

  const allProviders = providersForPicker(catalog);
  if (allProviders.length === 0) {
    p.log.warn('No providers available.');
    p.log.info(pc.dim('Run relay-ai providers add or import to get started.'));
    return 0;
  }

  const providerOptions = allProviders.map(lp => providerSelectOption(lp));

  if (switchMenuActive) {
    providerOptions.unshift({
      value: '__favorites__',
      label: '⭐ Favorites Catalog',
      hint: `${favorites.length} saved favorites`,
    });
  }

  const initialProvider =
    prefs.lastProvider && providerOptions.some(o => o.value === prefs.lastProvider)
      ? prefs.lastProvider
      : providerOptions[0]!.value;

  let activeProvider: LocalProvider;
  let selectedModel: LocalProviderModel;

  if (launchPlan.skip && launchPlan.target) {
    const resolved = findProviderAndModel(allProviders, launchPlan.target);
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
    if (!dryRun) recordLaunchSelection('claude', activeProvider.id, selectedModel.id, prefs);
  } else {
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

    if (providerChoice === '__favorites__') {
      const favoriteStart = resolveFirstAvailableFavorite(favorites, allProviders);
      if (!favoriteStart) {
        p.log.warn('No saved favorites are currently available.');
        return 0;
      }
      activeProvider = favoriteStart.provider;
      selectedModel = favoriteStart.model;
      p.log.step(`Loaded Favorites Catalog. Starting model: ${selectedModel.name || selectedModel.id} (${activeProvider.name})`);
    } else {
      activeProvider = allProviders.find(lp => lp.id === providerChoice)!;
      const pickedModel = await pickLocalModel(activeProvider, conflicts, prefs);
      if (!pickedModel) return 0;
      selectedModel = pickedModel;

      if (!dryRun) recordLaunchSelection('claude', activeProvider.id, selectedModel.id, prefs);
    }
  }

  const localProviders = catalog.localProviders.length > 0 ? catalog.localProviders : null;
  const zenGoApiKey = dryRun ? null : await readGlobalOpencodeCredential();
  if (switchMenuActive) {
    const resolveRoute = makeRouteResolver(
      localProviders,
      catalog.zenModels,
      catalog.goModels,
      zenGoApiKey,
    );
    const startingRoute = resolveRoute(activeProvider.id, selectedModel.id) ?? null;
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
      const endpoint = selectedModel.baseUrl ?? selectedModel.completionsUrl ?? '(unknown)';
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

  const launchApiKey = await resolveLocalProviderApiKey(activeProvider);
  if (!launchApiKey?.trim()) {
    p.log.error(
      `No credential found for ${activeProvider.name}. Add a key with relay-ai providers or set OPENCODE_API_KEY.`,
    );
    return 1;
  }

  let proxyHandle: ProxyHandle | null = null;
  let childEnv: NodeJS.ProcessEnv;

  if (selectedModel.modelFormat === 'anthropic') {
    childEnv = buildChildEnv(
      selectedModel.baseUrl!,
      selectedModel.id,
      launchApiKey,
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
          providerId: activeProvider.id,
          authType: activeProvider.authType,
          oauthAccountId: activeProvider.oauthAccountId,
          supportedParameters: selectedModel.supportedParameters,
          reasoning: selectedModel.reasoning,
          interleavedReasoningField: selectedModel.interleavedReasoningField,
        },
        launchApiKey,
      );
      if (!isAgentStdoutMode()) {
        p.log.info(
          `SDK adapter proxy started on port ${proxyHandle.port}` +
          (selectedModel.npm ? pc.dim(` (${selectedModel.npm})`) : ''),
        );
      }
    } catch (err) {
      p.log.error(`Failed to start SDK adapter proxy: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
    childEnv = buildChildEnv(
      `http://127.0.0.1:${proxyHandle.port}`,
      selectedModel.id,
      proxyHandle.token,
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

  const exitCode = await launchClaude(
    childEnv,
    claudeCodeClientModelId(selectedModel.id, selectedModel.contextWindow),
    [...traceArgs, ...claudeArgs],
  );
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

  if (!parsed.showVersion && !parsed.showAi) {
    refreshModelsDevCacheAsync();
  }

  if (parsed.command === 'root') {
    if (parsed.showAi) {
      if (parsed.aiInstall) {
        return printAiInstallResult(installAiDoc({ force: parsed.aiInstallForce }));
      }
      console.log(generateAiDoc());
      return 0;
    }
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

  if (parsed.command === 'codex-app') {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    return runCodexAppCommand(parsed.claudeArgs, { vertex: parsed.vertex });
  }

  if (parsed.command === 'claude-app') {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    return runClaudeAppCommand(parsed.claudeArgs);
  }

  if (parsed.command === 'codex') {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    if (parsed.showHelp) {
      console.log(codexHelpText());
      return 0;
    }
    return runCodexCommand(parsed.claudeArgs, parsed.trace, {
      launchProvider: parsed.launchProvider,
      launchModel: parsed.launchModel,
      vertex: parsed.vertex,
    });
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
