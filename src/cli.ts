// src/cli.ts
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { findClaudeBinary, launchClaude } from './launch.js';
import { resolveApiKey, detectConflicts, buildChildEnv } from './env.js';
import { getModels } from './models.js';
import { loadPreferences, savePreferences, getCachedModels, setCachedModels } from './config.js';
import { runWizard } from './prompts.js';
import { BACKENDS, VERSION } from './constants.js';
import type { ParsedArgs } from './types.js';

function parseArgs(args: string[]): ParsedArgs {
  if (args.includes('--help') || args.includes('-h')) {
    return { showHelp: true, showVersion: false, dryRun: false, claudeArgs: [] };
  }
  if (args.includes('--version') || args.includes('-v')) {
    return { showVersion: true, showHelp: false, dryRun: false, claudeArgs: [] };
  }
  const dryRun = args.includes('--dry-run');
  const filteredArgs = args.filter(a => a !== '--dry-run');
  const sep = filteredArgs.indexOf('--');
  return {
    showHelp: false,
    showVersion: false,
    dryRun,
    claudeArgs: sep >= 0 ? filteredArgs.slice(sep + 1) : [],
  };
}

function printHelp(): void {
  console.log(`
${pc.bold('opencode-starter')} v${VERSION}
Launch Claude Code with OpenCode Zen or Go as the Anthropic API backend.

${pc.bold('Usage:')}
  opencode-starter [--dry-run] [-- <claude-flags>]
  opencode-starter --help
  opencode-starter --version

${pc.bold('Flags:')}
  --dry-run    Run the wizard but show a preview instead of launching Claude Code

${pc.bold('Setup:')}
  Get your API key at https://opencode.ai/settings/keys
  Then run: export OPENCODE_API_KEY="your-key"

${pc.bold('Examples:')}
  opencode-starter
  opencode-starter --dry-run
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

async function main(): Promise<void> {
  const { showHelp, showVersion, dryRun, claudeArgs } = parseArgs(process.argv.slice(2));

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

  // Prerequisite: API key
  const apiKey = resolveApiKey();
  if (!apiKey) {
    const shell = process.env['SHELL'] ?? '';
    const profile = shell.includes('zsh') ? '~/.zshrc' : '~/.bashrc';
    console.error(pc.red('\nError: OPENCODE_API_KEY is not set.\n'));
    console.error('Get your key at: https://opencode.ai/settings/keys\n');
    console.error('Then add it to your shell profile:');
    console.error(`  echo 'export OPENCODE_API_KEY="your-key"' >> ${profile}`);
    console.error(`  source ${profile}\n`);
    process.exit(1);
  }

  const prefs = loadPreferences();
  const conflicts = detectConflicts();
  const backendId = prefs.lastBackend ?? 'zen';
  const backend = BACKENDS[backendId];
  const cachedModels = getCachedModels(backendId) ?? undefined;

  // Fetch models with spinner
  const spinner = p.spinner();
  spinner.start('Fetching available models...');
  let models;
  try {
    const result = await getModels(backend, cachedModels);
    models = result.models;
    if (result.fromCache) {
      spinner.stop(pc.yellow('Loaded models from cache (network unavailable)'));
    } else {
      spinner.stop(`Loaded ${models.length} models`);
      setCachedModels(backendId, models);
    }
  } catch (err) {
    spinner.stop(pc.red('Failed to load models'));
    console.error(pc.red(String(err instanceof Error ? err.message : err)));
    process.exit(1);
  }

  // Run interactive wizard
  const selection = await runWizard(prefs, models, conflicts);
  if (!selection) process.exit(0);

  // Persist choices for next run
  savePreferences({ lastBackend: selection.backend.id, lastModel: selection.model.id });

  // For non-Anthropic-native models, disable experimental beta headers
  // that the translation layer may not support.
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

  // Build isolated child environment and launch
  const childEnv = buildChildEnv(selection.backend, selection.model.id, apiKey);
  if (disableExperimentalBetas) {
    childEnv['CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS'] = '1';
  }
  const exitCode = await launchClaude(childEnv, selection.model.id, claudeArgs);
  process.exit(exitCode);
}

main().catch((err: unknown) => {
  if (typeof err === 'object' && err !== null && Symbol.iterator in Object(err)) {
    process.exit(0);
  }
  console.error(pc.red('\nUnexpected error:'), err);
  process.exit(1);
});
