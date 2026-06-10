// src/providers-command.ts — relay-ai providers command

import pc from 'picocolors';
import * as p from '@clack/prompts';
import { migrateGlobalOpencodeCredential, readGlobalOpencodeCredential, resolveProviderCredential } from './env.js';
import {
  resolveProvidersForDisplay,
  resolveZenGoAvailability,
} from './provider-catalog.js';
import { findOpencodeBinary } from './opencode-serve.js';
import {
  filterTemplates,
  listAddableTemplates,
  type ProviderTemplate,
} from './provider-templates.js';
import { addProviderFromTemplate } from './registry/add-template.js';
import { addCustomEndpointProvider } from './registry/custom-endpoint.js';
import { importFromOpencode, type ImportConflictChoice, type ImportConflictContext } from './registry/import-opencode.js';
import {
  addGoRegistryStub,
  addZenRegistryStub,
  removeProviderFromRegistry,
  toggleProviderEnabled,
} from './registry/crud.js';
import { loadRegistry } from './registry/io.js';
import { refreshAllProviderModels, refreshProviderModels } from './registry/refresh-models.js';
import { resolveRefreshCredential } from './registry/refresh-credentials.js';
import { resolveOrCollectApiKey } from './key-setup.js';

export type ProvidersSubcommand = 'hub' | 'add' | 'import' | 'list' | 'remove' | 'refresh-models' | 'help';

export function parseProvidersArgs(args: string[]): {
  subcommand: ProvidersSubcommand;
  showHelp: boolean;
  removeId?: string;
  error?: string;
} {
  if (args.length === 0) return { subcommand: 'hub', showHelp: false };
  const [first, ...rest] = args;
  if (first === '--help' || first === '-h') return { subcommand: 'help', showHelp: true };
  if (first === 'add') {
    if (rest.length > 0) return { subcommand: 'add', showHelp: false, error: `Unknown add option: ${rest[0]}` };
    return { subcommand: 'add', showHelp: false };
  }
  if (first === 'import') {
    if (rest.length > 0) return { subcommand: 'import', showHelp: false, error: `Unknown import option: ${rest[0]}` };
    return { subcommand: 'import', showHelp: false };
  }
  if (first === 'list') {
    if (rest.length > 0) return { subcommand: 'list', showHelp: false, error: `Unknown list option: ${rest[0]}` };
    return { subcommand: 'list', showHelp: false };
  }
  if (first === 'remove') {
    if (rest.length === 0) return { subcommand: 'remove', showHelp: false, error: 'Usage: relay-ai providers remove <id>' };
    if (rest.length > 1) return { subcommand: 'remove', showHelp: false, error: `Unknown remove option: ${rest[1]}` };
    return { subcommand: 'remove', showHelp: false, removeId: rest[0] };
  }
  if (first === 'refresh-models') {
    if (rest.length === 0) return { subcommand: 'refresh-models', showHelp: false };
    if (rest.length > 1) return { subcommand: 'refresh-models', showHelp: false, error: `Unknown refresh-models option: ${rest[1]}` };
    return { subcommand: 'refresh-models', showHelp: false, removeId: rest[0] };
  }
  return { subcommand: 'hub', showHelp: false, error: `Unknown providers subcommand: ${first}` };
}

export function providersHelpText(): string {
  return `${pc.bold('relay-ai providers')} — manage your AI providers

${pc.bold('Usage:')}
  relay-ai providers
  relay-ai providers add
  relay-ai providers import
  relay-ai providers list
  relay-ai providers remove <id>
  relay-ai providers refresh-models [id]

${pc.bold('Subcommands:')}
  (none)      Provider hub wizard ${pc.dim('[Phase 1.1]')}
  add         Add a provider (Groq, Mistral, Together AI, …) ${pc.dim('[Phase 1.1]')}
  import      Bring settings from OpenCode (one-time) ${pc.dim('[Phase 1.0]')}
  list        Show configured providers ${pc.dim('[Phase 1.0]')}
  remove      Remove a provider by id ${pc.dim('[Phase 1.1]')}
  refresh-models  Update cached model lists ${pc.dim('[Phase 1.2]')}

${pc.dim('Coming soon: auth (OAuth)')}`;
}

function maskAuthRef(authRef: string): string {
  if (authRef.startsWith('keyring:global:opencode')) return 'keychain (shared Zen/Go key)';
  if (authRef.startsWith('keyring:')) return 'keychain';
  if (authRef.startsWith('env:')) return authRef;
  return authRef;
}

function providerLabel(name: string, modelCount: number, enabled: boolean): string {
  const star = enabled ? '★' : '○';
  return `${star} ${name} (${modelCount} model${modelCount === 1 ? '' : 's'})`;
}

export async function runProvidersImport(): Promise<number> {
  const registry = loadRegistry();
  const hasExisting = registry.providers.length > 0;

  const resolveConflict = hasExisting
    ? async (ctx: ImportConflictContext): Promise<ImportConflictChoice> => {
        p.note(
          `Existing: ${ctx.existingKeyHint}\nImported: ${ctx.incomingKeyHint}`,
          `Provider "${ctx.existing.name}" already configured`,
        );
        const choice = await p.select({
          message: 'Which configuration should we keep?',
          options: [
            { value: 'keep', label: 'Keep mine', hint: 'Leave your current relay-ai config unchanged' },
            { value: 'import', label: 'Use imported', hint: 'Replace with OpenCode settings and refresh models' },
            { value: 'skip', label: 'Skip this provider', hint: '' },
          ],
        });
        if (p.isCancel(choice)) return 'skip' as ImportConflictChoice;
        return choice as ImportConflictChoice;
      }
    : undefined;

  const spinner = p.spinner();
  spinner.start('Importing from OpenCode...');
  const result = await importFromOpencode({ resolveConflict });
  spinner.stop('');

  if (result.error) {
    p.log.error(result.error);
    return 1;
  }

  if (result.imported.length === 0 && result.skipped.length === 0) {
    p.log.warn('No configured providers found in OpenCode.');
    p.log.info('Add providers in OpenCode first, or use relay-ai providers add.');
    return 0;
  }

  p.log.success(
    `Imported ${result.imported.length} provider${result.imported.length === 1 ? '' : 's'}, `
    + `${result.imported.reduce((n, pr) => n + (pr.modelsCache?.models.length ?? 0), 0)} models, `
    + `${result.keysSaved} key${result.keysSaved === 1 ? '' : 's'} saved to Keychain.`,
  );

  if (result.keysSkipped.length > 0) {
    for (const k of result.keysSkipped) {
      const label =
        k.reason === 'placeholder-key' ? 'placeholder key not saved'
        : k.reason === 'untested-manual' ? 'key not saved (non-API auth)'
        : 'API key not saved (failed verification)';
      p.log.warn(`${k.name} (${k.id}): ${label}${k.detail ? ` — ${k.detail}` : ''}`);
    }
  }

  if (result.skipped.length > 0) {
    for (const s of result.skipped) {
      const reason =
        s.reason === 'user-skipped' ? 'skipped by you'
        : s.reason === 'conflict-kept' ? 'kept your existing config'
        : s.reason;
      p.log.warn(`Skipped ${s.name} (${s.id}): ${reason}`);
    }
  }
  return 0;
}

export async function runProvidersRefreshModels(providerId?: string): Promise<number> {
  const resolveKey = async (provider: import('./registry/types.js').RegistryProvider) =>
    resolveProviderCredential(provider.id, provider.authRef);

  if (providerId) {
    const registry = loadRegistry();
    const provider = registry.providers.find(p => p.id === providerId);
    if (!provider) {
      p.log.error(`Provider not found: ${providerId}`);
      return 1;
    }
    const spinner = p.spinner();
    spinner.start(`Refreshing ${provider.name}...`);
    const key = await resolveRefreshCredential(provider, async p =>
      resolveProviderCredential(p.id, p.authRef),
    );
    const result = await refreshProviderModels(providerId, key);
    spinner.stop('');
    if (result.skipped) {
      const countNote = result.modelCount ? ` (${result.modelCount} cached models kept)` : '';
      p.log.warn(`${result.name}: ${result.reason}${countNote}`);
      return 0;
    }
    if (!result.ok) {
      p.log.error(`${result.name}: ${result.reason ?? 'Refresh failed.'}`);
      return 1;
    }
    p.log.success(`${result.name}: ${result.modelCount} model${result.modelCount === 1 ? '' : 's'} updated.`);
    return 0;
  }

  const spinner = p.spinner();
  spinner.start('Refreshing model lists...');
  const { refreshed } = await refreshAllProviderModels(resolveKey);
  spinner.stop('');

  const ok = refreshed.filter(r => r.ok && !r.skipped);
  const skipped = refreshed.filter(r => r.skipped);
  const failed = refreshed.filter(r => !r.ok);

  if (ok.length > 0) {
    p.log.success(`Updated ${ok.length} provider${ok.length === 1 ? '' : 's'}.`);
    for (const r of ok) {
      p.log.info(`  ${r.name}: ${r.modelCount} model${r.modelCount === 1 ? '' : 's'}`);
    }
  }
  for (const r of skipped) {
    const countNote = r.modelCount ? ` (${r.modelCount} cached models kept)` : '';
    p.log.warn(`Skipped ${r.name}: ${r.reason}${countNote}`);
  }
  for (const r of failed) {
    p.log.error(`${r.name}: ${r.reason ?? 'Refresh failed.'}`);
  }
  return failed.length > 0 ? 1 : 0;
}

export async function runProvidersList(): Promise<number> {
  const entries = await resolveProvidersForDisplay();
  if (entries.length === 0) {
    p.log.info('No providers configured. Run relay-ai providers add or import.');
    return 0;
  }

  console.log('');
  for (const entry of entries) {
    const status = entry.enabled ? pc.green('●') : pc.dim('○');
    const cloudNote = entry.cloudBuiltin ? pc.dim(' · cloud builtin') : '';
    console.log(
      `  ${status} ${pc.bold(entry.name)} ${pc.dim(`(${entry.id})`)} — `
      + `${entry.modelCount} model${entry.modelCount === 1 ? '' : 's'}, auth: ${entry.authLabel}${cloudNote}`,
    );
  }
  console.log('');
  return 0;
}

async function addBuiltinZen(): Promise<number> {
  const key = await readGlobalOpencodeCredential();
  if (!key) {
    const collected = await resolveOrCollectApiKey();
    if (!collected) return 0;
    await migrateGlobalOpencodeCredential();
  }
  const result = addZenRegistryStub({ subscriptionFilter: 'free' });
  if (!result.added) {
    p.log.warn(result.reason ?? 'Could not add OpenCode Zen.');
    return 0;
  }
  p.log.success('OpenCode Zen added to your providers.');
  return 0;
}

async function pickTemplateFromCatalog(): Promise<ProviderTemplate | null> {
  while (true) {
    const templates = listAddableTemplates(loadRegistry().providers.map(p => p.id));
    if (templates.length === 0) return null;

    const method = await p.select({
      message: `Choose a provider (${templates.length} available)`,
      options: [
        { value: 'search', label: 'Search providers', hint: 'e.g. gro, mistral, together' },
        { value: 'browse', label: 'Browse all providers', hint: 'Scroll the full list' },
        { value: 'back', label: 'Back', hint: '' },
      ],
    });
    if (p.isCancel(method) || method === 'back') return null;

    if (method === 'browse') {
      const options = templates.map(t => ({
        value: t.id,
        label: t.name,
        hint: t.npm,
      }));
      const picked = await p.select({ message: 'Select a provider', options });
      if (p.isCancel(picked)) continue;
      const template = templates.find(t => t.id === picked);
      if (template) return template;
      continue;
    }

    const searchInput = await p.text({
      message: 'Search providers:',
      placeholder: 'e.g. groq, mistral, openrouter',
    });
    if (p.isCancel(searchInput)) continue;

    const matched = filterTemplates(templates, String(searchInput));
    if (matched.length === 0) {
      p.log.warn('No providers match — try a different search');
      continue;
    }

    const options = matched.map(t => ({
      value: t.id,
      label: t.name,
      hint: t.npm,
    }));
    const picked = await p.select({
      message: matched.length === 1 ? 'Match found' : `Select provider (${matched.length} matches)`,
      options,
    });
    if (p.isCancel(picked)) continue;
    const template = matched.find(t => t.id === picked);
    if (template) return template;
  }
}

async function runTemplateAddFlow(): Promise<number> {
  if (listAddableTemplates(loadRegistry().providers.map(p => p.id)).length === 0) {
    p.log.info('All catalog providers are already configured.');
    return 0;
  }

  const template = await pickTemplateFromCatalog();
  if (!template) return 0;

  if (template.signupUrl) {
    p.note(`Get an API key at:\n${template.signupUrl}`, template.name);
  }

  const apiKey = await p.password({
    message: `Paste your ${template.name} API key:`,
    validate: val => val.trim() ? undefined : 'Key cannot be empty',
  });
  if (p.isCancel(apiKey)) {
    p.cancel('Cancelled.');
    return 0;
  }

  const spinner = p.spinner();
  spinner.start(`Testing connection to ${template.name}...`);
  const result = await addProviderFromTemplate(template, String(apiKey));
  spinner.stop('');

  if (!result.added) {
    p.log.error(result.error ?? 'Could not add provider.');
    if (result.hint) p.log.info(result.hint);
    return 1;
  }

  p.log.success(`Connected · ${result.modelCount} model${result.modelCount === 1 ? '' : 's'} — ${template.name} saved.`);
  return 0;
}

async function addBuiltinGo(): Promise<number> {
  const key = await readGlobalOpencodeCredential();
  if (!key) {
    const collected = await resolveOrCollectApiKey();
    if (!collected) return 0;
    await migrateGlobalOpencodeCredential();
  }
  const result = addGoRegistryStub();
  if (!result.added) {
    p.log.warn(result.reason ?? 'Could not add OpenCode Go.');
    return 0;
  }
  p.log.success('OpenCode Go added to your providers.');
  return 0;
}

async function runCustomEndpointAddFlow(): Promise<number> {
  const kindChoice = await p.select({
    message: 'Custom server type',
    options: [
      {
        value: 'openai',
        label: 'Works with most AI services',
        hint: 'OpenAI-compatible API (Together, vLLM, Ollama, …)',
      },
      {
        value: 'anthropic',
        label: 'Claude-style API servers',
        hint: 'Anthropic-compatible /v1/messages passthrough',
      },
      { value: 'back', label: 'Back', hint: '' },
    ],
  });
  if (p.isCancel(kindChoice) || kindChoice === 'back') return 0;

  const displayName = await p.text({
    message: 'Display name:',
    placeholder: 'My Work LLM',
    validate: v => v.trim() ? undefined : 'Name is required',
  });
  if (p.isCancel(displayName)) return 0;

  const baseUrl = await p.text({
    message: 'Base URL:',
    placeholder: kindChoice === 'openai' ? 'https://api.together.xyz/v1' : 'https://api.anthropic.com',
    validate: v => v.trim() ? undefined : 'URL is required',
  });
  if (p.isCancel(baseUrl)) return 0;

  const allowLocal = await p.confirm({
    message: 'Allow local HTTP (Ollama / LM Studio on localhost)?',
    initialValue: String(baseUrl).includes('127.0.0.1') || String(baseUrl).includes('localhost'),
  });
  if (p.isCancel(allowLocal)) return 0;

  const apiKey = await p.password({
    message: 'API key (leave empty for local servers without auth):',
  });
  if (p.isCancel(apiKey)) return 0;

  const spinner = p.spinner();
  spinner.start('Testing connection...');
  const result = await addCustomEndpointProvider({
    displayName: String(displayName).trim(),
    baseUrl: String(baseUrl).trim(),
    apiKey: String(apiKey ?? '').trim(),
    kind: kindChoice as 'openai' | 'anthropic',
    allowInsecureLocal: allowLocal === true,
  });
  spinner.stop('');

  if (!result.added) {
    p.log.error(result.error ?? 'Could not add custom provider.');
    if (result.hint) p.log.info(result.hint);
    return 1;
  }

  p.log.success(`Connected · ${result.modelCount} model${result.modelCount === 1 ? '' : 's'} — ${result.provider?.name} saved.`);
  return 0;
}

export async function runProvidersAdd(): Promise<number> {
  const registry = loadRegistry();
  const zenGo = await resolveZenGoAvailability();
  const hasZen = zenGo.zen;
  const hasGo = zenGo.go;
  const hasOpencode = findOpencodeBinary() !== null;

  const options: Array<{ value: string; label: string; hint: string }> = [
    { value: 'import', label: 'Bring settings from OpenCode', hint: hasOpencode ? 'One-time import' : 'Requires OpenCode CLI' },
  ];
  if (!hasZen) {
    options.push({ value: 'zen', label: 'Add OpenCode Zen (free)', hint: 'Uses your OpenCode API key' });
  }
  if (!hasGo) {
    options.push({ value: 'go', label: 'Add OpenCode Go (paid)', hint: 'Uses your OpenCode API key' });
  }
  const addableTemplates = listAddableTemplates(registry.providers.map(p => p.id));
  if (addableTemplates.length > 0) {
    options.push({
      value: 'templates',
      label: 'Add Groq, Mistral, Together AI, …',
      hint: `${addableTemplates.length} provider${addableTemplates.length === 1 ? '' : 's'} available`,
    });
  }
  options.push({
    value: 'custom',
    label: 'Custom server (Advanced)',
    hint: 'OpenAI-compatible or Claude-style API URL',
  });

  const choice = await p.select({ message: 'Add a provider', options });
  if (p.isCancel(choice)) {
    p.cancel('Cancelled.');
    return 0;
  }

  if (choice === 'import') {
    if (!hasOpencode) {
      p.log.error('OpenCode CLI not found. Install from https://opencode.ai');
      return 1;
    }
    return runProvidersImport();
  }
  if (choice === 'zen') return addBuiltinZen();
  if (choice === 'go') return addBuiltinGo();
  if (choice === 'templates') return runTemplateAddFlow();
  if (choice === 'custom') return runCustomEndpointAddFlow();
  return 0;
}

export async function runProvidersRemove(id: string, interactive = false): Promise<number> {
  const registry = loadRegistry();
  const provider = registry.providers.find(pr => pr.id === id);
  if (!provider) {
    p.log.error(`Provider not found: ${id}`);
    return 1;
  }

  if (interactive) {
    const confirm = await p.confirm({
      message: `Remove ${provider.name} (${id})?`,
      initialValue: false,
    });
    if (p.isCancel(confirm) || !confirm) {
      p.cancel('Cancelled.');
      return 0;
    }
  }

  const result = await removeProviderFromRegistry(id);
  if (!result.removed) {
    p.log.error(result.error ?? `Could not remove ${id}`);
    return 1;
  }

  p.log.success(`Removed ${result.name ?? id}.`);
  if (result.credentialDeleted) {
    p.log.info('Provider API key removed from Keychain.');
  }
  return 0;
}

async function runCloudBuiltinDetail(id: 'zen' | 'go'): Promise<'back'> {
  const name = id === 'zen' ? 'OpenCode Zen' : 'OpenCode Go';
  p.note(
    `${name} is already active via your saved OpenCode API key.\n`
    + 'It does not need to be added separately — relay-ai fetches its models live from OpenCode.',
    'Cloud provider',
  );
  return 'back';
}

async function runProviderDetail(id: string): Promise<'back' | 'removed'> {
  const registry = loadRegistry();
  const provider = registry.providers.find(pr => pr.id === id);
  if (!provider) return 'back';

  const modelCount = provider.modelsCache?.models.length ?? 0;
  p.note(
    `${modelCount} cached model${modelCount === 1 ? '' : 's'} · auth: ${maskAuthRef(provider.authRef)}`,
    provider.name,
  );

  const action = await p.select({
    message: 'What would you like to do?',
    options: [
      {
        value: 'refresh',
        label: 'Refresh model list',
        hint: 'Fetch latest models from the provider API',
      },
      {
        value: 'toggle',
        label: provider.enabled ? 'Disable provider' : 'Enable provider',
        hint: provider.enabled ? 'Hide from relay-ai claude picker' : 'Show in relay-ai claude picker',
      },
      { value: 'remove', label: 'Remove provider', hint: 'Delete from registry and Keychain when safe' },
      { value: 'back', label: 'Back', hint: '' },
    ],
  });
  if (p.isCancel(action) || action === 'back') return 'back';

  if (action === 'refresh') {
    await runProvidersRefreshModels(id);
    return 'back';
  }

  if (action === 'toggle') {
    const result = toggleProviderEnabled(id);
    if (result.toggled) {
      p.log.success(`${provider.name} ${result.enabled ? 'enabled' : 'disabled'}.`);
    }
    return 'back';
  }

  const code = await runProvidersRemove(id, true);
  return code === 0 ? 'removed' : 'back';
}

export async function runProvidersHub(): Promise<number> {
  const hasOpencode = findOpencodeBinary() !== null;

  while (true) {
    const entries = await resolveProvidersForDisplay();
    const options: Array<{ value: string; label: string; hint?: string }> = [];

    for (const entry of entries) {
      const hint = entry.cloudBuiltin ? 'Active via OpenCode API key' : entry.id;
      const value = entry.cloudBuiltin ? `cloud:${entry.id}` : `provider:${entry.id}`;
      options.push({
        value,
        label: providerLabel(entry.name, entry.modelCount, entry.enabled),
        hint,
      });
    }

    options.push({ value: 'add', label: '+ Add a provider', hint: '' });
    if (hasOpencode) {
      options.push({ value: 'import', label: '→ Bring settings from OpenCode', hint: 'One-time import' });
    }
    options.push({ value: 'done', label: 'Done', hint: '' });

    const choice = await p.select({
      message: entries.length > 0 ? 'Your AI providers' : 'Get started',
      options,
    });
    if (p.isCancel(choice) || choice === 'done') {
      return 0;
    }
    if (choice === 'add') {
      await runProvidersAdd();
      continue;
    }
    if (choice === 'import') {
      await runProvidersImport();
      continue;
    }
    if (typeof choice === 'string' && choice.startsWith('cloud:')) {
      const id = choice.slice('cloud:'.length);
      if (id === 'zen' || id === 'go') await runCloudBuiltinDetail(id);
      continue;
    }
    if (typeof choice === 'string' && choice.startsWith('provider:')) {
      const id = choice.slice('provider:'.length);
      const outcome = await runProviderDetail(id);
      if (outcome === 'removed') continue;
    }
  }
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
  if (parsed.subcommand === 'add') return runProvidersAdd();
  if (parsed.subcommand === 'remove' && parsed.removeId) return runProvidersRemove(parsed.removeId);
  if (parsed.subcommand === 'refresh-models') return runProvidersRefreshModels(parsed.removeId);

  p.intro(pc.bold('  Your AI providers'));
  return runProvidersHub();
}
