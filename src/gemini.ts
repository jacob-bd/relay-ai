// src/gemini.ts — relay-ai gemini: launch Google Gemini CLI with registry providers
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { fetchProviderCatalog, providersForPicker, resolveLocalProviderApiKey } from './provider-catalog.js';
import { loadPreferences, recordLaunchSelection } from './config.js';
import { findProviderAndModel, planLaunchWizard, wantsCleanAgentStdout } from './launch-target.js';
import { setAgentStdoutMode, isAgentStdoutMode } from './agent-io.js';
import { findGeminiBinary, prepareGeminiChildEnv, launchGemini } from './gemini/launch.js';
import {
  pickGeminiProvider,
  pickGeminiModel,
  pickGeminiFavoriteModel,
  confirmGeminiLaunch,
  rejectGeminiManagedFlags,
} from './gemini/prompts.js';
import { startGeminiProxy } from './gemini-proxy.js';
import { getGeminiProxyDebugLogPath, printTraceLog } from './trace-log.js';
import type { ProxyRoute, ProxyHandle } from './proxy.js';
import type { CloudCodeBackend } from './cloud-code-backend.js';
import { rewriteGeminiBackendRoutes } from './gemini/backend-routes.js';
import { VERSION } from './constants.js';
import { providersForTarget } from './target-compatibility.js';

export function geminiHelpText(): string {
  return `${pc.bold('relay-ai gemini')} v${VERSION}
Launch Google Gemini CLI with OpenCode Zen / Go or local registry providers.

${pc.bold('Usage:')}
  relay-ai gemini [options] [gemini-flags]
  relay-ai gemini --help
  relay-ai gemini --version

${pc.bold('Options:')}
  --trace      Write proxy debug logs to ~/.relay-ai/logs/ and show errors on exit
  --provider   Boot provider id (skip wizard when paired with --model or non-interactive)
  --model      Boot model id (skip wizard when paired with --provider or non-interactive)
  --help       Show this command help
  --version    Show version

${pc.bold('Description:')}
  Picks a provider and model from ~/.relay-ai/providers.json, starts a local Gemini-to-SDK translation
  proxy, and launches the Gemini CLI.
  All registry models (Anthropic, OpenAI, custom endpoints, etc.) route through the local translation proxy.

${pc.bold('Prerequisites:')}
  npm install -g @google/gemini-cli

${pc.bold('Passing flags to Gemini CLI:')}
  Add Gemini flags directly — no "--" separator needed.
  relay-ai manages -m / --model and -p / --prompt; other flags go to Gemini CLI.

${pc.bold('Examples:')}
  relay-ai gemini
  relay-ai gemini --trace
  relay-ai gemini --provider zen --model gemini-2.5-flash
  relay-ai gemini -p "review this file"`;
}

export async function runGeminiCommand(
  geminiArgs: string[],
  trace = false,
  launch: { launchProvider?: string; launchModel?: string } = {},
): Promise<number> {
  if (geminiArgs.includes('--help') || geminiArgs.includes('-h')) {
    console.log(geminiHelpText());
    return 0;
  }

  const geminiPath = findGeminiBinary();
  if (!geminiPath) {
    console.error(pc.red('\nError: gemini binary not found on PATH.\n'));
    console.error('Install Google Gemini CLI:');
    console.error('  npm install -g @google/gemini-cli\n');
    return 1;
  }

  const passthroughArgs = rejectGeminiManagedFlags(geminiArgs);
  const agentStdout = wantsCleanAgentStdout('gemini', passthroughArgs);
  setAgentStdoutMode(agentStdout);

  const prefs = loadPreferences();
  const launchPlan = planLaunchWizard({
    explicit: { providerId: launch.launchProvider, modelId: launch.launchModel },
    childArgs: passthroughArgs,
    agent: 'gemini',
    prefs,
  });

  if (launchPlan.error) {
    console.error(pc.red(`\nError: ${launchPlan.error}\n`));
    return 1;
  }

  let catalog;
  if (agentStdout) {
    try {
      catalog = await fetchProviderCatalog({ agent: 'gemini' });
    } catch (err) {
      console.error(pc.red(String(err instanceof Error ? err.message : err)));
      return 1;
    }
  } else {
    const catalogSpinner = p.spinner();
    catalogSpinner.start('Loading your providers...');
    try {
      catalog = await fetchProviderCatalog({ agent: 'gemini' });
    } catch (err) {
      catalogSpinner.stop('');
      console.error(pc.red(String(err instanceof Error ? err.message : err)));
      return 1;
    }
    catalogSpinner.stop('');
  }

  const compatible = providersForTarget(providersForPicker(catalog), 'gemini');
  if (compatible.length === 0) {
    p.log.warn('No Gemini-compatible providers in your registry.');
    p.log.info('Add a provider with relay-ai providers add, or sign in with relay-ai providers auth openai-oauth.');
    return 0;
  }

  let activeProvider = compatible.find(lp => lp.id === prefs.lastGeminiProvider) ?? compatible[0]!;
  let selectedModel = activeProvider.models.find(m => m.id === prefs.lastGeminiModel) ?? activeProvider.models[0];
  if (!selectedModel) {
    p.log.error(`Provider "${activeProvider.name}" has no models available.`);
    return 1;
  };

  if (launchPlan.skip && launchPlan.target) {
    const resolved = findProviderAndModel(compatible, launchPlan.target);
    if (!resolved) {
      p.log.error(
        `Provider/model not found: ${launchPlan.target.providerId} / ${launchPlan.target.modelId}`,
      );
      return 1;
    }
    activeProvider = resolved.provider;
    selectedModel = resolved.model;
    if (!agentStdout) {
      p.log.step(`Using ${selectedModel.name || selectedModel.id} (${activeProvider.name})`);
    }
  } else {
    if (!agentStdout) {
      console.log('');
      p.log.info(`Launching ${pc.bold('Gemini CLI')} with relay-ai`);
    }

    const chosenProvider = await pickGeminiProvider(
      compatible,
      prefs,
      (prefs.favoriteModels ?? []).length > 0,
      launch.launchProvider,
    );
    if (!chosenProvider) return 0;

    if (chosenProvider === '__favorites__') {
      const favPick = await pickGeminiFavoriteModel(compatible, prefs.favoriteModels ?? []);
      if (!favPick || favPick === 'back') return 0;
      activeProvider = favPick.provider;
      selectedModel = favPick.model;
    } else {
      activeProvider = chosenProvider;
      const chosenModel = await pickGeminiModel(activeProvider, prefs);
      if (!chosenModel || chosenModel === 'back') return 0;
      selectedModel = chosenModel;
    }

    if (!agentStdout) {
      const ok = await confirmGeminiLaunch(
        activeProvider.name,
        selectedModel.name || selectedModel.id,
        selectedModel.id,
      );
      if (!ok) return 0;
    }
  }

  // Save selected provider/model preferences
  recordLaunchSelection('gemini', activeProvider.id, selectedModel.id, prefs);

  const launchApiKey = await resolveLocalProviderApiKey(activeProvider);
  if (!launchApiKey?.trim()) {
    p.log.error(
      `No API key found for ${activeProvider.name}. Set it with relay-ai providers add.`,
    );
    return 1;
  }

  // Build route mapping for proxy catalog
  const providerRoutes: ProxyRoute[] = activeProvider.models.map(m => ({
    aliasId: m.id,
    realModelId: m.upstreamModelId || m.id,
    displayName: m.name || m.id,
    upstreamUrl: m.baseUrl || m.apiBaseUrl || '',
    apiKey: launchApiKey,
    modelFormat: m.modelFormat,
    contextWindow: m.contextWindow,
    npm: m.npm,
    baseURL: m.apiBaseUrl,
    providerId: activeProvider.id,
    authType: activeProvider.authType,
    oauthAccountId: activeProvider.oauthAccountId,
    providerData: activeProvider.providerData,
    headers: activeProvider.headers,
    supportedParameters: m.supportedParameters,
    reasoning: m.reasoning,
    interleavedReasoningField: m.interleavedReasoningField,
  }));

  // Resolve and append favorites to proxy routes
  const resolvedFavs: ProxyRoute[] = [];
  const favorites = prefs.favoriteModels ?? [];
  for (const fav of favorites) {
    const provider = compatible.find(lp => lp.id === fav.providerId);
    const model = provider?.models.find(m => m.id === fav.modelId);
    if (provider && model) {
      const apiKey = await resolveLocalProviderApiKey(provider);
      if (apiKey) {
        resolvedFavs.push({
          aliasId: model.id,
          realModelId: model.upstreamModelId || model.id,
          displayName: model.name || model.id,
          upstreamUrl: model.baseUrl || model.apiBaseUrl || '',
          apiKey,
          modelFormat: model.modelFormat,
          contextWindow: model.contextWindow,
          npm: model.npm,
          baseURL: model.apiBaseUrl,
          providerId: provider.id,
          authType: provider.authType,
          oauthAccountId: provider.oauthAccountId,
          providerData: provider.providerData,
          headers: provider.headers,
          supportedParameters: model.supportedParameters,
          reasoning: model.reasoning,
          interleavedReasoningField: model.interleavedReasoningField,
        });
      }
    }
  }

  const routesMap = new Map<string, ProxyRoute>();
  for (const route of providerRoutes) {
    routesMap.set(route.aliasId, route);
  }
  for (const route of resolvedFavs) {
    if (!routesMap.has(route.aliasId)) {
      routesMap.set(route.aliasId, route);
    }
  }

  // Ensure starting model is in routing catalog
  const startingRoute = routesMap.get(selectedModel.id);
  if (!startingRoute) {
    routesMap.set(selectedModel.id, {
      aliasId: selectedModel.id,
      realModelId: selectedModel.upstreamModelId || selectedModel.id,
      displayName: selectedModel.name || selectedModel.id,
      upstreamUrl: selectedModel.baseUrl || selectedModel.apiBaseUrl || '',
      apiKey: launchApiKey,
      modelFormat: selectedModel.modelFormat,
      contextWindow: selectedModel.contextWindow,
      npm: selectedModel.npm,
      baseURL: selectedModel.apiBaseUrl,
      providerId: activeProvider.id,
      authType: activeProvider.authType,
      oauthAccountId: activeProvider.oauthAccountId,
      providerData: activeProvider.providerData,
      headers: activeProvider.headers,
      supportedParameters: selectedModel.supportedParameters,
      reasoning: selectedModel.reasoning,
      interleavedReasoningField: selectedModel.interleavedReasoningField,
    });
  }

  let finalRoutes = [...routesMap.values()];
  // Backend-routed models get rewritten to a new local alias below — this tracks
  // what selectedModel.id becomes so Gemini CLI is launched with the id its
  // requests will actually be resolved by, not the pre-rewrite one.
  let launchModelId = selectedModel.id;
  let oauthBackend: CloudCodeBackend | null = null;

  let proxyHandle: ProxyHandle | null = null;
  try {
    const backendRoutes = await rewriteGeminiBackendRoutes(finalRoutes, launchModelId, trace);
    finalRoutes = backendRoutes.routes;
    launchModelId = backendRoutes.launchModelId;
    oauthBackend = backendRoutes.backend;
    proxyHandle = await startGeminiProxy(finalRoutes, trace);
  } catch (err) {
    p.log.error(`Failed to start Gemini proxy: ${err instanceof Error ? err.message : String(err)}`);
    oauthBackend?.handle.close();
    return 1;
  }

  const childEnv = prepareGeminiChildEnv(proxyHandle.port, proxyHandle.token);

  if (!agentStdout) {
    p.log.info(`Gemini proxy started on port ${proxyHandle.port}`);
    p.log.info(`💡 Type ${pc.bold('.model <id>')} in the chat to switch models mid-session.`);
  }

  let exitCode = 1;
  try {
    exitCode = await launchGemini(geminiPath, launchModelId, childEnv.env, passthroughArgs);
  } finally {
    childEnv.cleanup();
    proxyHandle.close();
    oauthBackend?.handle.close();
  }

  if (!agentStdout) {
    p.log.info('Gemini proxy stopped.');
  }

  if (trace) {
    printTraceLog(getGeminiProxyDebugLogPath());
  }

  return exitCode;
}
