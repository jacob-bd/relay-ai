// src/cli.ts
import pc from 'picocolors';
import { relayIntro, relayOutro, providerSelectOption, fmtModel, fmtEnabledStar, formatModelLabel } from './ui.js';
import * as p from '@clack/prompts';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findClaudeBinary, launchClaude } from './launch.js';
import { resolveApiKey, detectConflicts, buildChildEnv, buildHttpProxyChildEnv, readGlobalOpencodeCredential } from './env.js';
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
import { addFavorite, removeFavorite, isFavorite } from './favorites.js';
import {
  browseByProviderChoice,
  buildGlobalFavoriteIndex,
  pickGlobalFavoriteModel,
} from './favorites-picker.js';
import { favoriteProviderDisplayName } from './favorite-provider-display.js';
import { resolveFirstAvailableFavorite } from './favorites-resolver.js';
import { runProvidersCommand, providersHelpText } from './providers-command.js';
import { runCodexCommand, codexHelpText } from './codex.js';
import { runGeminiCommand, geminiHelpText } from './gemini.js';
import { runAgyCommand, runAntigravityAppCommand, runAntigravityIdeCommand } from './antigravity.js';
import { runCodexAppCommand } from './codex-app.js';
import { runClaudeAppCommand } from './claude-app.js';
import { prepareClaudeTraceLog, printTraceLog } from './trace-log.js';
import { ANTIGRAVITY_BASE_URLS } from './oauth/antigravity-oauth.js';
import { providersForTarget } from './target-compatibility.js';
import { refreshModelsDevCacheAsync } from './registry/models-dev.js';
import { setAgentStdoutMode, isAgentStdoutMode } from './agent-io.js';
import {
  findProviderAndModel,
  normalizeClaudeAgentArgs,
  planLaunchWizard,
  wantsCleanAgentStdout,
} from './launch-target.js';
import { generateAiDoc, installAiDoc, printAiInstallResult } from './ai-doc.js';
import {
  loadHttpProxyRoutes,
  printHttpProxyModels,
  reportSkippedHttpProxyFavorites,
  startConfiguredHttpProxy,
} from './http-proxy/index.js';
const STARTER_CLAUDE_FLAGS = new Set(['--dry-run', '--setup', '--trace', '--http-proxy', '--help', '-h', '--version', '-v']);
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

function consumeServerOptionValue(
  arg: string,
  rest: string[],
  index: number,
  flag: string,
  parsed: ParsedArgs,
): { value: string; next: number } | null {
  if (arg.startsWith(`${flag}=`)) {
    return { value: arg.slice(flag.length + 1), next: index };
  }
  if (arg !== flag) return null;
  const value = rest[index + 1];
  if (!value || value.startsWith('--')) {
    parsed.error = `Missing value for ${flag}`;
    return null;
  }
  return { value, next: index + 1 };
}

function applyServerProvidersOption(value: string, parsed: ParsedArgs): void {
  const trimmed = value.trim();
  if (trimmed === 'all') {
    parsed.serverProvidersMode = 'all';
    parsed.serverProviderIds = undefined;
    return;
  }
  if (trimmed === 'favorites') {
    parsed.serverProvidersMode = 'favorites';
    parsed.serverProviderIds = undefined;
    return;
  }

  const ids = trimmed.split(',').map(id => id.trim()).filter(Boolean);
  if (ids.length === 0) {
    parsed.error = 'Missing provider ids for --providers';
    return;
  }
  parsed.serverProvidersMode = 'specific';
  parsed.serverProviderIds = ids;
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
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i]!;
      if (arg === '--help' || arg === '-h') parsed.showHelp = true;
      else if (arg === '--version' || arg === '-v') parsed.showVersion = true;
      else if (arg === '--vertex') parsed.vertex = true;
      else if (arg === '--http-proxy') parsed.httpProxy = true;
      else if (arg === '--quick' || arg === '--saved') parsed.serverQuick = true;
      else if (arg === '--free-only') parsed.serverFreeOnly = true;
      else if (arg === '--no-free-only') parsed.serverFreeOnly = false;
      else if (arg === '--mask-gateway-ids') parsed.serverMaskGatewayIds = true;
      else if (arg === '--no-mask-gateway-ids') parsed.serverMaskGatewayIds = false;
      else if (arg === '--listen' || arg.startsWith('--listen=')) {
        const consumed = consumeServerOptionValue(arg, rest, i, '--listen', parsed);
        if (!consumed) return parsed;
        if (consumed.value !== 'local' && consumed.value !== 'network') {
          parsed.error = '--listen must be "local" or "network"';
          return parsed;
        }
        parsed.serverListenMode = consumed.value;
        i = consumed.next;
      }
      else if (arg === '--providers' || arg.startsWith('--providers=')) {
        const consumed = consumeServerOptionValue(arg, rest, i, '--providers', parsed);
        if (!consumed) return parsed;
        applyServerProvidersOption(consumed.value, parsed);
        if (parsed.error) return parsed;
        i = consumed.next;
      }
      else if (arg === '--password' || arg.startsWith('--password=')) {
        const consumed = consumeServerOptionValue(arg, rest, i, '--password', parsed);
        if (!consumed) return parsed;
        parsed.serverPassword = consumed.value;
        i = consumed.next;
      }
      else if (!parsed.error) parsed.error = `Unknown server option: ${arg}`;
    }
    return parsed;
  }

  if (first === 'models' || first === 'favorites') {
    const parsed = emptyParsed('models');
    for (const arg of rest) {
      if (arg === '--help' || arg === '-h') parsed.showHelp = true;
      else if (arg === '--version' || arg === '-v') parsed.showVersion = true;
      else if (arg === '--agy') parsed.favoritesAgy = true;
      else if (arg === '--list') parsed.favoritesList = true;
      else if (!parsed.error) parsed.error = `Unknown models option: ${arg}`;
    }
    return parsed;
  }

  if (first === 'providers') {
    const parsed = emptyParsed('providers');
    parsed.claudeArgs = [];
    for (const arg of rest) {
      if (arg === '--trace') parsed.trace = true;
      else if (arg === '--help' || arg === '-h') parsed.showHelp = true;
      else if (arg === '--version' || arg === '-v') parsed.showVersion = true;
      else parsed.claudeArgs.push(arg);
    }
    return parsed;
  }

  if (first === 'ui') {
    const parsed = emptyParsed('ui');
    for (const arg of rest) {
      if (arg === '--trace') parsed.trace = true;
      else if (arg === '--help' || arg === '-h') parsed.showHelp = true;
      else if (arg === '--version' || arg === '-v') parsed.showVersion = true;
      else if (!parsed.error) parsed.error = `Unknown ui option: ${arg}`;
    }
    return parsed;
  }

  if (first === 'codex-app' || first === 'chatgpt') {
    const parsed = emptyParsed('codex-app');
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i]!;
      if (arg === '--help' || arg === '-h') { parsed.showHelp = true; continue; }
      if (arg === '--version' || arg === '-v') { parsed.showVersion = true; continue; }
      if (arg === '--vertex') { parsed.vertex = true; continue; }
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

  if (first === 'claude-app') {
    const parsed = emptyParsed('claude-app');
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i]!;
      if (arg === '--help' || arg === '-h') { parsed.showHelp = true; continue; }
      if (arg === '--version' || arg === '-v') { parsed.showVersion = true; continue; }
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

  if (first === 'gemini') {
    const parsed = emptyParsed('gemini');
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i]!;
      if (arg === '--trace') {
        parsed.trace = true;
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

  if (first === 'agy') {
    const parsed = emptyParsed('agy');
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i]!;
      if (arg === '--') {
        parsed.claudeArgs.push(...rest.slice(i + 1));
        break;
      }
      if (arg === '--trace') {
        parsed.trace = true;
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

  if (first === 'antigravity' || first === 'antigravity-ide') {
    const parsed = emptyParsed(first);
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i]!;
      if (arg === '--') {
        parsed.claudeArgs.push(...rest.slice(i + 1));
        break;
      }
      if (arg === '--trace') {
        parsed.trace = true;
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
    if (arg === '--http-proxy') parsed.httpProxy = true;
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
  relay-ai chatgpt [options]
  relay-ai gemini [options] [gemini-flags]
  relay-ai agy [options] [agy-flags]
  relay-ai antigravity [options]
  relay-ai antigravity-ide [options]
  relay-ai server [options]
  relay-ai ui
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
  gemini      Launch Google Gemini CLI with registry providers
  agy         Launch Antigravity CLI with registry providers
  antigravity Launch Antigravity app with registry providers (macOS)
  antigravity-ide  Launch Antigravity IDE with registry providers (macOS)
  codex-app   Launch ChatGPT desktop app (Codex mode) with registry providers (macOS + Windows)
  chatgpt     Alias for codex-app
  claude-app  Launch Claude Desktop app with registry providers (macOS + Windows)

${pc.bold('Antigravity favorites:')}
  agy, antigravity, and antigravity-ide share up to six Antigravity favorites
  from relay-ai favorites --agy, plus the selected launch model.

${pc.bold('Migration:')}
  Bare relay-ai prints this help instead of launching Claude Code.
  Use relay-ai claude for the wizard and launcher.

${pc.bold('Examples:')}
  relay-ai claude
  relay-ai models
  relay-ai providers
  relay-ai codex
  relay-ai gemini
  relay-ai agy
  relay-ai antigravity
  relay-ai antigravity-ide
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
  --http-proxy Preserve Claude Code's normal Anthropic auth; route favorite relay: models
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

${pc.bold('HTTP proxy mode:')}
  relay-ai claude --http-proxy leaves ANTHROPIC_BASE_URL unset and launches
  Claude Code with its normal Anthropic login. Favorite non-Anthropic AI SDK
  models are available by typing /model relay:<provider-id>:<model-id>.
  Run relay-ai models --list to print the exact names.

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
  relay-ai claude --http-proxy
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
  relay-ai server --quick
  relay-ai server --listen network --password <password>
  relay-ai server --http-proxy
  relay-ai server --vertex
  relay-ai server --help
  relay-ai server --version

${pc.bold('Options:')}
  --quick, --saved             Start immediately from saved/default settings
  --listen local|network       One-run listen mode override
  --providers all|favorites|id1,id2
                               One-run provider catalog override
  --free-only, --no-free-only  One-run free-model filter override
  --mask-gateway-ids           Mask provider names in Anthropic model ids
  --no-mask-gateway-ids        Keep provider names in Anthropic model ids
  --password <value>           One-run network-mode server password
  --http-proxy                 Selective api.anthropic.com HTTP proxy (local only)
  --vertex                     Use Claude on Google Vertex AI

${pc.bold('Behavior:')}
  Default: interactive wizard for exposed providers, discovery id masking (for
  Claude Desktop / Cowork), optional favorites-only catalog, then listen mode.
  Quick mode skips prompts and uses saved settings. Any one-run option also
  starts without prompts. Non-interactive stdin uses quick mode automatically.
  Network quick mode requires a saved password or --password.
  --vertex: Anthropic-compatible gateway to Claude on Google Vertex AI using
  local gcloud Application Default Credentials (no OpenCode API key).
  Binds to port 17645. Network mode asks for a server password.

${pc.bold('HTTP proxy env:')}
  Start relay-ai server --http-proxy, then export the HTTPS_PROXY, HTTP_PROXY,
  and NODE_EXTRA_CA_CERTS values it prints. Do not set ANTHROPIC_BASE_URL.

${pc.bold('Vertex env:')}
  ANTHROPIC_VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT — your GCP project
  GOOGLE_CLOUD_LOCATION or CLOUD_ML_REGION — region (default: global)
  Optional catalog: ~/.relay-ai/vertex-models.json (see assets/vertex-models.example.json)

${pc.bold('Gateway endpoints (without --http-proxy):')}
  Anthropic-compatible:  ANTHROPIC_BASE_URL=http://127.0.0.1:17645/anthropic
  OpenAI-compatible:     OPENAI_BASE_URL=http://127.0.0.1:17645/openai/v1
  API key: use anything locally; use the server password in network mode.`;
}

export function modelsHelpText(): string {
  return `${pc.bold('relay-ai favorites')} v${VERSION}
Manage favorite models for mid-session switching.

${pc.bold('Usage:')}
  relay-ai favorites
  relay-ai models --list
  relay-ai favorites --agy
  relay-ai models
  relay-ai favorites --help
  relay-ai favorites --version

${pc.bold('Behavior:')}
  Opens an interactive manager to add or remove favorites.
  Search all providers at once (paginated results) or browse one provider at a time.
  Pick from Zen, Go, or any provider in your registry.
  Global favorites are saved to ~/.relay-ai/config.json (max ${MAX_MODEL_CATALOG}).
  --agy manages Antigravity CLI favorites only (max 6).
  --list prints the exact relay:<provider-id>:<model-id> names available in
  HTTP proxy mode, without opening the interactive manager.

${pc.bold('How it works:')}
  Claude/Codex/Gemini/server use the global favorites list.
  Favorites appear in supported /model switch menus.
  relay-ai agy, antigravity, and antigravity-ide use the Antigravity favorites
  list so the limited native switch slots stay predictable: one selected launch
  model plus up to six Antigravity favorites.

${pc.bold('Examples:')}
  relay-ai favorites
  relay-ai favorites --agy
  relay-ai claude    # switch menu active when favorites are set`;
}


export function antigravityCliHelpText(): string {
  return `${pc.bold('relay-ai agy')} v${VERSION}
Launch Antigravity CLI with Relay AI provider registry.

${pc.bold('Usage:')}
  relay-ai agy [options] [agy-flags]
  relay-ai agy --help
  relay-ai agy --version

${pc.bold('Relay options:')}
  --provider <id>    Use a specific provider (skip picker)
  --model <id>       Use a specific model (skip picker)
  --trace            Write debug log to /tmp/relay-ai-debug.log
  -h, --help         Show this help
  -v, --version      Show version

${pc.bold('How it works:')}
  Starts a local Cloud Code gateway, points agy at it via CLOUD_CODE_URL,
  and injects Relay AI models into Antigravity's native model picker.
  All Cloud Code traffic routes through Relay — no Google Cloud Code upstream.

${pc.bold('Examples:')}
  relay-ai agy
  relay-ai agy --provider zen --model deepseek-v4-flash-free
  relay-ai agy -p "fix this bug"`;
}

export function antigravityIdeHelpText(): string {
  return `${pc.bold('relay-ai antigravity-ide')} v${VERSION}
Launch Antigravity IDE with Relay AI provider registry.

${pc.bold('Usage:')}
  relay-ai antigravity-ide [options]
  relay-ai antigravity-ide --help
  relay-ai antigravity-ide --version

${pc.bold('Relay options:')}
  --provider <id>    Use a specific provider (skip picker)
  --model <id>       Use a specific model (skip picker)
  --trace            Write debug log to /tmp/relay-ai-debug.log
  -h, --help         Show this help
  -v, --version      Show version

${pc.bold('How it works:')}
  Creates an isolated Relay-managed IDE profile, starts a local Cloud Code
  gateway, and injects Relay AI models into Antigravity's native picker.
  The normal IDE profile is never modified.

${pc.bold('Platform:')}
  macOS (Apple Silicon) — other platforms coming after testing.

${pc.bold('Examples:')}
  relay-ai antigravity-ide
  relay-ai antigravity-ide --provider zen --model deepseek-v4-flash-free`;
}

export function antigravityAppHelpText(): string {
  return `${pc.bold('relay-ai antigravity')} v${VERSION}
Launch Antigravity with Relay AI provider registry.

${pc.bold('Usage:')}
  relay-ai antigravity [options]
  relay-ai antigravity --help
  relay-ai antigravity --version

${pc.bold('Relay options:')}
  --provider <id>    Use a specific provider (skip picker)
  --model <id>       Use a specific model (skip picker)
  --trace            Write debug log to /tmp/relay-ai-debug.log
  -h, --help         Show this help
  -v, --version      Show version

${pc.bold('How it works:')}
  Creates an isolated Relay-managed Antigravity profile, starts a local Cloud
  Code gateway, and injects Relay AI models into Antigravity's native picker.
  The normal Antigravity profile is never modified.

${pc.bold('Favorites:')}
  Uses the same Antigravity favorites list as relay-ai favorites --agy:
  up to six saved favorites plus the selected launch model.

${pc.bold('Platform:')}
  macOS (Apple Silicon) — other platforms coming after testing.

${pc.bold('Examples:')}
  relay-ai antigravity
  relay-ai antigravity --provider zen --model deepseek-v4-flash-free`;
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

const AGY_CLI_FAVORITES_CAP = 6;

interface FavoritesCommandOptions {
  scope?: 'global' | 'agy';
  list?: boolean;
}

export async function runModelsCommand(opts: FavoritesCommandOptions = {}): Promise<number> {
  const scope = opts.scope ?? 'global';
  if (opts.list) {
    if (scope === 'agy') {
      p.log.error('--list shows global favorites used by HTTP proxy mode; remove --agy.');
      return 1;
    }
    try {
      const loaded = await loadHttpProxyRoutes();
      printHttpProxyModels(loaded.routes);
      reportSkippedHttpProxyFavorites(loaded);
      return 0;
    } catch (err) {
      p.log.error(`Could not load HTTP proxy models: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }
  const maxFavorites = scope === 'agy' ? AGY_CLI_FAVORITES_CAP : MAX_MODEL_CATALOG;
  const scopeName = scope === 'agy' ? 'Antigravity CLI Favorites' : 'Favorite Models';
  const configKey = scope === 'agy' ? 'antigravityCliFavoriteModels' : 'favoriteModels';
  relayIntro(scopeName);

  const spinner = p.spinner();
  spinner.start('Loading providers...');

  const catalog = await fetchProviderCatalog();
  spinner.stop('');

  const allProviders = scope === 'agy'
    ? providersForTarget(providersForPicker(catalog), 'antigravity')
    : providersForPicker(catalog);
  const favoriteProviders = allProviders.map(provider => ({
    ...provider,
    name: favoriteProviderDisplayName(provider),
  }));

  if (favoriteProviders.length === 0) {
    p.log.warn('No providers found.');
    p.log.info(`${pc.dim('OpenCode Zen/Go is always available. Add providers with ')}${pc.cyan('relay-ai providers')}${pc.dim('.')}`);
    relayOutro('Done');
    return 0;
  }

  // Build a flat name lookup: "providerId:modelId" → display label
  const modelLookup = new Map<string, { modelName: string; providerName: string }>();
  for (const ap of favoriteProviders) {
    for (const m of ap.models) {
      modelLookup.set(`${ap.id}:${m.id}`, { modelName: m.name || m.id, providerName: ap.name });
    }
  }

  const prefs = loadPreferences();
  let favorites = scope === 'agy'
    ? prefs.antigravityCliFavoriteModels ?? []
    : prefs.favoriteModels ?? [];
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

    const atCap = favorites.length >= maxFavorites;
    options.push({
      value: '__add__',
      label: atCap ? pc.dim(`+ Add a model → (limit of ${maxFavorites} reached)`) : pc.cyan('+ Add a model →'),
      hint: atCap
        ? 'Remove a favorite first to make room'
        : `${allProviders.length} provider${allProviders.length !== 1 ? 's' : ''} available`,
    });
    options.push({ value: '__done__', label: 'Done', hint: '' });

    const header = favorites.length === 0
      ? `${scopeName} (0/${maxFavorites})`
      : `${scopeName} (${favorites.length}/${maxFavorites}) — select to remove`;

    const choice = await p.select<string>({
      message: header,
      options,
      initialValue: '__done__',
    });

    if (p.isCancel(choice) || choice === '__done__') break;

    if (choice === '__add__') {
      if (atCap) {
        p.log.warn(`Limit of ${maxFavorites} favorites reached — remove one first.`);
        continue;
      }

      const globalCount = buildGlobalFavoriteIndex(favoriteProviders).length;
      const addPath = await p.select<string>({
        message: 'Add a favorite',
        options: [
          {
            value: 'global',
            label: pc.cyan('Search all providers'),
                hint: `${globalCount} models · ${favoriteProviders.length} provider${favoriteProviders.length !== 1 ? 's' : ''}`,
          },
          {
            value: 'free',
            label: pc.cyan('Search free models'),
            hint: `${buildGlobalFavoriteIndex(favoriteProviders).filter(e => e.model.isFree || e.model.freeStatus === 'verified_free' || e.model.freeStatus === 'free_provider').length} free/free-access models`,
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
      let browsedMultiple: LocalProviderModel[] = [];

      if (addPath === 'global') {
        const globalPick = await pickGlobalFavoriteModel(favoriteProviders, favorites);
        if (globalPick === null) continue;
        if (globalPick !== browseByProviderChoice) {
          provider = favoriteProviders.find(ap => ap.id === globalPick.providerId);
          browsedMultiple = [globalPick.model];
        }
      }
      if (addPath === 'free') {
        const globalPick = await pickGlobalFavoriteModel(favoriteProviders, favorites, { freeOnly: true });
        if (globalPick === null) continue;
        if (globalPick !== browseByProviderChoice) {
          provider = favoriteProviders.find(ap => ap.id === globalPick.providerId);
          browsedMultiple = [globalPick.model];
        }
      }

      if (browsedMultiple.length === 0) {
        let currentInitialProvider: string | undefined = undefined;
        while (true) {
          const providerOptions = favoriteProviders.map(ap => providerSelectOption(ap));
          const pickedProviderId: string | symbol = await p.select({
            message: 'Which provider?',
            options: providerOptions,
            initialValue: currentInitialProvider,
          });
          if (p.isCancel(pickedProviderId)) break;

          provider = favoriteProviders.find(ap => ap.id === pickedProviderId)!;
          
          const options = provider.models.map(m => {
            const favorited = isFavorite(favorites, { providerId: provider!.id, modelId: m.id });
            const label = formatModelLabel(m);
            return {
              value: m.id,
              label: fmtModel(label, m.id),
              hint: favorited ? pc.yellow('★ already favorite') : '',
            };
          });

          const pickedModelIds = await p.multiselect({
            message: `Select models to add from ${provider.name} ${pc.dim('(Space to select, Enter to confirm)')}`,
            options,
            required: false,
          });

          if (p.isCancel(pickedModelIds)) {
            currentInitialProvider = provider.id;
            continue;
          }

          if (pickedModelIds.length === 0) {
            currentInitialProvider = provider.id;
            continue;
          }

          browsedMultiple = provider.models.filter(m => (pickedModelIds as string[]).includes(m.id));
          break;
        }
        if (browsedMultiple.length === 0) continue;
      }

      const addedModels: LocalProviderModel[] = [];
      let duplicateCount = 0;
      let limitReached = false;

      for (const model of browsedMultiple) {
        const fav: FavoriteModel = { providerId: provider!.id, modelId: model.id };
        const result = addFavorite(favorites, fav, maxFavorites);
        if (!result.ok) {
          if (result.reason === 'duplicate') {
            duplicateCount++;
          } else {
            limitReached = true;
            break;
          }
        } else {
          favorites = result.list;
          favoritesDirty = true;
          addedModels.push(model);
        }
      }

      if (addedModels.length > 0) {
        if (addedModels.length === 1) {
          const modelName = addedModels[0].name || addedModels[0].id;
          p.log.success(`Added ${modelName} (${provider!.name}) to favorites.`);
        } else {
          p.log.success(`Added ${addedModels.length} models from ${provider!.name} to favorites.`);
        }
      }
      if (duplicateCount > 0) {
        p.log.warn(`${duplicateCount} selected model(s) were already in your favorites.`);
      }
      if (limitReached) {
        p.log.warn(`Limit of ${maxFavorites} favorites reached — some selected models could not be added.`);
      }
    } else if ((choice as string).startsWith('fav-')) {
      const idx = parseInt((choice as string).slice(4), 10);
      const fav = favorites[idx]!;
      const entry = modelLookup.get(`${fav.providerId}:${fav.modelId}`);
      const label = entry ? `${entry.modelName} (${entry.providerName})` : fav.modelId;
      const confirmed = await p.confirm({ message: `Remove ${label} from favorites?` });
      if (p.isCancel(confirmed) || !confirmed) continue;
      favorites = removeFavorite(favorites, fav);
      favoritesDirty = true;
      p.log.success(`Removed ${label} from favorites.`);
    }
  }

  if (favoritesDirty) {
    savePreferences({ [configKey]: favorites });
  }

  const favLabel = scope === 'agy' ? 'Antigravity CLI ' : '';
  relayOutro(
    favorites.length === 0
      ? `No ${favLabel}favorites saved`
      : `${favorites.length} ${favLabel}favorite${favorites.length !== 1 ? 's' : ''} saved`,
    favorites.length === 0
      ? pc.dim('Launch uses single-model mode')
      : pc.cyan('/model menu ready on next launch'),
  );
  return 0;
}

async function runClaudeHttpProxyCommand(
  parsed: ParsedArgs,
  claudeArgs: string[],
  agentStdout: boolean,
): Promise<number> {
  if (parsed.launchProvider || parsed.launchModel) {
    p.log.error('--provider/--model select Relay gateway routes and cannot be combined with --http-proxy.');
    p.log.info('Use `-- --model relay:<provider-id>:<model-id>` to start on a listed HTTP-proxy favorite.');
    return 1;
  }

  if (!agentStdout) relayIntro('Claude Code — HTTP Proxy');

  if (parsed.dryRun) {
    try {
      const loaded = await loadHttpProxyRoutes();
      console.log('');
      console.log(pc.bold(pc.cyan('  DRY RUN — HTTP proxy mode')));
      console.log('  ANTHROPIC_BASE_URL is not set by Relay AI.');
      console.log('  HTTPS_PROXY/HTTP_PROXY=http://127.0.0.1:<random-port>');
      console.log('  NODE_EXTRA_CA_CERTS=~/.relay-ai/http-proxy/relay-ai-ca.pem');
      console.log('');
      printHttpProxyModels(loaded.routes);
      reportSkippedHttpProxyFavorites(loaded);
      console.log('');
      return 0;
    } catch (err) {
      p.log.error(`Could not load HTTP proxy models: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  let started: Awaited<ReturnType<typeof startConfiguredHttpProxy>>;
  try {
    started = await startConfiguredHttpProxy(0, parsed.trace);
  } catch (err) {
    p.log.error(`Failed to start HTTP proxy: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const { handle, loaded } = started;
  if (!agentStdout) {
    p.log.info(`HTTP proxy started on port ${handle.port}; Claude Code's Anthropic auth remains active.`);
    p.log.info(`Inference request log: ${handle.inferenceLogPath}`);
    printHttpProxyModels(loaded.routes);
    reportSkippedHttpProxyFavorites(loaded);
    if (loaded.routes.length > 0) {
      p.log.info('Switch with `/model relay:<provider-id>:<model-id>`.');
    }
  }

  const childEnv = buildHttpProxyChildEnv(handle.port, handle.caCertPath);
  const debugLogPath = prepareClaudeTraceLog();
  const traceArgs = parsed.trace ? ['--debug-file', debugLogPath] : [];
  if (parsed.trace && !agentStdout) p.log.info(`Debug log: ${debugLogPath}`);

  try {
    const exitCode = await launchClaude(childEnv, undefined, [...traceArgs, ...claudeArgs]);
    if (parsed.trace) printTraceLog(debugLogPath);
    return exitCode;
  } finally {
    await handle.close();
  }
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

  if (parsed.httpProxy) {
    return runClaudeHttpProxyCommand(parsed, claudeArgs, agentStdout);
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

  const allProviders = providersForTarget(providersForPicker(catalog), 'claude');
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
    let currentInitialProvider = initialProvider;
    while (true) {
      const chosen = await p.select<string>({
        message: 'Which provider?',
        options: providerOptions,
        initialValue: currentInitialProvider,
      });

      if (p.isCancel(chosen)) {
        p.cancel('Cancelled.');
        return 0;
      }

      const providerChoice = chosen as string;

      if (providerChoice === '__favorites__') {
        const available: Array<{ provider: LocalProvider; model: LocalProviderModel }> = [];
        for (const fav of favorites) {
          const prov = allProviders.find(lp => lp.id === fav.providerId);
          const mod = prov?.models.find(m => m.id === fav.modelId);
          if (prov && mod) available.push({ provider: prov, model: mod });
        }
        if (available.length === 0) {
          p.log.warn('No saved favorites are currently available.');
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
        if (!dryRun) recordLaunchSelection('claude', activeProvider.id, selectedModel.id, prefs);
        break;
      } else {
        activeProvider = allProviders.find(lp => lp.id === providerChoice)!;
        const pickedModelResult = await pickLocalModel(activeProvider, conflicts, prefs);
        if (pickedModelResult === 'back') {
          currentInitialProvider = activeProvider.id;
          continue;
        }
        if (!pickedModelResult) return 0;
        selectedModel = pickedModelResult;

        if (!dryRun) recordLaunchSelection('claude', activeProvider.id, selectedModel.id, prefs);
        break;
      }
    }
  }

  const localProviders = catalog.length > 0 ? catalog : null;
  if (switchMenuActive) {
    const resolveRoute = makeRouteResolver(
      localProviders,
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

  const isAntigravityOAuth = activeProvider.id === 'antigravity' && activeProvider.authType === 'oauth';
  const isOAuthAnthropic = selectedModel.modelFormat === 'anthropic' && activeProvider.authType === 'oauth' && !isAntigravityOAuth;

  if (isAntigravityOAuth) {
    // Antigravity OAuth — proxy translates Anthropic → Cloud Code Assist format.
    try {
      proxyHandle = await startProxy(
        ANTIGRAVITY_BASE_URLS[0],
        selectedModel.id,
        trace,
        selectedModel.contextWindow,
        {
          providerId: activeProvider.id,
          authType: 'oauth',
          providerData: activeProvider.providerData,
          modelFormat: 'cloud-code',
        },
        launchApiKey,
      );
      if (!isAgentStdoutMode()) p.log.info(`Cloud Code proxy started on port ${proxyHandle.port}`);
    } catch (err) {
      p.log.error(`Failed to start Cloud Code proxy: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
    childEnv = buildChildEnv(
      `http://127.0.0.1:${proxyHandle.port}`,
      selectedModel.id,
      proxyHandle.token,
      proxyHandle.port,
      selectedModel.contextWindow,
    );
  } else if (isOAuthAnthropic) {
    // Claude Code OAuth — proxy injects compatibility metadata and Bearer auth.
    try {
      proxyHandle = await startProxy(
        selectedModel.baseUrl ?? 'https://api.anthropic.com',
        selectedModel.id,
        trace,
        selectedModel.contextWindow,
        {
          providerId: activeProvider.id,
          authType: 'oauth',
          oauthAccountId: activeProvider.oauthAccountId,
          providerData: activeProvider.providerData,
          modelFormat: 'anthropic',
        },
        launchApiKey,
      );
      if (!isAgentStdoutMode()) p.log.info(`OAuth proxy started on port ${proxyHandle.port}`);
    } catch (err) {
      p.log.error(`Failed to start OAuth proxy: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
    childEnv = buildChildEnv(
      `http://127.0.0.1:${proxyHandle.port}`,
      selectedModel.id,
      proxyHandle.token,
      proxyHandle.port,
      selectedModel.contextWindow,
    );
  } else if (selectedModel.modelFormat === 'anthropic') {
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
          useResponsesLite: selectedModel.useResponsesLite,
          preferWebSockets: selectedModel.preferWebSockets,
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

  if (selectedModel.modelFormat === 'anthropic' && !isOAuthAnthropic) {
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
    return runServerCommand({
      vertex: parsed.vertex,
      httpProxy: parsed.httpProxy,
      quick: parsed.serverQuick,
      listenMode: parsed.serverListenMode,
      providersMode: parsed.serverProvidersMode,
      providerIds: parsed.serverProviderIds,
      freeOnly: parsed.serverFreeOnly,
      maskGatewayIds: parsed.serverMaskGatewayIds,
      password: parsed.serverPassword,
    });
  }

  if (parsed.command === 'ui') {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    if (parsed.showHelp) {
      console.log('Usage: relay-ai ui [--trace]\n\nOpen the settings UI in your browser.');
      return 0;
    }
    const { runUiCommand } = await import('./ui-command.js');
    return runUiCommand({ trace: parsed.trace });
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
    return runModelsCommand({
      scope: parsed.favoritesAgy ? 'agy' : 'global',
      list: parsed.favoritesList,
    });
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
    if (parsed.trace) {
      process.env.RELAY_AI_TRACE = '1';
    }
    return runProvidersCommand(parsed.claudeArgs);
  }

  if (parsed.command === 'codex-app') {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    return runCodexAppCommand(parsed.claudeArgs, { vertex: parsed.vertex, launchProvider: parsed.launchProvider, launchModel: parsed.launchModel });
  }

  if (parsed.command === 'claude-app') {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    return runClaudeAppCommand(parsed.claudeArgs, { launchProvider: parsed.launchProvider, launchModel: parsed.launchModel });
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

  if (parsed.command === 'gemini') {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    if (parsed.showHelp) {
      console.log(geminiHelpText());
      return 0;
    }
    return runGeminiCommand(parsed.claudeArgs, parsed.trace, {
      launchProvider: parsed.launchProvider,
      launchModel: parsed.launchModel,
    });
  }

  if (parsed.command === 'agy') {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    if (parsed.showHelp) {
      console.log(antigravityCliHelpText());
      return 0;
    }
    return runAgyCommand(parsed.claudeArgs, parsed.trace, {
      launchProvider: parsed.launchProvider,
      launchModel: parsed.launchModel,
    });
  }

  if (parsed.command === 'antigravity') {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    if (parsed.showHelp) {
      console.log(antigravityAppHelpText());
      return 0;
    }
    return runAntigravityAppCommand(parsed.claudeArgs, parsed.trace, {
      launchProvider: parsed.launchProvider,
      launchModel: parsed.launchModel,
    });
  }

  if (parsed.command === 'antigravity-ide') {
    if (parsed.showVersion) {
      console.log(VERSION);
      return 0;
    }
    if (parsed.showHelp) {
      console.log(antigravityIdeHelpText());
      return 0;
    }
    return runAntigravityIdeCommand(parsed.claudeArgs, parsed.trace, {
      launchProvider: parsed.launchProvider,
      launchModel: parsed.launchModel,
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
