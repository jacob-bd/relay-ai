// src/providers-command.ts — relay-ai providers command

import pc from 'picocolors';
import * as p from '@clack/prompts';
import { importFromOpencode } from './registry/import-opencode.js';
import { loadRegistry } from './registry/io.js';

export type ProvidersSubcommand = 'hub' | 'import' | 'list' | 'help';

export function parseProvidersArgs(args: string[]): {
  subcommand: ProvidersSubcommand;
  showHelp: boolean;
  error?: string;
} {
  if (args.length === 0) return { subcommand: 'hub', showHelp: false };
  const [first, ...rest] = args;
  if (first === '--help' || first === '-h') return { subcommand: 'help', showHelp: true };
  if (first === 'import') {
    if (rest.length > 0) return { subcommand: 'import', showHelp: false, error: `Unknown import option: ${rest[0]}` };
    return { subcommand: 'import', showHelp: false };
  }
  if (first === 'list') {
    if (rest.length > 0) return { subcommand: 'list', showHelp: false, error: `Unknown list option: ${rest[0]}` };
    return { subcommand: 'list', showHelp: false };
  }
  return { subcommand: 'hub', showHelp: false, error: `Unknown providers subcommand: ${first}` };
}

export function providersHelpText(): string {
  return `${pc.bold('relay-ai providers')} — manage your AI providers

${pc.bold('Usage:')}
  relay-ai providers
  relay-ai providers import
  relay-ai providers list

${pc.bold('Subcommands:')}
  (none)      Provider hub wizard
  import      Bring settings from OpenCode (one-time)
  list        Show configured providers`;
}

function maskKeySuffix(keyRef: string): string {
  return keyRef.startsWith('keyring:') ? 'keychain' : keyRef;
}

export async function runProvidersImport(): Promise<number> {
  const spinner = p.spinner();
  spinner.start('Importing from OpenCode...');
  const result = await importFromOpencode();
  spinner.stop('');

  if (result.error) {
    p.log.error(result.error);
    return 1;
  }

  if (result.imported.length === 0 && result.skipped.length === 0) {
    p.log.warn('No configured providers found in OpenCode.');
    p.log.info('Add providers in OpenCode first, or use relay-ai providers add (coming soon).');
    return 0;
  }

  p.log.success(
    `Imported ${result.imported.length} provider${result.imported.length === 1 ? '' : 's'}, `
    + `${result.imported.reduce((n, pr) => n + (pr.modelsCache?.models.length ?? 0), 0)} models, `
    + `${result.keysSaved} key${result.keysSaved === 1 ? '' : 's'} saved to Keychain.`,
  );

  if (result.skipped.length > 0) {
    for (const s of result.skipped) {
      p.log.warn(`Skipped ${s.name} (${s.id}): ${s.reason}`);
    }
  }
  return 0;
}

export function runProvidersList(): number {
  const registry = loadRegistry();
  if (registry.providers.length === 0) {
    p.log.info('No providers configured. Run relay-ai providers import or add a provider.');
    return 0;
  }

  console.log('');
  for (const provider of registry.providers) {
    const modelCount = provider.modelsCache?.models.length ?? 0;
    const status = provider.enabled ? pc.green('●') : pc.dim('○');
    console.log(
      `  ${status} ${pc.bold(provider.name)} ${pc.dim(`(${provider.id})`)} — `
      + `${modelCount} model${modelCount === 1 ? '' : 's'}, auth: ${maskKeySuffix(provider.authRef)}`,
    );
  }
  console.log('');
  return 0;
}

export async function runProvidersCommand(args: string[]): Promise<number> {
  const parsed = parseProvidersArgs(args);
  if (parsed.error) {
    p.log.error(parsed.error);
    return 1;
  }
  if (parsed.showHelp) {
    console.log(providersHelpText());
    return 0;
  }

  if (parsed.subcommand === 'import') return runProvidersImport();
  if (parsed.subcommand === 'list') return runProvidersList();

  p.intro(pc.bold('  Your AI providers'));
  const choice = await p.select({
    message: 'What would you like to do?',
    options: [
      { value: 'list', label: 'List configured providers' },
      { value: 'import', label: 'Bring settings from OpenCode' },
      { value: 'done', label: 'Done' },
    ],
  });
  if (p.isCancel(choice)) {
    p.cancel('Cancelled.');
    return 0;
  }
  if (choice === 'list') return runProvidersList();
  if (choice === 'import') return runProvidersImport();
  return 0;
}
