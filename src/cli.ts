// src/cli.ts
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { appendFileSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { findClaudeBinary, launchClaude } from './launch.js';
import { resolveApiKey, detectConflicts, buildChildEnv, readFromCredentialStore, saveToCredentialStore, isSecretServiceAvailable } from './env.js';
import { getModels } from './models.js';
import { startProxy } from './proxy.js';
import type { ProxyHandle } from './proxy.js';
import { runServerCommand } from './server/index.js';
import type { ModelFormat } from './types.js';
import { loadPreferences, savePreferences, getCachedModels, setCachedModels, getSubscriptionTier, setSubscriptionTier } from './config.js';
import { runWizard, askSubscriptionTier, pickLocalModel } from './prompts.js';
import { fetchLocalProviders } from './providers.js';
import { BACKENDS, VERSION } from './constants.js';
import type { ParsedArgs, ModelInfo } from './types.js';

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
Launch supported coding tools with OpenCode Zen or Go as the API backend.

${pc.bold('Usage:')}
  opencode-starter claude [starter-options] [claude-flags]
  opencode-starter server
  opencode-starter --help
  opencode-starter --version

${pc.bold('Commands:')}
  claude      Launch Claude Code through OpenCode Starter
  server      Run a foreground OpenCode Starter API gateway
  codex       planned

${pc.bold('Migration:')}
  Bare opencode-starter now prints this help instead of launching Claude Code.
  Use opencode-starter claude to run the existing Claude Code wizard and launcher.

${pc.bold('Examples:')}
  opencode-starter claude
  opencode-starter claude -c
  opencode-starter claude --resume abc-123
  opencode-starter claude -- --print "hello"`;
}

export function claudeHelpText(): string {
  return `${pc.bold('opencode-starter claude')} v${VERSION}
Launch Claude Code with OpenCode Zen or Go as the Anthropic API backend.

${pc.bold('Usage:')}
  opencode-starter claude [starter-options] [claude-flags]
  opencode-starter claude --help
  opencode-starter claude --version

${pc.bold('Starter options:')}
  --dry-run    Run the wizard but show a preview instead of launching Claude Code
  --setup      Re-configure your subscription tier
  --trace      Write Claude Code debug logs to /tmp/opencode-starter-debug.log and show errors on exit
  --help       Show this command help
  --version    Show version

${pc.bold('Setup:')}
  Get your API key at https://opencode.ai/auth
  Then run: export OPENCODE_API_KEY="your-key"

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
Run a foreground OpenCode Starter API gateway.

${pc.bold('Usage:')}
  opencode-starter server
  opencode-starter server --help
  opencode-starter server --version

${pc.bold('Behavior:')}
  Prompts for local-only or network listen mode.
  Network mode asks for a server password.
  Server password is saved only if the user chooses to save it.
  Server host and port are not saved.`;
}

function printHelp(text: string): void {
  console.log(`\n${text}\n`);
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
    console.log(`    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1  ${pc.dim('(auto-set: model uses protocol translation)')}`);
  }
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


async function resolveOrCollectApiKey(simulate = false): Promise<string | null> {
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
    const storedKey = await readFromCredentialStore();
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
      execSync(`setx OPENCODE_API_KEY "${trimmedKey}"`, { stdio: ['pipe', 'pipe', 'pipe'] });
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
      appendFileSync(path, `\nexport OPENCODE_API_KEY="${trimmedKey}"\n`);
      p.log.success(`Key saved to ${display} — active now and in all future terminals.`);
    } catch {
      p.log.warn(`Could not write to ${display} — key will be used for this session only`);
    }
  }

  if (!simulate) process.env['OPENCODE_API_KEY'] = trimmedKey;
  return trimmedKey;
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

  // Load prefs and conflicts early (before any prompts)
  const prefs = dryRun ? {} as ReturnType<typeof loadPreferences> : loadPreferences();
  const conflicts = detectConflicts();

  // Show intro once at the top
  p.intro(pc.bold('  OpenCode Starter'));

  // Fetch local providers (opencode must be installed locally)
  const localProviders = await fetchLocalProviders();

  if (localProviders === null) {
    // opencode not installed — tip shown, proceed to cloud flow
    p.log.info(pc.dim('Tip: Install OpenCode locally to unlock additional providers'));
  }

  // Provider selector — shown when opencode is installed and has providers
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

    const selectedModel = await pickLocalModel(provider, conflicts, prefs);
    if (!selectedModel) return 0;

    if (!dryRun) {
      savePreferences({ lastProvider: provider.id, lastModel: selectedModel.id });
    }

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
      childEnv = buildChildEnv(selectedModel.baseUrl!, selectedModel.id, provider.apiKey);
    } else {
      // openai format — start translation proxy
      try {
        proxyHandle = await startProxy(selectedModel.completionsUrl!, selectedModel.id, trace);
        p.log.info(
          `Translation proxy started on port ${proxyHandle.port} ` +
          pc.dim(`(${selectedModel.completionsUrl})`),
        );
      } catch (err) {
        p.log.error(`Failed to start translation proxy: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
      }
      childEnv = buildChildEnv(`http://127.0.0.1:${proxyHandle.port}`, selectedModel.id, provider.apiKey, proxyHandle.port);
    }

    childEnv['CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS'] = '1';

    const debugLogPath = join(tmpdir(), 'opencode-starter-debug.log');
    const traceArgs = trace ? ['--debug-file', debugLogPath] : [];
    if (trace) {
      p.log.info(`Debug log: ${debugLogPath}`);
    }

    const exitCode = await launchClaude(childEnv, selectedModel.id, [...traceArgs, ...claudeArgs]);
    proxyHandle?.close();

    if (trace && existsSync(debugLogPath)) {
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

    return exitCode;
  }

  // ── OpenCode cloud branch ──

  // In dry-run: simulate a fresh first-run by ignoring all saved state.
  const apiKey = await resolveOrCollectApiKey(dryRun);
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
    if (needsZen) {
      const cachedZen = getCachedModels('zen') ?? undefined;
      const result = await getModels(BACKENDS.zen, cachedZen);
      zenModels = result.models;
      if (!result.fromCache && !dryRun) setCachedModels('zen', zenModels);
    }
    if (needsGo) {
      const cachedGo = getCachedModels('go') ?? undefined;
      const result = await getModels(BACKENDS.go, cachedGo);
      goModels = result.models;
      if (!result.fromCache && !dryRun) setCachedModels('go', goModels);
    }
    const total = zenModels.length + goModels.length;
    spinner.stop(`Loaded ${total} models`);
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

  // Always disable experimental betas — OpenCode Zen/Go is a proxy and may not
  // support all Anthropic-specific beta headers even for Anthropic-native models.
  const disableExperimentalBetas = true;

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
      proxyHandle = await startProxy(`${selection.backend.baseUrl}/v1/chat/completions`, selection.model.id, trace);
      p.log.info(
        `Translation proxy started on port ${proxyHandle.port} ` +
        pc.dim(`(${selection.backend.baseUrl}/v1/chat/completions)`),
      );
    } catch (err) {
      p.log.error(`Failed to start translation proxy: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  const childEnv = buildChildEnv(selection.backend.baseUrl, selection.model.id, effectiveKey, proxyHandle?.port);
  childEnv['CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS'] = '1';

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

  if (trace && existsSync(debugLogPath)) {
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
