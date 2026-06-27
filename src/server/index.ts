import pc from 'picocolors';
import { networkInterfaces } from 'node:os';
import * as p from '@clack/prompts';
import { relayIntro } from '../ui.js';
import { resolveApiKey, readFromCredentialStore } from '../env.js';
import { sanitizeCredential } from './auth.js';
import {
  getSavedServerPassword,
  getServerExposedProviders,
  getServerFavoritesOnly,
  getServerMaskGatewayIds,
  loadPreferences,
  setSavedServerPassword,
  setServerExposedProviders,
  setServerFavoritesOnly,
  setServerMaskGatewayIds,
} from '../config.js';
import { BACKENDS, MAX_MODEL_CATALOG } from '../constants.js';
import {
  fetchProviderCatalog,
  localProvidersToServerModels,
  zenGoModelsToServerModels,
  type ProviderCatalog,
} from '../provider-catalog.js';
import { loadRegistry } from '../registry/io.js';
import type { ModelInfo } from '../types.js';
import type { ServerModelInfo, GatewayModelOptions } from './models.js';
import {
  upstreamModelId,
  exposedGatewayAliasId,
  gatewayProviderLabel,
} from './models.js';
import { getReasoningCapabilities } from '../provider-factory.js';
import {
  askFavoritesOnly,
  askListenMode,
  askMaskGatewayIds,
  askSaveServerPassword,
  askServerPassword,
  askServerStartMode,
  askUseSavedServerPassword,
} from './prompts.js';
import { createGatewayModelCatalog } from './models.js';
import { startServer } from './router.js';
import {
  filterServerModelsByFavorites,
  filterServerModelsByProviders,
  summarizeServerProviders,
} from './catalog-filter.js';
import { selectServerProviders, type ServerProviderOption } from './provider-select.js';
import {
  buildVertexRuntimeConfig,
  createVertexModelCatalog,
  hasApplicationDefaultCredentials,
  vertexModelsToServerModels,
} from './vertex-config.js';

export interface ServerRunConfig {
  exposedProviders: string[] | null;
  maskGatewayIds: boolean;
  favoritesOnly: boolean;
}

export interface ServerCommandOptions {
  vertex?: boolean;
}

function getLocalIps(): Array<{ name: string; address: string }> {
  const ifaces = networkInterfaces();
  const result: Array<{ name: string; address: string }> = [];
  for (const [name, iface] of Object.entries(ifaces)) {
    for (const addr of iface ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        result.push({ name, address: addr.address });
      }
    }
  }
  return result;
}

interface ModelCatalogRow {
  name: string;
  anthropicId: string;
  openaiId: string;
}

function compactRows(models: ServerModelInfo[], gateway?: GatewayModelOptions): ModelCatalogRow[] {
  const seen = new Set<string>();
  const rows: ModelCatalogRow[] = [];
  for (const model of [...models].sort((a, b) => a.name.localeCompare(b.name))) {
    const row = {
      name: model.name,
      anthropicId: exposedGatewayAliasId(model, gateway),
      openaiId: model.id,
    };
    const key = `${row.name}\u0000${row.anthropicId}\u0000${row.openaiId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return rows;
}

function cappedWidth(values: string[], label: string, cap: number): number {
  return Math.max(label.length, ...values.map(value => Math.min(value.length, cap)));
}

export function formatModelCatalogLines(models: ServerModelInfo[], gateway?: GatewayModelOptions): string[] {
  if (models.length === 0) return [];

  const groups = new Map<string, ServerModelInfo[]>();
  for (const model of models) {
    const label = gatewayProviderLabel(model);
    let list = groups.get(label);
    if (!list) {
      list = [];
      groups.set(label, list);
    }
    list.push(model);
  }

  const lines: string[] = ['Model catalog:', ''];
  const sortedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [label, groupModels] of sortedGroups) {
    const rows = compactRows(groupModels, gateway);
    const hiddenDuplicates = groupModels.length - rows.length;
    const duplicateNote = hiddenDuplicates > 0 ? `, ${hiddenDuplicates} duplicate${hiddenDuplicates !== 1 ? 's' : ''} hidden` : '';
    const nameWidth = cappedWidth(rows.map(row => row.name), 'Model', 28);
    const anthropicWidth = cappedWidth(rows.map(row => row.anthropicId), 'Anthropic ID', 46);
    const indexWidth = Math.max(String(rows.length).length, 1);

    lines.push(`  ${label} (${rows.length}${duplicateNote})`);
    lines.push(`  ${'#'.padStart(indexWidth)}  ${'Model'.padEnd(nameWidth)}  ${'Anthropic ID'.padEnd(anthropicWidth)}  OpenAI ID`);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      lines.push(`  ${String(i + 1).padStart(indexWidth)}  ${row.name.padEnd(nameWidth)}  ${row.anthropicId.padEnd(anthropicWidth)}  ${row.openaiId}`);
    }
    lines.push('');
  }
  return lines;
}

function printModelCatalog(models: ServerModelInfo[], gateway?: GatewayModelOptions): void {
  if (models.length === 0) return;

  for (const line of formatModelCatalogLines(models, gateway)) {
    if (line === 'Model catalog:') {
      console.log(pc.bold(line));
    } else if (/^  [^#\d\s].+\(\d+/.test(line)) {
      console.log(pc.bold(line));
    } else if (/^  \s*#\s+Model\s+Anthropic ID\s+OpenAI ID/.test(line)) {
      console.log(pc.dim(line));
    } else {
      console.log(line);
    }
  }
}

function filterZenModelsForServer(models: ModelInfo[]): ModelInfo[] {
  const zenProvider = loadRegistry().providers.find(entry => entry.id === 'zen' && entry.enabled);
  if (zenProvider?.subscriptionFilter === 'free') {
    return models.filter(model => model.isFree);
  }
  return models;
}

function usableGoModels(models: ModelInfo[]): ModelInfo[] {
  return models.filter(model => model.modelFormat !== 'unsupported');
}

function providerOptionsFromCatalog(catalog: ProviderCatalog): ServerProviderOption[] {
  const options: ServerProviderOption[] = [];
  const zenModels = filterZenModelsForServer(catalog.zenModels);
  if (zenModels.length > 0) {
    options.push({
      id: 'zen',
      name: 'OpenCode Zen',
      modelCount: zenModels.length,
    });
  }
  const goModels = usableGoModels(catalog.goModels);
  if (goModels.length > 0) {
    options.push({
      id: 'go',
      name: 'OpenCode Go',
      modelCount: goModels.length,
    });
  }
  for (const provider of catalog.localProviders) {
    options.push({
      id: provider.id,
      name: provider.name,
      modelCount: provider.models.length,
    });
  }
  return options;
}

export async function loadServerModels(): Promise<ServerModelInfo[]> {
  const catalog = await fetchProviderCatalog({ agent: 'server' });
  const models: ServerModelInfo[] = [];

  const zenModels = filterZenModelsForServer(catalog.zenModels);
  if (zenModels.length > 0) {
    models.push(...zenGoModelsToServerModels(zenModels));
  }

  const goModels = usableGoModels(catalog.goModels);
  if (goModels.length > 0) {
    models.push(...zenGoModelsToServerModels(goModels));
  }

  if (catalog.localProviders.length > 0) {
    models.push(...localProvidersToServerModels(catalog.localProviders));
  }

  return models.map(enrichServerModelReasoning);
}

export function enrichServerModelReasoning(model: ServerModelInfo): ServerModelInfo {
  if (!model.npm || model.modelFormat !== 'openai') return model;
  const caps = getReasoningCapabilities(model.npm, upstreamModelId(model), {
    providerId: model.providerId,
    apiBaseUrl: model.apiBaseUrl,
    supportedParameters: model.supportedParameters,
    reasoning: model.reasoning,
    interleavedReasoningField: model.interleavedReasoningField,
  });
  if (!caps.defaultLevel) return model;
  return { ...model, defaultEffort: caps.defaultLevel };
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

async function getServerPasswordForMode(
  mode: 'local' | 'network',
): Promise<{ password: string | null; wasSaved: boolean } | undefined> {
  if (mode === 'local') return { password: null, wasSaved: false };

  const savedPassword = await getSavedServerPassword();
  let serverPassword: string | null = null;
  let wasSaved = false;

  if (savedPassword) {
    const savedChoice = await askUseSavedServerPassword();
    if (!savedChoice) return undefined;
    if (savedChoice === 'use-saved') {
      serverPassword = savedPassword;
      wasSaved = true;
    } else {
      serverPassword = await askServerPassword();
    }
  } else {
    serverPassword = await askServerPassword();
  }

  if (!serverPassword) return undefined;

  if (serverPassword !== savedPassword) {
    const savePassword = await askSaveServerPassword();
    if (savePassword === null) return undefined;
    if (savePassword) {
      await setSavedServerPassword(serverPassword);
      wasSaved = true;
    }
  }

  return { password: serverPassword, wasSaved };
}

async function configureExposedProviders(): Promise<string[] | null | undefined> {
  p.log.info('Add providers to expose. Listed providers are removed when selected — like favorites.');
  const spinner = p.spinner();
  spinner.start('Loading providers...');
  const catalog = await fetchProviderCatalog({ agent: 'server' });
  spinner.stop('');

  const available = providerOptionsFromCatalog(catalog);
  const picked = await selectServerProviders(available, getServerExposedProviders() ?? undefined);
  if (!picked) return undefined;
  setServerExposedProviders(picked);
  p.log.success(`Saved ${picked.length} provider${picked.length !== 1 ? 's' : ''} for future server runs.`);
  return picked;
}

async function runServerWizard(): Promise<ServerRunConfig | undefined> {
  relayIntro('Server');

  const startMode = await askServerStartMode();
  if (!startMode) return undefined;

  if (startMode === 'quick') {
    return {
      exposedProviders: getServerExposedProviders(),
      maskGatewayIds: getServerMaskGatewayIds(),
      favoritesOnly: getServerFavoritesOnly(),
    };
  }

  const favoritesOnly = await askFavoritesOnly(getServerFavoritesOnly());
  if (favoritesOnly === null) return undefined;
  setServerFavoritesOnly(favoritesOnly);
  if (favoritesOnly) {
    p.log.info('Manage favorites with `relay-ai models`.');
  }

  let exposedProviders: string[] | null | undefined = null;
  if (!favoritesOnly) {
    exposedProviders = await configureExposedProviders();
    if (exposedProviders === undefined) return undefined;
  }

  const maskGatewayIds = await askMaskGatewayIds(getServerMaskGatewayIds());
  if (maskGatewayIds === null) return undefined;
  setServerMaskGatewayIds(maskGatewayIds);

  return { exposedProviders, maskGatewayIds, favoritesOnly };
}

async function runVertexServerCommand(): Promise<number> {
  relayIntro('Vertex Gateway');

  const vertexConfig = buildVertexRuntimeConfig();
  if (!vertexConfig) {
    p.log.error('Set ANTHROPIC_VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT to your GCP project.');
    return 1;
  }

  if (!hasApplicationDefaultCredentials()) {
    p.log.error('Google Application Default Credentials not found.');
    p.log.info('Run: gcloud auth application-default login');
    return 1;
  }

  const mode = await askListenMode();
  if (!mode) return 0;

  const pwResult = await getServerPasswordForMode(mode);
  if (pwResult === undefined) return 0;
  const { password: serverPassword, wasSaved: passwordWasSaved } = pwResult;

  const host = mode === 'network' ? '0.0.0.0' : '127.0.0.1';
  const models = vertexModelsToServerModels(vertexConfig);

  const server = await startServer({
    host,
    port: 17645,
    apiKey: 'vertex-local',
    serverPassword,
    catalog: createVertexModelCatalog(models),
    backends: BACKENDS,
    vertex: {
      project: vertexConfig.project,
      location: vertexConfig.location,
    },
  });

  console.log('');
  console.log(pc.bold(pc.green('Vertex gateway running')));
  console.log(`  Anthropic:  http://127.0.0.1:${server.port}/anthropic`);
  console.log(`  Models:     ${models.map(model => model.id).join(', ')}`);
  if (mode === 'network') {
    for (const { name, address } of getLocalIps()) {
      console.log(`  Network (${name}):  http://${address}:${server.port}/anthropic`);
    }
    if (passwordWasSaved) {
      console.log('  API key:    saved, rotate with `relay-ai server --setup`');
    } else {
      console.log(`  API key:    ${serverPassword}`);
    }
  } else {
    console.log('  API key:    any non-empty value');
  }
  console.log(pc.dim('  Auth:       gcloud Application Default Credentials'));
  console.log('');
  printModelCatalog(models);
  console.log(pc.dim('Press Ctrl+C to stop.'));

  await waitForShutdown();
  await server.close();
  return 0;
}

async function resolveServerUpstreamApiKey(): Promise<string | null> {
  let apiKey = sanitizeCredential(resolveApiKey());
  if (apiKey) return apiKey;

  apiKey = sanitizeCredential(await readFromCredentialStore((reason) => {
    p.log.warn(`Credential store unavailable — ${reason}`);
  }));
  if (apiKey) {
    const isMac = process.platform === 'darwin';
    const isWindows = process.platform === 'win32';
    const storeName = isMac ? 'macOS Keychain' : isWindows ? 'Windows Credential Manager' : 'Secret Service';
    p.log.success(`Found key in ${storeName}`);
    return apiKey;
  }

  const catalog = await fetchProviderCatalog({ agent: 'server' });
  if (catalog.localProviders.some(provider => provider.apiKey.trim())) {
    return 'registry-local';
  }

  return null;
}

export async function runServerCommand(options: ServerCommandOptions = {}): Promise<number> {
  if (options.vertex) {
    return runVertexServerCommand();
  }

  const apiKey = await resolveServerUpstreamApiKey();
  if (!apiKey) {
    p.log.error('No providers configured. Run `relay-ai providers add` or import, or set OPENCODE_API_KEY for Zen/Go.');
    return 1;
  }

  const runConfig = await runServerWizard();
  if (!runConfig) return 0;

  const mode = await askListenMode();
  if (!mode) return 0;

  const pwResult = await getServerPasswordForMode(mode);
  if (pwResult === undefined) return 0;
  const { password: serverPassword, wasSaved: passwordWasSaved } = pwResult;

  const host = mode === 'network' ? '0.0.0.0' : '127.0.0.1';
  const spinner = p.spinner();
  spinner.start('Fetching available models...');

  let models: ServerModelInfo[];
  try {
    models = await loadServerModels();
    if (runConfig.exposedProviders) {
      models = filterServerModelsByProviders(models, runConfig.exposedProviders);
    }
    if (runConfig.favoritesOnly) {
      const favorites = loadPreferences().favoriteModels ?? [];
      if (favorites.length === 0) {
        spinner.stop(pc.red('No favorite models configured'));
        p.log.error('Run `relay-ai models` to add favorites, or turn off favorites-only in the server wizard.');
        return 1;
      }
      models = filterServerModelsByFavorites(models, favorites).slice(0, MAX_MODEL_CATALOG);
      if (models.length === 0) {
        spinner.stop(pc.red('No favorite models matched the current provider filter'));
        p.log.error('Adjust favorites with `relay-ai models` or change exposed providers in the server wizard.');
        return 1;
      }
    }
    if (runConfig.favoritesOnly) {
      p.log.info(
        `Favorites-only mode active — GET /anthropic/v1/models returns ${models.length} favorites.`,
      );
      p.log.info('Desktop/Cowork picker will only show these. Edit with `relay-ai models`.');
    }
    if (models.length === 0) {
      spinner.stop(pc.red('No models to expose'));
      p.log.error('Add providers with `relay-ai providers add` or configure exposed providers in the server wizard.');
      return 1;
    }

    const localCount = models.filter(m => m.apiKey !== undefined).length;
    const summary = summarizeServerProviders(models);
    const filterNote = runConfig.exposedProviders
      ? ` — ${runConfig.exposedProviders.length} provider${runConfig.exposedProviders.length !== 1 ? 's' : ''}`
      : '';
    const favoritesNote = runConfig.favoritesOnly ? ' — favorites only' : '';
    const maskNote = runConfig.maskGatewayIds ? ' — discovery ids masked' : '';
    spinner.stop(`Loaded ${models.length} models (${localCount} from registry providers)${filterNote}${favoritesNote}${maskNote}`);
    if (summary) p.log.info(summary);
  } catch (err) {
    spinner.stop(pc.red('Failed to load models'));
    console.error(pc.red(String(err instanceof Error ? err.message : err)));
    return 1;
  }

  const gateway = runConfig.maskGatewayIds ? { maskGatewayIds: true as const } : undefined;
  const server = await startServer({
    host,
    port: 17645,
    apiKey,
    serverPassword,
    catalog: createGatewayModelCatalog(models, gateway),
    backends: BACKENDS,
    gateway,
  });

  console.log('');
  console.log(pc.bold(pc.green('Relay AI server running')));
  console.log(`  Anthropic:  http://127.0.0.1:${server.port}/anthropic`);
  console.log(`  OpenAI:     http://127.0.0.1:${server.port}/openai/v1`);
  if (mode === 'network') {
    for (const { name, address } of getLocalIps()) {
      console.log(`  Network (${name}):`);
      console.log(`    Anthropic:  http://${address}:${server.port}/anthropic`);
      console.log(`    OpenAI:     http://${address}:${server.port}/openai/v1`);
    }
    if (passwordWasSaved) {
      console.log('  API key:    saved, rotate with `relay-ai server --setup`');
    } else {
      console.log(`  API key:    ${serverPassword}`);
    }
  } else {
    console.log('  API key:    any non-empty value');
  }
  if (runConfig.exposedProviders) {
    console.log(pc.dim(`  Providers:  ${runConfig.exposedProviders.join(', ')}`));
  }
  if (runConfig.favoritesOnly) {
    console.log(pc.dim('  Catalog:    favorite models only'));
  }
  if (runConfig.maskGatewayIds) {
    console.log(pc.dim('  Discovery:  gateway ids masked for Claude Desktop / Cowork'));
  }
  console.log('');
  printModelCatalog(models, gateway);
  console.log(pc.dim('Press Ctrl+C to stop.'));

  await waitForShutdown();
  await server.close();
  return 0;
}
