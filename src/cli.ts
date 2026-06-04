// src/cli.ts
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { findClaudeBinary, launchClaude } from './launch.js';
import { resolveApiKey, detectConflicts, buildChildEnv } from './env.js';
import { getModels } from './models.js';
import { loadPreferences, savePreferences, getCachedModels, setCachedModels, getSubscriptionTier, setSubscriptionTier } from './config.js';
import { runWizard, askSubscriptionTier } from './prompts.js';
import { BACKENDS, VERSION } from './constants.js';
import type { ParsedArgs, ModelInfo } from './types.js';

function parseArgs(args: string[]): ParsedArgs {
  if (args.includes('--help') || args.includes('-h')) {
    return { showHelp: true, showVersion: false, dryRun: false, setup: false, claudeArgs: [] };
  }
  if (args.includes('--version') || args.includes('-v')) {
    return { showVersion: true, showHelp: false, dryRun: false, setup: false, claudeArgs: [] };
  }
  const dryRun = args.includes('--dry-run');
  const setup = args.includes('--setup');
  const filteredArgs = args.filter(a => a !== '--dry-run' && a !== '--setup');
  const sep = filteredArgs.indexOf('--');
  return {
    showHelp: false,
    showVersion: false,
    dryRun,
    setup,
    claudeArgs: sep >= 0 ? filteredArgs.slice(sep + 1) : [],
  };
}

function printHelp(): void {
  console.log(`
${pc.bold('opencode-starter')} v${VERSION}
Launch Claude Code with OpenCode Zen or Go as the Anthropic API backend.

${pc.bold('Usage:')}
  opencode-starter [--dry-run] [--setup] [-- <claude-flags>]
  opencode-starter --help
  opencode-starter --version

${pc.bold('Flags:')}
  --dry-run    Run the wizard but show a preview instead of launching Claude Code
  --setup      Re-configure your subscription tier

${pc.bold('Setup:')}
  Get your API key at https://opencode.ai/settings/keys
  Then run: export OPENCODE_API_KEY="your-key"

${pc.bold('Examples:')}
  opencode-starter
  opencode-starter --dry-run
  opencode-starter --setup
  opencode-starter -- --print "hello"
  opencode-starter -- --dangerously-skip-permissions
`);
}

function printDryRun(
  backendName: string,
  modelId: string,
  baseUrl: string,
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
  console.log('');

  console.log(`  ${pc.bold('Env vars SET:')}`);
  console.log(`    ANTHROPIC_BASE_URL=${baseUrl}`);
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
  if (shell.includes('zsh')) return { display: '~/.zshrc', path: `${homedir()}/.zshrc` };
  if (shell.includes('bash')) {
    const profile = process.platform === 'darwin' ? '.bash_profile' : '.bashrc';
    return { display: `~/${profile}`, path: `${homedir()}/${profile}` };
  }
  return { display: '~/.profile', path: `${homedir()}/.profile` };
}

function readFromKeychain(): string | null {
  try {
    const result = execSync(
      'security find-generic-password -s opencode-starter -a opencode-starter -w',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return result.trim() || null;
  } catch {
    return null;
  }
}

function saveToKeychain(key: string): boolean {
  try {
    // -U: update if already exists
    execSync(
      `security add-generic-password -s opencode-starter -a opencode-starter -w ${JSON.stringify(key)} -U`,
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return true;
  } catch {
    return false;
  }
}

async function resolveOrCollectApiKey(): Promise<string | null> {
  // Step 1: already in environment
  const existing = resolveApiKey();
  if (existing) return existing;

  const isMac = process.platform === 'darwin';

  // Step 2: on macOS, offer to check Keychain before asking for a paste
  if (isMac) {
    const checkKeychain = await p.confirm({
      message: 'OPENCODE_API_KEY not found. Check macOS Keychain for a stored key?',
      initialValue: true,
    });

    if (p.isCancel(checkKeychain)) { p.cancel('Cancelled.'); return null; }

    if (checkKeychain) {
      const keychainKey = readFromKeychain();
      if (keychainKey) {
        p.log.success('Found key in macOS Keychain');
        process.env['OPENCODE_API_KEY'] = keychainKey;
        return keychainKey;
      }
      p.log.info('No key found in Keychain — let\'s set one up');
    }
  }

  // Step 3: prompt for the key (masked — shows asterisks, not the actual key)
  p.note('Get your free key at: https://opencode.ai/settings/keys', 'OpenCode API key');

  const key = await p.password({
    message: 'Paste your OPENCODE_API_KEY:',
    validate: (val) => val.trim() ? undefined : 'Key cannot be empty',
  });

  if (p.isCancel(key)) { p.cancel('Cancelled.'); return null; }

  const trimmedKey = (key as string).trim();
  const { display, path } = detectShellProfile();

  // Step 4: where to save it
  type SaveChoice = 'keychain' | 'profile' | 'session';

  const saveOptions: Array<{ value: SaveChoice; label: string; hint: string }> = isMac
    ? [
        { value: 'keychain', label: 'macOS Keychain', hint: `Encrypted — also adds auto-load line to ${display}` },
        { value: 'profile',  label: display,           hint: 'Plaintext in your shell profile' },
        { value: 'session',  label: 'This session only', hint: "Not saved — you'll be asked again next time" },
      ]
    : [
        { value: 'profile',  label: display,           hint: 'Saved to your shell profile' },
        { value: 'session',  label: 'This session only', hint: "Not saved — you'll be asked again next time" },
      ];

  const saveChoice = await p.select<SaveChoice>({
    message: 'Where should we save the key?',
    options: saveOptions,
    initialValue: isMac ? 'keychain' : 'profile',
  });

  if (p.isCancel(saveChoice)) { p.cancel('Cancelled.'); return null; }

  if (saveChoice === 'keychain') {
    if (saveToKeychain(trimmedKey)) {
      // Also wire up auto-load from Keychain in the shell profile so future
      // sessions find the key in $OPENCODE_API_KEY automatically (step 1).
      try {
        appendFileSync(
          path,
          `\n# opencode-starter: load API key from macOS Keychain\n` +
          `export OPENCODE_API_KEY="$(security find-generic-password -s opencode-starter -a opencode-starter -w 2>/dev/null)"\n`,
        );
        p.log.success(`Key saved to Keychain + auto-load added to ${display}`);
        p.log.info(`Open a new terminal (or run \`source ${display}\`) to activate`);
      } catch {
        p.log.success('Key saved to Keychain');
        p.log.warn(`Could not write auto-load line to ${display} — run \`source ${display}\` manually`);
      }
    } else {
      p.log.warn('Could not write to Keychain — key will be used for this session only');
    }
  } else if (saveChoice === 'profile') {
    try {
      appendFileSync(path, `\nexport OPENCODE_API_KEY="${trimmedKey}"\n`);
      p.log.success(`Saved to ${display} — open a new terminal to pick it up automatically`);
    } catch {
      p.log.warn(`Could not write to ${display} — key will be used for this session only`);
    }
  }
  // 'session' — no persistence, just use for this run

  process.env['OPENCODE_API_KEY'] = trimmedKey;
  return trimmedKey;
}

async function main(): Promise<void> {
  const { showHelp, showVersion, dryRun, setup, claudeArgs } = parseArgs(process.argv.slice(2));

  if (showHelp) { printHelp(); return; }
  if (showVersion) { console.log(VERSION); return; }

  // Prerequisite: claude binary
  const claudePath = findClaudeBinary();
  if (!claudePath) {
    console.error(pc.red('\nError: claude binary not found on PATH.\n'));
    console.error('Install Claude Code:');
    console.error('  npm install -g @anthropic-ai/claude-code\n');
    process.exit(1);
  }

  // Prerequisite: API key — prompt interactively if not set
  const apiKey = await resolveOrCollectApiKey();
  if (!apiKey) process.exit(0);

  const prefs = loadPreferences();
  const conflicts = detectConflicts();

  // Subscription tier: ask once, save to prefs. Re-ask if --setup.
  let tier = getSubscriptionTier();
  if (!tier || setup) {
    tier = await askSubscriptionTier();
    if (!tier) process.exit(0);
    setSubscriptionTier(tier);
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
      if (!result.fromCache) setCachedModels('zen', zenModels);
    }
    if (needsGo) {
      const cachedGo = getCachedModels('go') ?? undefined;
      const result = await getModels(BACKENDS.go, cachedGo);
      goModels = result.models;
      if (!result.fromCache) setCachedModels('go', goModels);
    }
    const total = zenModels.length + goModels.length;
    spinner.stop(`Loaded ${total} models`);
  } catch (err) {
    spinner.stop(pc.red('Failed to load models'));
    console.error(pc.red(String(err instanceof Error ? err.message : err)));
    process.exit(1);
  }

  // Run interactive wizard
  const selection = await runWizard(prefs, { zen: zenModels, go: goModels }, conflicts, tier);
  if (!selection) process.exit(0);

  // Persist choices for next run
  savePreferences({ lastBackend: selection.backend.id, lastModel: selection.model.id });

  const disableExperimentalBetas = !selection.model.isAnthropicNative;

  if (dryRun) {
    printDryRun(
      selection.backend.name,
      selection.model.id,
      selection.backend.baseUrl,
      claudeArgs,
      conflicts,
      disableExperimentalBetas,
    );
    return;
  }

  const childEnv = buildChildEnv(selection.backend, selection.model.id, apiKey);
  if (disableExperimentalBetas) {
    childEnv['CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS'] = '1';
  }
  const exitCode = await launchClaude(childEnv, selection.model.id, claudeArgs);
  process.exit(exitCode);
}

main().catch((err: unknown) => {
  if (err === Symbol.for('clack:cancel')) {
    process.exit(0);
  }
  console.error(pc.red('\nUnexpected error:'), err);
  process.exit(1);
});
