import pc from 'picocolors';
import * as p from '@clack/prompts';
import { appendFileSync } from 'node:fs';
import { loadPreferences, savePreferences } from './config.js';
import { fetchProviderCatalog, providersForPicker } from './provider-catalog.js';
import { detectConflicts, buildAntigravityChildEnv } from './env.js';
import { buildAntigravityRoutes } from './antigravity/catalog.js';
import { startCloudCodeGateway, type CloudCodeGatewayHandle } from './antigravity/cloud-code-gateway.js';
import { evaluateAgySwitchCompatibility } from './antigravity/slot-registry.js';
import { resolveAntigravityLaunchRoutes } from './antigravity/launch-routes.js';
import { launchAntigravityCli, readAntigravityCliVersion } from './antigravity/launch-cli.js';
import catalogFixtureRaw from './antigravity/fixtures/fetchAvailableModels.json' with { type: 'json' };
import {
  isAntigravityIdeRunning,
  launchAntigravityIde,
  quitAntigravityIdeGracefully,
  waitForAntigravityIdeQuit,
} from './antigravity/launch-ide.js';
import { pickLocalModel } from './prompts.js';
import { providerSelectOption, formatModelLabel, relayIntro, relayOutro } from './ui.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FavoriteModel, UserPreferences, LocalProvider, LocalProviderModel } from './types.js';
import type { CatalogFixture } from './antigravity/types.js';

const AGY_FAVORITES_PROVIDER_ID = '__relay_agy_favorites__';
const AGY_FAVORITES_PROVIDER_LABEL = '★ Antigravity CLI Favorites';

/** True when child args already select a model (--model or --model=). */
export function agyArgsIncludeModelFlag(args: string[]): boolean {
  return args.some(arg => arg === '--model' || arg.startsWith('--model='));
}

/** Prepend --model <display label> unless the user already passed --model. */
export function buildAgyLaunchArgs(modelLabel: string, childArgs: string[]): string[] {
  if (agyArgsIncludeModelFlag(childArgs)) return childArgs;
  return ['--model', modelLabel, ...childArgs];
}

export function agyArgsAreNonInteractive(args: string[]): boolean {
  return args.some(arg => arg === '-p' || arg === '--prompt' || arg.startsWith('--prompt='));
}

export function formatAgyCapacityWarning(validatedSlotCount: number, skippedFavoriteCount: number): string {
  const slotWord = validatedSlotCount === 1 ? 'slot' : 'slots';
  const favoritePhrase = skippedFavoriteCount === 1
    ? '1 favorite was not exposed'
    : `${skippedFavoriteCount} favorites were not exposed`;
  return `AGY can switch among ${validatedSlotCount} validated model ${slotWord}; ${favoritePhrase}.`;
}

function isInteractiveTerminal(): boolean {
  return !!process.stdin.isTTY && !!process.stdout.isTTY;
}

function resolveFavoriteModel(
  favorite: FavoriteModel,
  allProviders: LocalProvider[],
): { provider: LocalProvider; model: LocalProviderModel } | null {
  const provider = allProviders.find(candidate => candidate.id === favorite.providerId);
  const model = provider?.models.find(candidate => candidate.id === favorite.modelId);
  return provider && model ? { provider, model } : null;
}

function normalizeAgyModelSelector(value: string): string {
  return value
    .trim()
    .replace(/\s*\(Relay(?: - .*)?\)\s*$/i, '')
    .toLowerCase();
}

export function resolveAntigravityBootModel(
  provider: LocalProvider,
  modelSelector: string,
): { model: LocalProviderModel | null; error?: string } {
  const selector = normalizeAgyModelSelector(modelSelector);
  const exact = provider.models.filter(model =>
    normalizeAgyModelSelector(model.id) === selector
    || normalizeAgyModelSelector(model.name) === selector
    || normalizeAgyModelSelector(model.upstreamModelId) === selector
  );
  if (exact.length === 1) return { model: exact[0]! };

  const prefix = provider.models.filter(model =>
    normalizeAgyModelSelector(model.id).startsWith(selector)
    || normalizeAgyModelSelector(model.name).startsWith(selector)
    || normalizeAgyModelSelector(model.upstreamModelId).startsWith(selector)
  );
  if (prefix.length === 1) return { model: prefix[0]! };

  const candidates = (exact.length > 1 ? exact : prefix).slice(0, 5);
  const candidateText = candidates.length > 0
    ? ` Did you mean: ${candidates.map(model => `${model.name || model.id} (${model.id})`).join(', ')}?`
    : '';
  return {
    model: null,
    error: exact.length > 1 || prefix.length > 1
      ? `Model selector is ambiguous: ${modelSelector}.${candidateText}`
      : `Model not found: ${modelSelector} on provider ${provider.name}.${candidateText}`,
  };
}

async function pickAntigravityCliFavoriteLaunchModel(
  favorites: FavoriteModel[],
  allProviders: LocalProvider[],
): Promise<{ provider: LocalProvider; model: LocalProviderModel } | null> {
  const resolved = favorites
    .map(favorite => resolveFavoriteModel(favorite, allProviders))
    .filter((entry): entry is { provider: LocalProvider; model: LocalProviderModel } => entry !== null);

  if (resolved.length === 0) {
    p.log.warn('No Antigravity CLI favorites are available.');
    p.log.info(pc.dim('Manage them with `relay-ai favorites --agy`.'));
    return null;
  }

  const picked = await p.select<string>({
    message: 'Launch from Antigravity CLI favorites',
    options: resolved.map(({ provider, model }) => ({
      value: `${provider.id}:${model.id}`,
      label: formatModelLabel(model),
      hint: provider.name,
    })),
    initialValue: `${resolved[0]!.provider.id}:${resolved[0]!.model.id}`,
  });

  if (p.isCancel(picked)) {
    p.cancel('Cancelled.');
    return null;
  }

  const [providerId, ...modelParts] = picked.split(':');
  const modelId = modelParts.join(':');
  return resolved.find(entry => entry.provider.id === providerId && entry.model.id === modelId) ?? null;
}

async function resolveAntigravityLaunch(
  prefs: UserPreferences,
  boot: { launchProvider?: string; launchModel?: string } | undefined,
): Promise<{ provider: LocalProvider; model: LocalProviderModel; allProviders: LocalProvider[] } | null> {
  // Load the provider catalog
  let catalog;
  const catalogSpinner = p.spinner();
  catalogSpinner.start('Loading providers...');
  try {
    catalog = await fetchProviderCatalog();
  } catch (err) {
    catalogSpinner.stop('');
    p.log.error(String(err instanceof Error ? err.message : err));
    return null;
  }
  catalogSpinner.stop('');

  const allProviders = providersForPicker(catalog);
  if (allProviders.length === 0) {
    p.log.warn('No providers available.');
    p.log.info(pc.dim('Run relay-ai providers add or import to get started.'));
    return null;
  }

  // Check for explicit --provider + --model
  if (boot?.launchProvider && boot?.launchModel) {
    const provider = allProviders.find(p => p.id === boot.launchProvider);
    if (!provider) {
      p.log.error(`Provider not found: ${boot.launchProvider}`);
      return null;
    }
    const { model, error } = resolveAntigravityBootModel(provider, boot.launchModel);
    if (!model) {
      p.log.error(error ?? `Model not found: ${boot.launchModel} on provider ${provider.name}`);
      return null;
    }
    return { provider, model, allProviders };
  }

  // Interactive provider + model selection
  const providerOptions = [
    {
      value: AGY_FAVORITES_PROVIDER_ID,
      label: pc.cyan(AGY_FAVORITES_PROVIDER_LABEL),
      hint: `${prefs.antigravityCliFavoriteModels?.length ?? 0}/6 saved · manage with relay-ai favorites --agy`,
    },
    ...allProviders.map(lp => providerSelectOption(lp)),
  ];

  const initialProvider =
    prefs.lastAntigravityProvider && providerOptions.some(o => o.value === prefs.lastAntigravityProvider)
      ? prefs.lastAntigravityProvider
      : providerOptions[0]!.value;

  const conflicts = detectConflicts();

  let currentInitialProvider = initialProvider;
  while (true) {
    const chosen = await p.select<string>({
      message: 'Which provider?',
      options: providerOptions,
      initialValue: currentInitialProvider,
    });

    if (p.isCancel(chosen)) {
      p.cancel('Cancelled.');
      return null;
    }

    if (chosen === AGY_FAVORITES_PROVIDER_ID) {
      const favoriteSelection = await pickAntigravityCliFavoriteLaunchModel(
        prefs.antigravityCliFavoriteModels ?? [],
        allProviders,
      );
      if (!favoriteSelection) {
        currentInitialProvider = AGY_FAVORITES_PROVIDER_ID;
        continue;
      }
      return { ...favoriteSelection, allProviders };
    }

    const activeProvider = allProviders.find(lp => lp.id === chosen)!;
    const pickedModelResult = await pickLocalModel(activeProvider, conflicts, prefs);
    if (pickedModelResult === 'back') {
      currentInitialProvider = activeProvider.id;
      continue;
    }
    if (!pickedModelResult) return null;

    return { provider: activeProvider, model: pickedModelResult, allProviders };
  }
}

async function resolveAndBuildRoutes(
  provider: LocalProvider,
  model: LocalProviderModel,
  allProviders: LocalProvider[],
  prefs: UserPreferences,
  opts: {
    maxRoutes: number;
    validatedSlotCount: number;
    pauseForCapacityWarning: boolean;
    childArgs: string[];
  },
): Promise<{ routes: ReturnType<typeof buildAntigravityRoutes>; apiKey: string } | null> {
  const result = await resolveAntigravityLaunchRoutes({
    provider,
    model,
    allProviders,
    favorites: prefs.antigravityCliFavoriteModels ?? [],
    maxRoutes: opts.maxRoutes,
  });
  if (!result) {
    p.log.error(`No credential for ${provider.name}. Run: relay-ai providers auth ${provider.id} or add an API key.`);
    return null;
  }

  if (result.routes.length > 1) {
    p.log.info(
      `Favorites mode active — Antigravity picker will show ${result.routes.length} models.`,
    );
    p.log.info('Edit with `relay-ai favorites --agy`.');
  }
  if (result.droppedFavorites.length > 0) {
    p.log.warn(
      `Skipped ${result.droppedFavorites.length} stale/unauthorized favorite(s): `
      + result.droppedFavorites.map(fav => `${fav.providerId}:${fav.modelId}`).join(', '),
    );
  }
  if (result.capacitySkippedFavorites.length > 0) {
    p.log.warn(formatAgyCapacityWarning(opts.validatedSlotCount, result.capacitySkippedFavorites.length));
    p.log.warn(
      'Not exposed: '
      + result.capacitySkippedFavorites.map(fav => `${fav.providerId}:${fav.modelId}`).join(', '),
    );

    if (
      opts.pauseForCapacityWarning
      && isInteractiveTerminal()
      && !agyArgsAreNonInteractive(opts.childArgs)
    ) {
      const proceed = await p.confirm({
        message: 'Continue with the validated AGY switch catalog?',
        initialValue: true,
      });
      if (p.isCancel(proceed) || !proceed) {
        p.cancel('Cancelled.');
        return null;
      }
    }
  }

  return { routes: result.routes, apiKey: result.apiKey };
}

function waitForShutdown(): Promise<'sigint' | 'sigterm' | 'sighup'> {
  return new Promise(resolve => {
    const cleanup = (): void => {
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
      process.removeListener('SIGHUP', onSighup);
    };
    const onSigint = (): void => { cleanup(); resolve('sigint'); };
    const onSigterm = (): void => { cleanup(); resolve('sigterm'); };
    const onSighup = (): void => { cleanup(); resolve('sighup'); };
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
    process.once('SIGHUP', onSighup);
  });
}

async function promptToCloseAntigravityIde(profileDir: string): Promise<void> {
  if (!isAntigravityIdeRunning(profileDir)) return;

  const shouldClose = await p.confirm({
    message: 'Antigravity IDE is still running. Close it?',
    initialValue: true,
  });
  if (p.isCancel(shouldClose) || shouldClose) {
    p.log.step('Stopping Antigravity IDE...');
    quitAntigravityIdeGracefully();
    await waitForAntigravityIdeQuit(profileDir);
  }
}

async function runAntigravityCommand(
  intro: string,
  tracePrefix: string,
  trace: boolean,
  boot: { launchProvider?: string; launchModel?: string } | undefined,
  launch: (env: NodeJS.ProcessEnv, routes: ReturnType<typeof buildAntigravityRoutes>, gatewayHandle: CloudCodeGatewayHandle) => Promise<number>,
  opts: {
    childArgs?: string[];
    versionGuard?: boolean;
    pauseForCapacityWarning?: boolean;
  } = {},
): Promise<number> {
  const prefs = loadPreferences();

  relayIntro(intro);
  if (
    tracePrefix === 'agy'
    && (prefs.favoriteModels?.length ?? 0) > 0
    && (prefs.antigravityCliFavoriteModels?.length ?? 0) === 0
    && !prefs.antigravityCliFavoritesHintShown
  ) {
    p.log.info('Tip: AGY uses its own favorites list. Run `relay-ai favorites --agy` to set up switching.');
    savePreferences({ antigravityCliFavoritesHintShown: true });
  }

  const selection = await resolveAntigravityLaunch(prefs, boot);
  if (!selection) return 1;

  const { provider, model, allProviders } = selection;

  const versionResult = opts.versionGuard
    ? readAntigravityCliVersion()
    : { version: '1.0.10' };
  const compatibility = evaluateAgySwitchCompatibility({
    version: versionResult.version,
    versionReadError: 'error' in versionResult ? versionResult.error : undefined,
    fixture: catalogFixtureRaw as unknown as CatalogFixture,
  });
  for (const warning of compatibility.warnings) {
    p.log.warn(warning);
  }

  const routeLimit = compatibility.mode === 'multi-model'
    ? compatibility.validatedSwitchSlotCount
    : 1;
  const routeResult = await resolveAndBuildRoutes(provider, model, allProviders, prefs, {
    maxRoutes: routeLimit,
    validatedSlotCount: routeLimit,
    pauseForCapacityWarning: opts.pauseForCapacityWarning ?? false,
    childArgs: opts.childArgs ?? [],
  });
  if (!routeResult) return 1;

  savePreferences({
    lastAntigravityProvider: provider.id,
    lastAntigravityModel: model.id,
  });

  const traceLogPath = `/tmp/relay-ai-${tracePrefix}-trace-${Date.now()}.log`;
  const logFn = trace ? (msg: string) => { try { appendFileSync(traceLogPath, `${msg}\n`); } catch {} } : undefined;

  let gatewayHandle: CloudCodeGatewayHandle;
  try {
    gatewayHandle = await startCloudCodeGateway(routeResult.routes, { trace, logFn });
  } catch (err) {
    p.log.error(`Failed to start Cloud Code gateway: ${err}`);
    return 1;
  }

  p.log.info(`Cloud Code gateway on ${pc.cyan(`127.0.0.1:${gatewayHandle.port}`)}`);
  p.log.success(`Active model: ${formatModelLabel(model)} ${pc.dim('via')} ${provider.name}`);
  if (trace) p.log.info(`Gateway trace → ${pc.dim(traceLogPath)}`);

  relayOutro('Launching', `${formatModelLabel(model)} (${provider.name})`);

  try {
    const cleanEnv = buildAntigravityChildEnv(gatewayHandle.url);
    return await launch(cleanEnv, routeResult.routes, gatewayHandle);
  } finally {
    await gatewayHandle.close();
  }
}

export async function runAgyCommand(
  childArgs: string[],
  trace = false,
  boot?: { launchProvider?: string; launchModel?: string },
): Promise<number> {
  return runAntigravityCommand(
    'relay-ai agy — Antigravity CLI', 'agy', trace, boot,
    (env, routes) => launchAntigravityCli(env, buildAgyLaunchArgs(routes[0]!.displayName, childArgs)),
    { childArgs, versionGuard: true, pauseForCapacityWarning: true },
  );
}

export async function runAntigravityIdeCommand(
  childArgs: string[],
  trace = false,
  boot?: { launchProvider?: string; launchModel?: string },
): Promise<number> {
  return runAntigravityCommand(
    'relay-ai antigravity-ide — Antigravity IDE', 'ide', trace, boot,
    async (env, _routes, gatewayHandle) => {
      const profileDir = join(homedir(), '.relay-ai', 'antigravity', 'profile');
      if (isAntigravityIdeRunning(profileDir)) {
        const restart = await p.confirm({
          message: 'Restart Antigravity IDE to apply this Relay gateway?',
          initialValue: true,
        });
        if (p.isCancel(restart) || !restart) {
          p.log.info('Quit and reopen Antigravity IDE when you are ready for the new gateway to take effect.');
          return 0;
        }
        quitAntigravityIdeGracefully();
        await waitForAntigravityIdeQuit(profileDir);
      }

      const launchCode = await launchAntigravityIde(env, profileDir, gatewayHandle.url, childArgs);
      if (launchCode !== 0) return launchCode;

      p.log.info('Antigravity IDE is using the Relay Cloud Code gateway.');
      p.log.info(pc.cyan('Press Ctrl+C to stop the gateway.'));
      await waitForShutdown();
      console.log('');
      await promptToCloseAntigravityIde(profileDir);
      return 0;
    },
    { childArgs, versionGuard: false, pauseForCapacityWarning: false },
  );
}
