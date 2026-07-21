// src/first-run.ts — inline first-run setup for relay-ai claude (never dead-end)

import pc from 'picocolors';
import * as p from '@clack/prompts';
import { printWelcomePanel } from './ui.js';
import {
  migrateGlobalOpencodeCredential,
  readGlobalOpencodeCredential,
} from './env.js';
import { findOpencodeBinary } from './opencode-serve.js';
import { zenRegistryStub } from './registry/builtins.js';
import { importFromOpencode } from './registry/import-opencode.js';
import { loadRegistry, saveRegistry } from './registry/io.js';
import { resolveOrCollectApiKey } from './key-setup.js';

export type FirstRunResult = 'continue' | 'cancel';

/** True when the user has no registry entries and no Zen/Go API key configured. */
export async function needsFirstRunSetup(): Promise<boolean> {
  const registry = loadRegistry();
  if (registry.providers.length > 0) return false;
  const key = await readGlobalOpencodeCredential();
  return !key;
}

function ensureZenRegistryStub(): void {
  const registry = loadRegistry();
  if (registry.providers.some(pr => pr.id === 'zen')) return;
  registry.providers.push(zenRegistryStub('free'));
  saveRegistry(registry);
}

/** Inline welcome wizard — every path should end with continue (launch) or explicit cancel. */
export async function runFirstRunWizard(trace = false): Promise<FirstRunResult> {
  printWelcomePanel();

  const hasOpencode = findOpencodeBinary() !== null;
  const options: Array<{ value: string; label: string; hint: string }> = [
    {
      value: 'zen',
      label: pc.cyan('Quick start with OpenCode Zen (free)'),
      hint: 'Enter your API key and pick a model — launches Claude Code',
    },
    {
      value: 'providers',
      label: pc.cyan('Set up your own AI provider'),
      hint: 'Add Groq, Mistral, OpenAI, … with relay-ai providers',
    },
  ];
  if (hasOpencode) {
    options.push({
      value: 'import',
      label: pc.cyan('Import from OpenCode CLI'),
      hint: 'Optional one-time import of providers you already configured',
    });
  }

  const choice = await p.select({
    message: 'How do you want to get started?',
    options,
  });
  if (p.isCancel(choice)) {
    p.cancel('Cancelled.');
    return 'cancel';
  }

  if (choice === 'zen') {
    const apiKey = await resolveOrCollectApiKey(false, trace);
    if (!apiKey) return 'cancel';
    await migrateGlobalOpencodeCredential();
    ensureZenRegistryStub();
    p.log.success('OpenCode Zen ready — picking a model next.');
    return 'continue';
  }

  if (choice === 'providers') {
    p.log.info(`Add providers with ${pc.cyan('relay-ai providers add')}, then run ${pc.cyan('relay-ai claude')} again.`);
    if (hasOpencode) {
      p.log.info(`Optional: ${pc.cyan('relay-ai providers import')} to pull an existing OpenCode CLI config.`);
    }
    return 'cancel';
  }

  if (choice === 'import') {
    if (!hasOpencode) {
      p.log.error('OpenCode CLI not found. Install from https://opencode.ai — or use Quick start / providers add instead.');
      return runFirstRunWizard(trace);
    }

    const spinner = p.spinner();
    spinner.start('Importing from OpenCode CLI...');
    const result = await importFromOpencode();
    spinner.stop('');

    if (result.error) {
      p.log.error(result.error);
      return runFirstRunWizard(trace);
    }
    if (result.imported.length === 0) {
      p.log.warn('No providers imported. Add providers with relay-ai providers add, or Quick start with Zen.');
      return runFirstRunWizard(trace);
    }

    p.log.success(
      `Imported ${result.imported.length} provider${result.imported.length === 1 ? '' : 's'}.`,
    );
    return 'continue';
  }

  return 'continue';
}
