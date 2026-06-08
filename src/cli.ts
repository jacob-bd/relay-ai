// src/cli.ts
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { appendFileSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { findClaudeBinary, launchClaude } from './launch.js';
import { resolveApiKey, detectConflicts, buildChildEnv, readFromCredentialStore, saveToCredentialStore, isSecretServiceAvailable } from './env.js';
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
import { loadPreferences, savePreferences, getSubscriptionTier, setSubscriptionTier } from './config.js';
import { runWizard, askSubscriptionTier, pickLocalModel, browseAllModels } from './prompts.js';
import { fetchLocalProviders } from './providers.js';
import { fetchProviderCatalog, fetchZenGoModels, providersForPicker } from './provider-catalog.js';
import { BACKENDS, VERSION } from './constants.js';
import type { ParsedArgs, ModelInfo, FavoriteModel } from './types.js';
import { addFavorite, removeFavorite } from './favorites.js';

const STARTER_CLAUDE_FLAGS = new Set(['--dry-run', '--setup', '--trace', '--help', '-h', '--version', '-v']);

function emptyParsed(command: ParsedArgs['command']): ParsedArgs {
  return {
    command,
    showHelp: false,
    showVersion: false,
    dryRun: false,
    setup: false,
    trace: false,
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
  return `${pc.bold('opencode-starter')} v${VERSION}
Launch AI coding tools with OpenCode Zen, Go, or local providers (Groq, Mistral,
OpenAI, Gemini, Ollama, and more).

${pc.bold('Usage:')}
  opencode-starter claude [starter-options] [claude-flags]
  opencode-starter models
  opencode-starter server
  opencode-starter --help
  opencode-starter --version

${pc.bold('Commands:')}
  claude      Launch Claude Code — cloud Zen/Go or local OpenCode providers
  models      Manage favorite models for mid-session /model switching (max ${MAX_MODEL_CATALOG})
  server      Run a foreground API gateway (Zen, Go, and local providers)
  codex       planned

${pc.bold('Migration:')}
  Bare opencode-starter prints this help instead of launching Claude Code.
  Use opencode-starter claude for the wizard and launcher.

${pc.bold('Examples:')}
  opencode-starter claude
  opencode-starter models
  opencode-starter server
  opencode-starter claude -c
  opencode-starter claude --resume abc-123
  opencode-starter claude -- --print "hello"`;
}

export function claudeHelpText(): string {
  return `${pc.bold('opencode-starter claude')} v${VERSION}
Launch Claude Code with OpenCode Zen, Go, or local providers as the API backend.

${pc.bold('Usage:')}
  opencode-starter claude [starter-options] [claude-flags]
  opencode-starter claude --help
  opencode-starter claude --version

${pc.bold('Starter options:')}
  --dry-run    Run the wizard but show a preview instead of launching Claude Code
  --setup      Re-configure your subscription tier
  --trace      Write debug logs to /tmp and show errors on exit
  --help       Show this command help
  --version    Show version

${pc.bold('Providers:')}
  Cloud (Zen/Go)  Requires OPENCODE_API_KEY — get one at https://opencode.ai/auth
  Local           Requires OpenCode CLI with providers configured (Groq, Mistral,
                  OpenAI, Gemini, Ollama, etc.). Shown in the wizard when available.

${pc.bold('Model switching:')}
  Run opencode-starter models to save favorites (max ${MAX_MODEL_CATALOG}).
  When favorites exist, launch starts a multi-route proxy and Claude Code /model
  lists your starting model plus favorites for live switching.
  With no favorites, launch uses a single model as before.

${pc.bold('Note:')}
  Claude Code may save the launched model to ~/.claude/settings.json.
  Bare claude later can still show that model — reset with claude --model sonnet.

${pc.bold('Examples:')}
  opencode-starter claude
  opencode-starter claude -c
  opencode-starter claude --resume abc-123
  opencode-starter claude abc-123
  opencode-starter claude --dry-run -c
  opencode-starter claude --setup
  opencode-starter claude --trace --resume abc-123
  opencode-starter claude -- --print "hello"
  opencode-starter claude -- --dangerously-skip-permissions`;
}

export function serverHelpText(): string {
  return `${pc.bold('opencode-starter server')} v${VERSION}
Run a foreground API gateway for Zen, Go, and local OpenCode providers.

${pc.bold('Usage:')}
  opencode-starter server
  opencode-starter server --help
  opencode-starter server --version

${pc.bold('Behavior:')}
  Loads Zen/Go models plus configured local providers into one catalog.
  Prompts for local-only (127.0.0.1) or network (0.0.0.0) listen mode.
  Binds to port 17645. Network mode asks for a server password.
  Server password is saved only if the user chooses to save it.
  Server host and port are not saved.

${pc.bold('Endpoints:')}
  Anthropic-compatible:  ANTHROPIC_BASE_URL=http://127.0.0.1:17645/anthropic
  OpenAI-compatible:     OPENAI_BASE_URL=http://127.0.0.1:17645/openai/v1
  API key: use anything locally; use the server password in network mode.`;
}

export function modelsHelpText(): string {
  return `${pc.bold('opencode-starter models')} v${VERSION}
Manage favorite models for mid-session switching in Claude Code.

${pc.bold('Usage:')}
  opencode-starter models
  opencode-starter models --help
  opencode-starter models --version

${pc.bold('Behavior:')}
  Opens an interactive manager to add or remove favorites.
  Pick from Zen, Go, or any configured local OpenCode provider.
  Favorites are saved to ~/.opencode-starter/config.json (max ${MAX_MODEL_CATALOG}).

${pc.bold('How it works:')}
  When favorites exist, opencode-starter claude starts a multi-route catalog proxy.
  Claude Code /model lists your starting model plus favorites — switch live
  without restarting. Mix cloud and local favorites in one session.
  With no favorites, launch uses a single model as before.

${pc.bold('Examples:')}
  opencode-starter models
  opencode-starter claude    # switch menu active when favorites are set`;
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

  const debugLogPath = join(tmpdir(), 'opencode-starter-debug.log');
  const traceArgs = trace ? ['--debug-file', debugLogPath] : [];
  if (trace) p.log.info(`Debug log: ${debugLogPath}`);

  const exitCode = await launchClaude(childEnv, startingRoute.aliasId, [...traceArgs, ...claudeArgs]);
  proxyHandle.close();
  if (trace) printTraceLog(debugLogPath);
  return exitCode;
}

function printTraceLog(debugLogPath: string): void {
  if (!existsSync(debugLogPath)) return;
  const log = readFileSync(debugLogPath, 'utf8');
  const errorLines = log.split('\n').filter(l =>
    l.includes('error') || l.includes('Error') || l.includes('"type":"error"') || l.includes('status')
  );
  console.log('\n' + pc.bold(pc.cyan('── Debug trace ──')));
  if (errorLines.length > 0) {
    errorLines.slice(0, 30).forEach(l => console.log(pc.dim(l)));
  } else {
    console.log(pc.dim('(no errors found in debug log)'));
  }
  console.log(pc.dim(`Full log: ${debugLogPath}`));
}

function printDryRun(
  backendName: string,
  modelId: string,
  baseUrl: string,
  modelFormat: ModelFormat,
  claudeArgs: string[],
  conflicts: Array<{ name: string; value: string }>,
  disableExperimentalBetas: boolean,
): void {
  console.log('');
  console.log(pc.bold(pc.cyan('  DRY RUN — would execute:')));
  console.log('');

  const claudeCmd = ['claude', '--model', modelId, ...claudeArgs].join(' ');
  console.log(`  ${pc.bold('Command:')}  ${claudeCmd}`);
  console.log(`  ${pc.bold('Backend:')}  ${backendName}`);
  if (modelFormat === 'openai') {
    console.log(`  ${pc.bold('Proxy:')}    would start local translation proxy ${pc.dim('(Anthropic → OpenAI)')}`);
    console.log(`             ${pc.dim(`→ ${baseUrl}/v1/chat/completions`)}`);
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

function detectShellProfile(): { display: string; path: string } {
  const shell = process.env['SHELL'] ?? '';
  if (process.platform === 'darwin') {
    if (shell.includes('zsh'))  return { display: '~/.zshrc',       path: `${homedir()}/.zshrc` };
    if (shell.includes('bash')) return { display: '~/.bash_profile', path: `${homedir()}/.bash_profile` };
    return { display: '~/.profile', path: `${homedir()}/.profile` };
  }
  if (process.platform === 'linux') {
    if (shell.includes('zsh'))  return { display: '~/.zshrc',   path: `${homedir()}/.zshrc` };
    if (shell.includes('bash')) return { display: '~/.bashrc',  path: `${homedir()}/.bashrc` };
    return { display: '~/.profile', path: `${homedir()}/.profile` };
  }
  // Windows — not used for save options (setx is used instead) but available for display
  if (shell.includes('bash')) return { display: '~/.bashrc', path: `${homedir()}/.bashrc` };
  return { display: '~/.profile', path: `${homedir()}/.profile` };
}


async function resolveOrCollectApiKey(simulate = false, trace = false): Promise<string | null> {
  // Step 1: already in environment (skipped in simulate/dry-run mode)
  if (!simulate) {
    const existing = resolveApiKey();
    if (existing) return existing;
  }

  const isMac     = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';
  const isLinux   = process.platform === 'linux';

  if (simulate) {
    p.note(
      'Running in dry-run mode — no keys will be read from or written to your system.',
      'Simulating first-run onboarding',
    );
  }

  // Step 2: silently check the OS credential store (skipped in dry-run/simulate mode)
  if (!simulate) {
    const keyDiag = (reason: string) => {
      p.log.warn(`Credential store unavailable — ${reason}`);
      if (trace) {
        try {
          appendFileSync(
            join(tmpdir(), 'opencode-starter-debug.log'),
            `${new Date().toISOString()} keyring: ${reason}\n`,
          );
        } catch { /* ignore */ }
      }
    };
    const storedKey = await readFromCredentialStore(keyDiag);
    if (storedKey) {
      const storeName = isMac ? 'macOS Keychain' : isWindows ? 'Windows Credential Manager' : 'Secret Service';
      p.log.success(`Found key in ${storeName}`);
      process.env['OPENCODE_API_KEY'] = storedKey;
      return storedKey;
    }
  }

  // Step 3: prompt for the key (masked — shows asterisks, not the actual key)
  p.note('Get your free key at: https://opencode.ai/auth', 'OpenCode API key');

  const key = await p.password({
    message: 'Paste your OPENCODE_API_KEY:',
    validate: (val) => val.trim() ? undefined : 'Key cannot be empty',
  });

  if (p.isCancel(key)) { p.cancel('Cancelled.'); return null; }

  const trimmedKey = (key as string).trim();
  let secretServiceAvailable = false;
  if (isLinux && !simulate) {
    secretServiceAvailable = await isSecretServiceAvailable();
  }

  const { display, path } = detectShellProfile();

  // Step 4: where to save it
  type SaveChoice = 'keychain' | 'keychain-autoload' | 'profile' | 'session' | 'credential-manager' | 'setx' | 'secret-service';

  const saveOptions: Array<{ value: SaveChoice; label: string; hint: string }> = (() => {
    if (isMac) {
      return [
        {
          value: 'keychain' as SaveChoice,
          label: 'Keychain only',
          hint: 'Key stored encrypted in Keychain; opencode-starter reads it automatically next time',
        },
        {
          value: 'keychain-autoload' as SaveChoice,
          label: `Keychain + ${display} auto-load`,
          hint: `Key in Keychain; ${display} also exports it so all terminal tools can see it`,
        },
        {
          value: 'profile' as SaveChoice,
          label: `${display} only (plaintext)`,
          hint: 'Key written directly to your shell profile — simpler but less secure',
        },
        {
          value: 'session' as SaveChoice,
          label: 'This session only',
          hint: "Not saved anywhere — you'll be asked again next time",
        },
      ];
    }
    if (isWindows) {
      return [
        {
          value: 'credential-manager' as SaveChoice,
          label: 'Windows Credential Manager',
          hint: 'Key stored securely; opencode-starter reads it automatically next time',
        },
        {
          value: 'setx' as SaveChoice,
          label: 'Persistent environment variable (plaintext)',
          hint: 'Runs setx — key visible in System Properties → Environment Variables',
        },
        {
          value: 'session' as SaveChoice,
          label: 'This session only',
          hint: "Not saved anywhere — you'll be asked again next time",
        },
      ];
    }
    // Linux
    const opts: Array<{ value: SaveChoice; label: string; hint: string }> = [];
    if (secretServiceAvailable) {
      opts.push({
        value: 'secret-service' as SaveChoice,
        label: 'Secret Service (GNOME Keyring / KWallet)',
        hint: 'Key stored securely in your desktop keyring; opencode-starter reads it automatically next time',
      });
    } else if (!simulate) {
      p.log.info('No keyring daemon detected — secure storage requires GNOME Keyring or KWallet running.');
    }
    opts.push(
      {
        value: 'profile' as SaveChoice,
        label: `${display} (plaintext)`,
        hint: 'Key written directly to your shell profile',
      },
      {
        value: 'session' as SaveChoice,
        label: 'This session only',
        hint: "Not saved anywhere — you'll be asked again next time",
      },
    );
    return opts;
  })();

  const saveChoice = await p.select<SaveChoice>({
    message: 'Where should we save the key?',
    options: saveOptions,
    initialValue: (isMac ? 'keychain' : isWindows ? 'credential-manager' : secretServiceAvailable ? 'secret-service' : 'profile') as SaveChoice,
  });

  if (p.isCancel(saveChoice)) { p.cancel('Cancelled.'); return null; }

  if (simulate) {
    const dryRunMessages: Record<SaveChoice, string> = {
      keychain:            'Would save key to macOS Keychain',
      'keychain-autoload': `Would save key to macOS Keychain and add auto-load to ${display}`,
      'credential-manager': 'Would save key to Windows Credential Manager',
      setx:                'Would run: setx OPENCODE_API_KEY ***',
      'secret-service':    'Would save key to Secret Service (GNOME Keyring / KWallet)',
      profile:             `Would append OPENCODE_API_KEY export to ${display}`,
      session:             'Would use key for this session only',
    };
    p.log.info(`[dry-run] ${dryRunMessages[saveChoice]}`);
  } else if (saveChoice === 'keychain') {
    if (await saveToCredentialStore(trimmedKey)) {
      p.log.success('Key saved to macOS Keychain — active now and automatically loaded next time.');
    } else {
      p.log.warn('Could not write to Keychain — key will be used for this session only');
    }
  } else if (saveChoice === 'keychain-autoload') {
    if (await saveToCredentialStore(trimmedKey)) {
      try {
        const autoLoadLine = `export OPENCODE_API_KEY="$(security find-generic-password -s opencode-starter -a opencode-starter -w 2>/dev/null)"`;
        const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
        if (!existing.includes(autoLoadLine)) {
          appendFileSync(path, `\n# opencode-starter: load API key from macOS Keychain\n${autoLoadLine}\n`);
        }
        p.log.success(`Key saved to Keychain and auto-load added to ${display} — active now and in all future terminals.`);
      } catch {
        p.log.success('Key saved to Keychain — active now and automatically loaded next time.');
        p.log.warn(`Could not write auto-load line to ${display}`);
      }
    } else {
      p.log.warn('Could not write to Keychain — key will be used for this session only');
    }
  } else if (saveChoice === 'credential-manager') {
    if (await saveToCredentialStore(trimmedKey)) {
      p.log.success('Key saved to Windows Credential Manager — active now and automatically loaded next time.');
    } else {
      p.log.warn('Could not write to Credential Manager — key will be used for this session only');
    }
  } else if (saveChoice === 'setx') {
    try {
      const result = spawnSync('setx', ['OPENCODE_API_KEY', trimmedKey], { stdio: ['pipe', 'pipe', 'pipe'] });
      if (result.status !== 0) throw new Error('setx exited with non-zero status');
      p.log.success('Key saved as a user environment variable — active now and in all future terminals.');
    } catch {
      p.log.warn('Could not run setx — key will be used for this session only');
    }
  } else if (saveChoice === 'secret-service') {
    if (await saveToCredentialStore(trimmedKey)) {
      p.log.success('Key saved to Secret Service — active now and automatically loaded next time.');
    } else {
      p.log.warn('Could not write to Secret Service — key will be used for this session only');
    }
  } else if (saveChoice === 'profile') {
    try {
      if (!existsSync(path)) appendFileSync(path, '');
      const escapedKey = trimmedKey.replace(/'/g, "'\\''");
      appendFileSync(path, `\nexport OPENCODE_API_KEY='${escapedKey}'\n`);
      p.log.success(`Key saved to ${display} — active now and in all future terminals.`);
    } catch {
      p.log.warn(`Could not write to ${display} — key will be used for this session only`);
    }
  }

  if (!simulate) process.env['OPENCODE_API_KEY'] = trimmedKey;
  return trimmedKey;
}

export async function runModelsCommand(): Promise<number> {
  p.intro(pc.bold('  OpenCode Starter — Favorite Models'));

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

  p.intro(pc.bold('  OpenCode Starter'));

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
    } catch {
      zenGoSpinner.stop('');
      p.log.warn('Could not fetch OpenCode models — Zen/Go favorites will be skipped from /model catalog');
    }
  }

  const providerSpinner = p.spinner();
  providerSpinner.start('Checking for local providers...');
  const localProviders = await fetchLocalProviders();
  providerSpinner.stop('');

  if (localProviders === null) {
    p.log.info(pc.dim('Tip: Install OpenCode locally to unlock additional providers'));
  }

  let providerChoice: string = 'opencode';
  if (localProviders !== null && localProviders.length > 0) {
    const providerOptions: Array<{ value: string; label: string; hint: string }> = [
      { value: 'opencode', label: 'OpenCode (Zen / Go)', hint: 'Cloud API — requires OpenCode subscription' },
      ...localProviders.map(lp => ({
        value: lp.id,
        label: lp.name,
        hint: `${lp.models.length} model${lp.models.length !== 1 ? 's' : ''} available`,
      })),
    ];

    const initialProvider =
      prefs.lastProvider && providerOptions.some(o => o.value === prefs.lastProvider)
        ? prefs.lastProvider
        : 'opencode';

    const chosen = await p.select<string>({
      message: 'Which provider?',
      options: providerOptions,
      initialValue: initialProvider,
    });

    if (p.isCancel(chosen)) {
      p.cancel('Cancelled.');
      return 0;
    }

    providerChoice = chosen as string;
  }

  // ── Local provider branch ──
  if (providerChoice !== 'opencode') {
    const provider = localProviders!.find(lp => lp.id === providerChoice)!;

    // Model selection — same picker for both single and switch-menu paths
    const selectedModel = await pickLocalModel(provider, conflicts, prefs);
    if (!selectedModel) return 0;

    // Update recents (shared across both paths)
    if (!dryRun) {
      const prevRecent = prefs.recentModelsByProvider?.[provider.id] ?? [];
      const updatedRecent = [selectedModel.id, ...prevRecent.filter(id => id !== selectedModel.id)].slice(0, 3);
      savePreferences({
        lastProvider: provider.id,
        lastModel: selectedModel.id,
        recentModelsByProvider: { ...prefs.recentModelsByProvider, [provider.id]: updatedRecent },
      });
    }

    if (switchMenuActive) {
      const resolveRoute = makeRouteResolver(
        localProviders,
        earlyZenModels,
        earlyGoModels,
        earlyEffectiveKey,
      );
      const startingRoute = localModelToRoute(provider, selectedModel) ?? resolveRoute(provider.id, selectedModel.id);
      if (!startingRoute) {
        p.log.error('Could not resolve a proxy route for the selected model.');
        return 1;
      }
      const catalogRoutes = buildCatalogRoutes(startingRoute, favorites, resolveRoute);

      if (dryRun) {
        const endpoint = selectedModel.baseUrl ?? selectedModel.completionsUrl ?? '(unknown)';
        console.log('');
        console.log(pc.bold(pc.cyan('  DRY RUN — would execute (switch-menu mode):')));
        console.log('');
        console.log(`  ${pc.bold('Provider:')}      ${provider.name}`);
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

    // ── Single-model path (no favorites) ──

    if (dryRun) {
      const formatDesc = selectedModel.modelFormat === 'anthropic' ? 'direct passthrough' : 'via translation proxy';
      const endpoint = selectedModel.baseUrl ?? selectedModel.completionsUrl ?? '(unknown)';
      console.log('');
      console.log(pc.bold(pc.cyan('  DRY RUN — would execute:')));
      console.log('');
      console.log(`  ${pc.bold('Provider:')}  ${provider.name}`);
      console.log(`  ${pc.bold('Model:')}     ${selectedModel.id}`);
      console.log(`  ${pc.bold('Format:')}    ${selectedModel.modelFormat} (${formatDesc})`);
      console.log(`  ${pc.bold('Endpoint:')} ${endpoint}`);
      console.log(`  ${pc.bold('Key:')}       ${provider.id} provider key`);
      console.log('');
      console.log(pc.dim('  (dry run complete — Claude Code was NOT launched)'));
      console.log('');
      return 0;
    }

    let proxyHandle: ProxyHandle | null = null;
    let childEnv: NodeJS.ProcessEnv;

    if (selectedModel.modelFormat === 'anthropic') {
      childEnv = buildChildEnv(
        selectedModel.baseUrl!,
        selectedModel.id,
        provider.apiKey,
        undefined,
        selectedModel.contextWindow,
      );
    } else {
      try {
        proxyHandle = await startProxy(
          selectedModel.completionsUrl!,
          selectedModel.id,
          trace,
          selectedModel.contextWindow,
          { npm: selectedModel.npm, baseURL: selectedModel.apiBaseUrl },
        );
        p.log.info(
          `Translation proxy started on port ${proxyHandle.port} ` +
          pc.dim(`(${selectedModel.completionsUrl})`),
        );
      } catch (err) {
        p.log.error(`Failed to start translation proxy: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
      }
      childEnv = buildChildEnv(
        `http://127.0.0.1:${proxyHandle.port}`,
        selectedModel.id,
        provider.apiKey,
        proxyHandle.port,
        selectedModel.contextWindow,
      );
    }

    if (selectedModel.modelFormat === 'anthropic') {
      childEnv['CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS'] = '1';
    }

    const debugLogPath = join(tmpdir(), 'opencode-starter-debug.log');
    const traceArgs = trace ? ['--debug-file', debugLogPath] : [];
    if (trace) p.log.info(`Debug log: ${debugLogPath}`);

    const exitCode = await launchClaude(childEnv, selectedModel.id, [...traceArgs, ...claudeArgs]);
    proxyHandle?.close();
    if (trace) printTraceLog(debugLogPath);
    return exitCode;
  }

  // ── OpenCode cloud branch ──

  // When earlyEffectiveKey was already resolved (because of Zen/Go favorites), reuse it;
  // otherwise run the normal key resolution now.
  const apiKey = earlyEffectiveKey ?? await resolveOrCollectApiKey(dryRun, trace);
  if (!apiKey && !dryRun) return 0;
  const effectiveKey = apiKey ?? 'dry-run-placeholder';

  // Subscription tier: ignored in dry-run so the user sees the question fresh
  let tier = dryRun ? null : getSubscriptionTier();
  if (!tier || setup) {
    tier = await askSubscriptionTier();
    if (!tier) return 0;
    if (!dryRun) setSubscriptionTier(tier);  // don't persist in dry-run
  }

  // Determine which backends to pre-fetch based on tier
  const needsZen = tier === 'free' || tier === 'zen' || tier === 'go' || tier === 'both';
  const needsGo = tier === 'go' || tier === 'both';

  const spinner = p.spinner();
  spinner.start('Fetching available models...');

  let zenModels: ModelInfo[] = [];
  let goModels: ModelInfo[] = [];

  try {
    const backends: Array<'zen' | 'go'> = [];
    if (needsZen) backends.push('zen');
    if (needsGo) backends.push('go');
    const fetched = await fetchZenGoModels(backends, !dryRun);
    zenModels = fetched.zenModels;
    goModels = fetched.goModels;
    spinner.stop(`Loaded ${zenModels.length + goModels.length} models`);
  } catch (err) {
    spinner.stop(pc.red('Failed to load models'));
    console.error(pc.red(String(err instanceof Error ? err.message : err)));
    return 1;
  }

  // Run interactive wizard
  const selection = await runWizard(prefs, { zen: zenModels, go: goModels }, conflicts, tier);
  if (!selection) return 0;

  // Persist choices for next run (skipped in dry-run)
  if (!dryRun) savePreferences({ lastBackend: selection.backend.id, lastModel: selection.model.id, lastProvider: 'opencode' });

  // ── Cloud switch-menu path ── when Zen/Go favorites exist, build a catalog proxy
  if (switchMenuActive && hasZenGoFavorites && !dryRun) {
    const resolveRoute = makeRouteResolver(localProviders, earlyZenModels, earlyGoModels, effectiveKey);
    const startingRoute = zenGoModelToRoute(selection.model, effectiveKey);
    if (!startingRoute) {
      p.log.error('Could not resolve a proxy route for the selected model.');
      return 1;
    }
    const catalogRoutes = buildCatalogRoutes(startingRoute, favorites, resolveRoute);
    return launchClaudeViaCatalog(
      catalogRoutes,
      startingRoute,
      selection.model.contextWindow,
      trace,
      claudeArgs,
    );
  }

  // ── Cloud single-model path ──

  // Disable experimental betas only for direct (non-proxy) upstream routes — OpenCode
  // Zen/Go may reject beta headers. Local proxy preserves defer_loading for tool search.
  const disableExperimentalBetas = selection.model.modelFormat !== 'openai';

  if (dryRun) {
    printDryRun(
      selection.backend.name,
      selection.model.id,
      selection.backend.baseUrl,
      selection.model.modelFormat,
      claudeArgs,
      conflicts,
      disableExperimentalBetas,
    );
    return 0;
  }

  // Start translation proxy for models that use OpenAI chat completions format
  let proxyHandle: ProxyHandle | null = null;
  if (selection.model.modelFormat === 'openai') {
    try {
      proxyHandle = await startProxy(
        `${selection.backend.baseUrl}/v1/chat/completions`,
        selection.model.id,
        trace,
        selection.model.contextWindow,
        { npm: '@ai-sdk/openai-compatible', baseURL: `${selection.backend.baseUrl}/v1` },
      );
      p.log.info(
        `Translation proxy started on port ${proxyHandle.port} ` +
        pc.dim(`(${selection.backend.baseUrl}/v1/chat/completions)`),
      );
    } catch (err) {
      p.log.error(`Failed to start translation proxy: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  const childEnv = buildChildEnv(
    selection.backend.baseUrl,
    selection.model.id,
    effectiveKey,
    proxyHandle?.port,
    selection.model.contextWindow,
  );
  if (disableExperimentalBetas) {
    childEnv['CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS'] = '1';
  }

  // --trace: write Claude Code debug logs so we can see the actual API error
  const debugLogPath = join(tmpdir(), 'opencode-starter-debug.log');
  const traceArgs = trace ? ['--debug-file', debugLogPath] : [];
  if (trace) {
    p.log.info(`Debug log: ${debugLogPath}`);
  }

  const exitCode = await launchClaude(childEnv, selection.model.id, [...traceArgs, ...claudeArgs]);

  // Stop translation proxy after Claude exits
  if (proxyHandle) {
    proxyHandle.close();
  }

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
    return runServerCommand();
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
