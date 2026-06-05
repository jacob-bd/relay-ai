import pc from 'picocolors';
import * as p from '@clack/prompts';
import { resolveApiKey } from '../env.js';
import {
  getCachedModels,
  getSavedServerPassword,
  getSubscriptionTier,
  setCachedModels,
  setSavedServerPassword,
} from '../config.js';
import { getModels } from '../models.js';
import { BACKENDS } from '../constants.js';
import type { ModelInfo } from '../types.js';
import {
  askListenMode,
  askSaveServerPassword,
  askServerPassword,
  askUseSavedServerPassword,
} from './prompts.js';
import { createModelCatalog } from './models.js';
import { startServer } from './router.js';

type SubscriptionTier = 'free' | 'zen' | 'go' | 'both';

function modelsForTier(tier: SubscriptionTier, backendId: 'zen' | 'go', models: ModelInfo[]): ModelInfo[] {
  if (tier === 'free') return backendId === 'zen' ? models.filter(model => model.isFree) : [];
  if (tier === 'go') return backendId === 'zen' ? models.filter(model => model.isFree) : models;
  return models;
}

function waitForShutdown(): Promise<void> {
  return new Promise(resolve => {
    const cleanup = () => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    };
    const onSignal = () => {
      cleanup();
      resolve();
    };

    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  });
}

async function getServerPasswordForMode(mode: 'local' | 'network'): Promise<string | null | undefined> {
  if (mode === 'local') return null;

  const savedPassword = getSavedServerPassword();
  let serverPassword: string | null = null;

  if (savedPassword) {
    const savedChoice = await askUseSavedServerPassword();
    if (!savedChoice) return undefined;
    serverPassword = savedChoice === 'use-saved' ? savedPassword : await askServerPassword();
  } else {
    serverPassword = await askServerPassword();
  }

  if (!serverPassword) return undefined;

  if (serverPassword !== savedPassword) {
    const savePassword = await askSaveServerPassword();
    if (savePassword === null) return undefined;
    if (savePassword) setSavedServerPassword(serverPassword);
  }

  return serverPassword;
}

async function loadServerModels(tier: SubscriptionTier): Promise<ModelInfo[]> {
  const needsZen = tier === 'free' || tier === 'zen' || tier === 'go' || tier === 'both';
  const needsGo = tier === 'go' || tier === 'both';
  const models: ModelInfo[] = [];

  if (needsZen) {
    const result = await getModels(BACKENDS.zen, getCachedModels('zen') ?? undefined);
    if (!result.fromCache) setCachedModels('zen', result.models);
    models.push(...modelsForTier(tier, 'zen', result.models));
  }

  if (needsGo) {
    const result = await getModels(BACKENDS.go, getCachedModels('go') ?? undefined);
    if (!result.fromCache) setCachedModels('go', result.models);
    models.push(...modelsForTier(tier, 'go', result.models));
  }

  return models;
}

export async function runServerCommand(): Promise<number> {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    p.log.error('Missing OPENCODE_API_KEY. Run `opencode-starter claude` once to configure your key, or export OPENCODE_API_KEY.');
    return 1;
  }

  const tier = getSubscriptionTier();
  if (!tier) {
    p.log.error('Missing subscription tier. Run `opencode-starter claude --setup` first.');
    return 1;
  }

  const mode = await askListenMode();
  if (!mode) return 0;

  const serverPassword = await getServerPasswordForMode(mode);
  if (serverPassword === undefined) return 0;

  const host = mode === 'network' ? '0.0.0.0' : '127.0.0.1';
  const spinner = p.spinner();
  spinner.start('Fetching available models...');

  let models: ModelInfo[];
  try {
    models = await loadServerModels(tier);
    spinner.stop(`Loaded ${models.length} models`);
  } catch (err) {
    spinner.stop(pc.red('Failed to load models'));
    console.error(pc.red(String(err instanceof Error ? err.message : err)));
    return 1;
  }

  const server = await startServer({
    host,
    port: 17645,
    apiKey,
    serverPassword,
    catalog: createModelCatalog(models),
    backends: BACKENDS,
  });

  console.log('');
  console.log(pc.bold(pc.green('OpenCode Starter server running')));
  console.log(`  Anthropic:  http://127.0.0.1:${server.port}/anthropic`);
  console.log(`  OpenAI:     http://127.0.0.1:${server.port}/openai`);
  if (mode === 'network') {
    console.log(`  Network:    http://<this-computer-ip>:${server.port}`);
    console.log('  API key:    <server password>');
  } else {
    console.log('  API key:    any non-empty value');
  }
  console.log('');
  console.log(pc.dim('Press Ctrl+C to stop.'));

  await waitForShutdown();
  await server.close();
  return 0;
}
