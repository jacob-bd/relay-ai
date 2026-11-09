import { MAX_MODEL_CATALOG } from './constants.js';
import pc from 'picocolors';

const SHUTDOWN_DRAIN_MS = 500;
import * as p from '@clack/prompts';
import { loadPreferences, savePreferences } from './config.js';
import { fetchProviderCatalog, providersForPicker } from './provider-catalog.js';
import { providersForTarget } from './target-compatibility.js';
import { detectConflicts, buildAntigravityChildEnv } from './env.js';
import { buildAntigravityRoutes, type AntigravityEffortMode } from './antigravity/catalog.js';
import { startCloudCodeGateway, type CloudCodeGatewayHandle } from './antigravity/cloud-code-gateway.js';
import { evaluateAgySwitchCompatibility } from './antigravity/slot-registry.js';
import { buildAntigravityLaunchPoolRows, resolveAntigravityLaunchRoutes } from './antigravity/launch-routes.js';
import { launchAntigravityCli, readAntigravityCliVersion } from './antigravity/launch-cli.js';
import { clearAppLastSelectedModel } from './antigravity/ide-profile.js';
import { stopExistingIde, watchExistingIdeShutdown, waitForExistingIdeShutdownWithConfirm } from './antigravity/ide-existing-lifecycle.js';
import {
  beginExistingIdeSession,
  restoreExistingIdeSession,
  readExistingIdeRecoveryRecord,
  assertNoActiveExistingIdeSession,
  acquireExistingIdeSession,
  releaseEmptyExistingIdeSession,
  readExistingIdeLock,
} from './antigravity/ide-session.js';
import { isProcessAlive } from './codex/session.js';
import catalogFixtureRaw from './antigravity/fixtures/fetchAvailableModels.json' with { type: 'json' };
import {
  forceQuitAntigravityApp,
  forceQuitAntigravityIde,
  isAntigravityAppRunning,
  isAntigravityIdeRunning,
  launchAntigravityApp,
  launchAntigravityIde,
  quitAntigravityAppGracefully,
  quitAntigravityIdeGracefully,
  waitForAntigravityAppQuit,
  waitForAntigravityIdeQuit,
  getDefaultAntigravityIdeProfileDir,
  isExistingAntigravityIdeRunning,
  quitExistingAntigravityIde,
  waitForExistingAntigravityIdeQuit,
  forceQuitExistingAntigravityIde,
} from './antigravity/launch-ide.js';
import { pickLocalModel } from './prompts.js';
import { pickerRefresh } from './picker-refresh.js';
import { pickFavoriteStartModel } from './codex/favorites-launch.js';
import { isEnterpriseAuthTier, readAgyOnboardingAuthMethod, type DetectedAuthTier } from './antigravity/account-guardrail.js';
import { getAntigravityDebugLogPath, makeTraceLogger } from './trace-log.js';
import { providerSelectOption, formatModelLabel, relayIntro, relayOutro } from './ui.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FavoriteModel, UserPreferences, LocalProvider, LocalProviderModel } from './types.js';
import type { CatalogFixture } from './antigravity/types.js';
import { printUiUrlLast } from './ui-background.js';

const AGY_FAVORITES_PROVIDER_ID = '__relay_agy_favorites__';
const AGY_FAVORITES_PROVIDER_LABEL = '⭐ Favorites Catalog';
const AGY_POOL_PROVIDER_ID = '__relay_agy_pool__';
const POOL_LAUNCH_LABEL = 'Relay Free Pool';

/** What the launcher picked: a model, or the free pool as the whole session. */
type AntigravityLaunchSelection =
  | { provider: LocalProvider; model: LocalProviderModel; allProviders: LocalProvider[]; startOnPool?: false }
  | { startOnPool: true; allProviders: LocalProvider[]; provider?: undefined; model?: undefined };

/** True when child args already select a model (--model or --model=). */
export function agyArgsIncludeModelFlag(args: string[]): boolean {
  return args.some(arg => arg === '--model' || arg.startsWith('--model='));
}

/** Label agy opens on: the launch model at medium when it has effort entries, else the first entry. */
export function agyLaunchModelLabel(routes: ReturnType<typeof buildAntigravityRoutes>): string {
  const first = routes[0]!;
  // The pool lists one row per effort level, each its own model id: open on medium when it is offered.
  if (first.providerId === 'relay-free-pool') {
    const pool = routes.filter(route => route.providerId === 'relay-free-pool');
    return (pool.find(route => route.reasoningEffort === 'medium') ?? first).displayName;
  }
  const medium = routes.find(route =>
    route.providerId === first.providerId && route.modelId === first.modelId && route.reasoningEffort === 'medium');
  return (medium ?? first).displayName;
}

/** Prepend --model <display label> unless the user already passed --model. */
export function buildAgyLaunchArgs(modelLabel: string, childArgs: string[]): string[] {
  if (agyArgsIncludeModelFlag(childArgs)) return childArgs;
  return ['--model', modelLabel, ...childArgs];
}

export function agyArgsAreNonInteractive(args: string[]): boolean {
  return args.some(arg => arg === '-p' || arg === '--prompt' || arg.startsWith('--prompt='));
}

export function formatAgyCapacityWarning(maxEntries: number, skippedFavoriteCount: number): string {
  const entryWord = maxEntries === 1 ? 'model' : 'models';
  const favoritePhrase = skippedFavoriteCount === 1
    ? '1 favorite was not exposed'
    : `${skippedFavoriteCount} favorites were not exposed`;
  return `Antigravity can list ${maxEntries} ${entryWord} (effort levels count separately); ${favoritePhrase}.`;
}

function isInteractiveTerminal(): boolean {
  return !!process.stdin.isTTY && !!process.stdout.isTTY;
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

async function resolveAntigravityLaunch(
  prefs: UserPreferences,
  boot: { launchProvider?: string; launchModel?: string } | undefined,
): Promise<AntigravityLaunchSelection | null> {
  // Load the provider catalog
  let catalog;
  const catalogSpinner = p.spinner();
  catalogSpinner.start('Loading providers...');
  try {
    catalog = await fetchProviderCatalog({ agent: 'antigravity' });
  } catch (err) {
    catalogSpinner.stop('');
    p.log.error(String(err instanceof Error ? err.message : err));
    return null;
  }
  catalogSpinner.stop('');

  const allProviders = providersForTarget(providersForPicker(catalog), 'antigravity');
  if (allProviders.length === 0) {
    p.log.warn('No providers available.');
    p.log.info(pc.dim('Run relay-ai providers add or import to get started.'));
    return null;
  }

  // The Relay Free Pool as the whole session (the UI launches it as provider = model = relay-free-pool).
  if (boot?.launchProvider === 'relay-free-pool' && boot.launchModel === 'relay-free-pool') {
    return { startOnPool: true, allProviders };
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
      hint: `${prefs.favoriteModels?.length ?? 0}/${MAX_MODEL_CATALOG} saved · manage with relay-ai favorites`,
    },
    ...allProviders.map(lp => providerSelectOption(lp)),
  ];
  // Relay Free Pool as the whole session: right under Favorites Catalog, only when the pool is enabled and at
  // least one member has evidence for Antigravity.
  if ((await buildAntigravityLaunchPoolRows(allProviders, 1, 'rows')).length > 0) {
    providerOptions.splice(1, 0, {
      value: AGY_POOL_PROVIDER_ID,
      label: pc.cyan('🏊 ' + POOL_LAUNCH_LABEL),
      hint: 'experimental · starts on the pool, falls back across your free models',
    });
  }

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

    if (chosen === AGY_POOL_PROVIDER_ID) return { startOnPool: true, allProviders };

    if (chosen === AGY_FAVORITES_PROVIDER_ID) {
      const favoriteSelection = await pickFavoriteStartModel(
        allProviders,
        prefs.favoriteModels ?? [],
        'antigravity',
        prefs,
        async () => {
          const fresh = providersForTarget(providersForPicker(await fetchProviderCatalog({ agent: 'antigravity' })), 'antigravity');
          for (const lp of allProviders) {
            const loaded = fresh.find(f => f.id === lp.id);
            if (loaded) lp.models = loaded.models;
          }
        },
      );
      if (favoriteSelection === 'back') {
        currentInitialProvider = AGY_FAVORITES_PROVIDER_ID;
        continue;
      }
      if (!favoriteSelection) {
        p.log.warn('No favorites are available for Antigravity.');
        p.log.info(pc.dim('Manage them with `relay-ai favorites`.'));
        currentInitialProvider = AGY_FAVORITES_PROVIDER_ID;
        continue;
      }
      return { ...favoriteSelection, allProviders };
    }

    const activeProvider = allProviders.find(lp => lp.id === chosen)!;
    const pickedModelResult = await pickLocalModel(activeProvider, conflicts, prefs, pickerRefresh(activeProvider, async () =>
      providersForTarget(providersForPicker(await fetchProviderCatalog({ agent: 'antigravity' })), 'antigravity').find(lp => lp.id === activeProvider.id)));
    if (pickedModelResult === 'back') {
      currentInitialProvider = activeProvider.id;
      continue;
    }
    if (!pickedModelResult) return null;

    return { provider: activeProvider, model: pickedModelResult, allProviders };
  }
}

async function resolveAndBuildRoutes(
  provider: LocalProvider | undefined,
  model: LocalProviderModel | undefined,
  allProviders: LocalProvider[],
  prefs: UserPreferences,
  opts: {
    maxRoutes: number;
    pauseForCapacityWarning: boolean;
    childArgs: string[];
    effortMode: AntigravityEffortMode;
    startOnPool?: boolean;
  },
): Promise<{ routes: ReturnType<typeof buildAntigravityRoutes>; apiKey: string } | null> {
  const result = await resolveAntigravityLaunchRoutes({
    provider,
    model,
    allProviders,
    startOnPool: opts.startOnPool,
    favorites: provider?.launchAllModels
      ? provider.models.map(model => ({ providerId: provider.id, modelId: model.id }))
      : prefs.favoriteModels ?? [],
    maxRoutes: opts.maxRoutes,
    effortMode: opts.effortMode,
  });
  if (!result) {
    if (opts.startOnPool) p.log.error('No servable Relay Free Pool member for Antigravity. Run: relay-ai pool verify');
    else p.log.error(`No credential for ${provider!.name}. Run: relay-ai providers auth ${provider!.id} or add an API key.`);
    return null;
  }

  if (result.routes.length > 1) {
    const effortNote =
      opts.effortMode === 'slider'
        ? `each model's low/medium/high/max share one row with an effort slider.`
        : opts.effortMode === 'submenu'
          ? `each model's low/medium/high share one row with an effort submenu.`
          : `effort levels are listed separately.`;
    if (provider?.launchAllModels) {
      const modelCount = new Set(result.routes.map(route => `${route.providerId}:${route.modelId}`)).size;
      p.log.info(
        `All provider models mode active — ${modelCount} models, ${result.routes.length} entries; favorites will not be used. ${effortNote}`,
      );
    } else {
      p.log.info(`Favorites mode active — ${result.routes.length} entries; ${effortNote}`);
      p.log.info('Edit with `relay-ai favorites`.');
    }
  }
  if (result.droppedFavorites.length > 0) {
    p.log.warn(
      `Skipped ${result.droppedFavorites.length} stale/unauthorized favorite(s): `
      + result.droppedFavorites.map(fav => `${fav.providerId}:${fav.modelId}`).join(', '),
    );
  }
  if (result.capacitySkippedFavorites.length > 0) {
    p.log.warn(formatAgyCapacityWarning(opts.maxRoutes, result.capacitySkippedFavorites.length));
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

export function waitForShutdown(
  input: NodeJS.ReadStream = process.stdin,
  platform: NodeJS.Platform = process.platform,
): Promise<'sigint' | 'sigterm' | 'sighup'> {
  return new Promise(resolve => {
    const captureWindowsCtrlC = platform === 'win32' && input.isTTY;
    const wasRaw = input.isRaw;
    const wasPaused = input.isPaused();
    const cleanup = (): void => {
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
      process.removeListener('SIGHUP', onSighup);
      if (captureWindowsCtrlC) {
        input.removeListener('data', onInput);
        input.setRawMode(wasRaw);
        if (wasPaused) input.pause();
      }
    };
    const onSigint = (): void => { cleanup(); resolve('sigint'); };
    const onSigterm = (): void => { cleanup(); resolve('sigterm'); };
    const onSighup = (): void => { cleanup(); resolve('sighup'); };
    const onInput = (chunk: Buffer | string): void => {
      const receivedCtrlC = typeof chunk === 'string'
        ? chunk.includes('\u0003')
        : chunk.includes(0x03);
      if (receivedCtrlC) onSigint();
    };
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
    process.once('SIGHUP', onSighup);
    if (captureWindowsCtrlC) {
      input.on('data', onInput);
      input.setRawMode(true);
      input.resume();
    }
  });
}


interface EnterpriseAuthRisk {
  /** Which signal flagged the account. */
  source: 'onboarding' | 'last-session';
  userTier?: string;
  project?: string;
}

/**
 * Decide whether this Antigravity surface is likely signed in with a work /
 * Gemini Enterprise account, using the freshest available signal:
 *  - `agy`: the CLI's own onboarding cache (before launch); a consumer sign-in
 *    there is trusted over any stale cached tier.
 *  - app/IDE and fallbacks: the last auth tier observed by the gateway.
 */
function assessEnterpriseAccountRisk(tracePrefix: string, prefs: UserPreferences): EnterpriseAuthRisk | null {
  if (tracePrefix === 'agy') {
    const method = readAgyOnboardingAuthMethod();
    if (method === 'gcp') return { source: 'onboarding' };
    if (method === 'consumer') return null;
  }
  if (isEnterpriseAuthTier(prefs.antigravityAuthTier)) {
    return {
      source: 'last-session',
      userTier: prefs.antigravityAuthTier,
      project: prefs.antigravityAuthProject,
    };
  }
  return null;
}

/** Warn about — and ask to confirm — using relay with a work/enterprise account. */
async function confirmEnterpriseAccountUse(risk: EnterpriseAuthRisk, providerName: string): Promise<boolean> {
  p.log.warn('Antigravity is signed in with a Gemini Enterprise (work) account.');
  if (risk.source === 'last-session') {
    p.log.warn(
      `Last session used tier ${pc.bold(risk.userTier ?? 'unknown')}`
      + (risk.project ? ` on project ${pc.bold(risk.project)}` : '')
      + '.',
    );
  }
  p.log.warn(`Relay routes this session's model calls to ${pc.bold(providerName)}; using a company account with relay may violate your organization's usage policy.`);
  p.log.warn('To avoid this, sign in with a personal account in the Antigravity client (or set AGY_ACCOUNT) and relaunch.');

  if (!isInteractiveTerminal()) {
    p.log.warn('Continuing without confirmation (non-interactive session).');
    return true;
  }
  const proceed = await p.confirm({
    message: 'Proceed with the enterprise account?',
    initialValue: false,
  });
  if (p.isCancel(proceed)) {
    p.cancel('Cancelled.');
    return false;
  }
  return Boolean(proceed);
}

/** Gateway callback: persist the observed tier and warn once when it is a work seat. */
function reportDetectedAuthTier(info: DetectedAuthTier): void {
  savePreferences({ antigravityAuthTier: info.userTier, antigravityAuthProject: info.project });
  if (!isEnterpriseAuthTier(info.userTier)) return;
  p.log.warn(
    `Enterprise Gemini account detected in this session (${pc.bold(info.userTier)}`
    + (info.project ? ` · project ${pc.bold(info.project)}` : '')
    + ').',
  );
  p.log.warn("If this is your work account, using relay with it may violate your organization's usage policy.");
  p.log.warn('Sign in with a personal account (or set AGY_ACCOUNT) and relaunch to avoid this; the next launch will ask for confirmation.');
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
    /** How this surface exposes effort levels (default 'rows'). 'slider'/'submenu' drop native slots. */
    effortMode?: AntigravityEffortMode;
  } = {},
): Promise<number> {
  const prefs = loadPreferences();
  const effortMode = opts.effortMode ?? 'rows';

  relayIntro(intro);

  const selection = await resolveAntigravityLaunch(prefs, boot);
  if (!selection) return 1;

  const { provider, model, allProviders } = selection;
  const startOnPool = selection.startOnPool === true;
  const launchName = startOnPool ? POOL_LAUNCH_LABEL : formatModelLabel(model!);
  const launchVia = startOnPool ? 'your free models' : provider!.name;

  const accountRisk = assessEnterpriseAccountRisk(tracePrefix, prefs);
  if (accountRisk && !(await confirmEnterpriseAccountUse(accountRisk, launchVia))) {
    return 1;
  }

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

  const routeLimit = compatibility.mode === 'multi-model' ? MAX_MODEL_CATALOG : 1;
  const routeResult = await resolveAndBuildRoutes(provider, model, allProviders, prefs, {
    maxRoutes: routeLimit,
    pauseForCapacityWarning: opts.pauseForCapacityWarning ?? false,
    childArgs: opts.childArgs ?? [],
    effortMode,
    startOnPool,
  });
  if (!routeResult) return 1;

  savePreferences(startOnPool
    ? { lastAntigravityProvider: AGY_POOL_PROVIDER_ID }
    : { lastAntigravityProvider: provider!.id, lastAntigravityModel: model!.id });

  const traceLogPath = trace ? getAntigravityDebugLogPath(tracePrefix) : undefined;
  const logFn = traceLogPath ? makeTraceLogger(traceLogPath) : undefined;

  let gatewayHandle: CloudCodeGatewayHandle;
  try {
    // Only the IDE ('rows') borrows native Google slots; agy/app list every route as a Relay-only entry.
    gatewayHandle = await startCloudCodeGateway(routeResult.routes, {
      trace,
      logFn,
      nativeSlots: effortMode === 'rows',
      onAuthTierDetected: reportDetectedAuthTier,
    });
  } catch (err) {
    p.log.error(`Failed to start Cloud Code gateway: ${err}`);
    return 1;
  }

  p.log.info(`Cloud Code gateway on ${pc.cyan(`127.0.0.1:${gatewayHandle.port}`)}`);
  p.log.success(`Active model: ${launchName} ${pc.dim('via')} ${launchVia}`);
  if (traceLogPath) p.log.info(`Gateway trace → ${pc.dim(traceLogPath)}`);

  relayOutro('Launching', `${launchName} (${launchVia})`);

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
    (env, routes) => launchAntigravityCli(env, buildAgyLaunchArgs(agyLaunchModelLabel(routes), childArgs)),
    { childArgs, versionGuard: true, pauseForCapacityWarning: true, effortMode: 'slider' },
  );
}

export async function runAntigravityAppCommand(
  childArgs: string[],
  trace = false,
  boot?: { launchProvider?: string; launchModel?: string },
): Promise<number> {
  return runAntigravityCommand(
    'relay-ai antigravity — Antigravity app', 'antigravity', trace, boot,
    async (env, _routes, gatewayHandle) => {
      const profileDir = join(homedir(), '.relay-ai', 'antigravity', 'app-profile');
      if (isAntigravityAppRunning(profileDir)) {
        const restart = await p.confirm({
          message: 'Restart Antigravity to apply this Relay gateway?',
          initialValue: true,
        });
        if (p.isCancel(restart) || !restart) {
          p.log.info('Quit and reopen Antigravity when you are ready for the new gateway to take effect.');
          return 0;
        }
        quitAntigravityAppGracefully();
        if (!(await waitForAntigravityAppQuit(profileDir))) {
          forceQuitAntigravityApp(profileDir);
          await waitForAntigravityAppQuit(profileDir);
        }
      }

      // Open on the launch model, not whatever now holds the last-picked enum.
      clearAppLastSelectedModel(join(homedir(), '.gemini', 'antigravity', 'antigravity_state.pbtxt'));
      const launchCode = await launchAntigravityApp(env, profileDir, gatewayHandle.url, childArgs);
      if (launchCode !== 0) return launchCode;

      p.log.info('Antigravity is using the Relay Cloud Code gateway.');
      p.log.info(pc.cyan('Press Ctrl+C to stop the gateway.'));
      printUiUrlLast();
      await waitForShutdown();
      await new Promise(r => setTimeout(r, SHUTDOWN_DRAIN_MS));
      console.log('');
      p.log.step('Gateway stopped.');
      const shouldClose = await p.confirm({
        message: 'Close Antigravity?',
        initialValue: true,
      });
      if (!p.isCancel(shouldClose) && shouldClose) {
        p.log.step('Stopping Antigravity...');
        quitAntigravityAppGracefully();
        if (!(await waitForAntigravityAppQuit(profileDir))) {
          forceQuitAntigravityApp(profileDir);
          await waitForAntigravityAppQuit(profileDir);
        }
      }
      return 0;
    },
    { childArgs, versionGuard: false, pauseForCapacityWarning: false, effortMode: 'submenu' },
  );
}

function existingIdeControl(profileDir: string) {
  return {
    isRunning: () => isExistingAntigravityIdeRunning(profileDir),
    quit: () => quitExistingAntigravityIde(profileDir),
    waitForQuit: () => waitForExistingAntigravityIdeQuit(profileDir),
    forceQuit: () => forceQuitExistingAntigravityIde(profileDir),
  };
}

function restoreExistingProfile(): void {
  const result = restoreExistingIdeSession(process.env, { allowOwnPid: true });
  if (!result.restored) throw new Error(result.message ?? 'Could not restore the Antigravity IDE profile. Run relay-ai antigravity-ide --restore.');
  for (const warning of result.warnings ?? []) p.log.warn(warning);
  p.log.success('Restored your Antigravity IDE configuration. The IDE is closed.');
}

export async function runAntigravityIdeCommand(
  childArgs: string[],
  trace = false,
  boot?: { launchProvider?: string; launchModel?: string; useExistingProfile?: boolean; restore?: boolean },
): Promise<number> {
  let existingProfileDir: string | undefined;
  try {
    const lock = readExistingIdeLock();
    const separateActiveSession = lock && lock.pid !== process.pid && isProcessAlive(lock.pid);
    if (boot?.useExistingProfile || boot?.restore || !separateActiveSession) assertNoActiveExistingIdeSession();
    const pending = separateActiveSession ? null : readExistingIdeRecoveryRecord();
    if (pending) {
      acquireExistingIdeSession(pending.profileDir, process.env, { recovery: true });
      const latest = readExistingIdeRecoveryRecord();
      if (latest) {
        p.log.step('Recovering the previous Antigravity IDE profile...');
        await stopExistingIde(existingIdeControl(latest.profileDir));
        restoreExistingProfile();
      } else {
        releaseEmptyExistingIdeSession();
      }
    } else if (boot?.restore) {
      if (lock) acquireExistingIdeSession(lock.profileDir);
      releaseEmptyExistingIdeSession();
      p.log.info('Nothing to restore.');
    }
    if (boot?.restore) return 0;
    if (boot?.useExistingProfile) {
      existingProfileDir = getDefaultAntigravityIdeProfileDir();
      acquireExistingIdeSession(existingProfileDir);
    }
  } catch (error) {
    p.log.error(String(error));
    return 1;
  }
  try {
    return await runAntigravityCommand(
    'relay-ai antigravity-ide — Antigravity IDE', 'ide', trace, boot,
    async (env, _routes, gatewayHandle) => {
      if (boot?.useExistingProfile) {
        const profileDir = existingProfileDir!;
        const control = existingIdeControl(profileDir);
        acquireExistingIdeSession(profileDir);
        const shutdown = watchExistingIdeShutdown(control.isRunning);
        let started = false;
        try {
          p.log.warn('Using your existing Antigravity IDE profile and its signed-in Google account.');
          p.log.info('Relay will close the IDE, temporarily apply its model catalog, and restore the profile on exit.');
          await stopExistingIde(control);
          if (shutdown.interrupted) return 0;
          beginExistingIdeSession(profileDir, gatewayHandle.url);
          started = true;
          if (shutdown.interrupted) return 0;
          const launchCode = await launchAntigravityIde(env, profileDir, gatewayHandle.url, childArgs, { existingProfile: true });
          if (launchCode !== 0) return launchCode;
          shutdown.launched();
          p.log.info('Antigravity IDE is using Relay models. Close the IDE when you are done, or press Ctrl+C to restore your normal configuration.');
          printUiUrlLast();
          await waitForExistingIdeShutdownWithConfirm(shutdown, async () => {
            const choice = await p.select({
              message: 'Close Antigravity IDE and restore your normal configuration?',
              options: [
                { value: 'yes', label: 'Yes, close Antigravity IDE and restore config' },
                { value: 'no', label: 'No, keep session running' },
              ],
            });
            return p.isCancel(choice) || choice === 'yes';
          });
          return 0;
        } finally {
          try {
            if (started || readExistingIdeRecoveryRecord()?.pid === process.pid) {
              await stopExistingIde(control);
              restoreExistingProfile();
            } else {
              releaseEmptyExistingIdeSession();
            }
          } finally {
            shutdown.dispose();
          }
        }
      }
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
        if (!(await waitForAntigravityIdeQuit(profileDir))) {
          forceQuitAntigravityIde(profileDir);
          await waitForAntigravityIdeQuit(profileDir);
        }
      }

      const launchCode = await launchAntigravityIde(env, profileDir, gatewayHandle.url, childArgs);
      if (launchCode !== 0) return launchCode;

      p.log.info('Antigravity IDE is using the Relay Cloud Code gateway.');
      p.log.info(pc.cyan('Press Ctrl+C to stop the gateway.'));
      printUiUrlLast();
      await waitForShutdown();
      await new Promise(r => setTimeout(r, SHUTDOWN_DRAIN_MS));
      console.log('');
      p.log.step('Gateway stopped.');
      const shouldClose = await p.confirm({
        message: 'Close Antigravity IDE?',
        initialValue: true,
      });
      if (!p.isCancel(shouldClose) && shouldClose) {
        p.log.step('Stopping Antigravity IDE...');
        quitAntigravityIdeGracefully();
        if (!(await waitForAntigravityIdeQuit(profileDir))) {
          forceQuitAntigravityIde(profileDir);
          await waitForAntigravityIdeQuit(profileDir);
        }
      }
      return 0;
    },
    { childArgs, versionGuard: false, pauseForCapacityWarning: false },
  );
  } finally {
    if (existingProfileDir && !readExistingIdeRecoveryRecord()) releaseEmptyExistingIdeSession();
  }
}
