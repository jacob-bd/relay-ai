import type { CodexProxyRoute } from '../codex-proxy.js';
import type { ResolvedCodexMixedModels } from './favorites-launch.js';
import { buildCodexProxyRoutesFromResolved } from './favorites-launch.js';
import { codexCliFavoritesSlug } from './favorites-catalog.js';
import { composeMixedCodexCatalog, mixedRelaySlug } from './mixed-catalog.js';
import type { NativeCodexCatalogSnapshot } from './native-catalog.js';
import { createMixedProxyCapability } from './routing.js';
import {
  needsCloudCodeBackend,
  partitionAndStartCloudCodeBackend,
  type CloudCodeBackend,
} from '../cloud-code-backend.js';
import type { LocalProviderModel } from '../types.js';

export interface CodexMixedLaunchPlan {
  selectedSlug: string;
  nativeCatalog: NativeCodexCatalogSnapshot;
  catalog: ReturnType<typeof composeMixedCodexCatalog>;
  relayRoutes: CodexProxyRoute[];
  nativeModelIds: Set<string>;
  subagentModelCount: number;
  subagentRouteModelId?: string;
  multiAgentV2Enabled: boolean;
  nativePayloadRelayModel: string;
  capability: string;
}

export interface PreparedCodexMixedRelayRoutes {
  routes: CodexProxyRoute[];
  cloudCodeBackend: CloudCodeBackend | null;
}

/**
 * Build the outer Codex routes for mixed mode. Cloud Code/OAuth-Anthropic
 * models must first pass through Relay's existing Cloud Code backend; all
 * other models use the normal Responses SDK route. Keeping that partition
 * here prevents mixed mode from accidentally sending a Cloud Code model to
 * an empty/invalid SDK base URL.
 */
export async function prepareCodexMixedRelayRoutes(
  models: ResolvedCodexMixedModels,
  trace = false,
): Promise<PreparedCodexMixedRelayRoutes> {
  const backendResolved = models.all.filter(entry => {
    const provider = models.providersById.get(entry.providerId);
    return needsCloudCodeBackend(entry.model as LocalProviderModel, provider?.authType);
  });
  const regularResolved = models.all.filter(entry => !backendResolved.includes(entry));

  let cloudCodeBackend: CloudCodeBackend | null = null;
  let backendRoutes: CodexProxyRoute[] = [];
  if (backendResolved.length > 0) {
    const partitioned = await partitionAndStartCloudCodeBackend(
      backendResolved.map(entry => {
        const provider = models.providersById.get(entry.providerId);
        if (!provider) throw new Error(`Provider ${entry.providerId} is unavailable for mixed Codex mode`);
        return {
          providerId: entry.providerId,
          model: entry.model as LocalProviderModel,
          apiKey: entry.apiKey,
          oauthAccountId: provider.oauthAccountId,
          providerData: (provider.providerData ?? {}) as Record<string, unknown>,
        };
      }),
      (proxyRoute, backend, original) => ({
        modelId: codexCliFavoritesSlug(original.providerId, original.model.id),
        npm: '@ai-sdk/anthropic',
        apiKey: backend.token,
        baseURL: `http://127.0.0.1:${backend.port}`,
        upstreamModelId: proxyRoute.aliasId,
        providerId: original.providerId,
        authType: 'oauth' as const,
        oauthAccountId: original.oauthAccountId,
        providerData: original.providerData,
        contextWindow: proxyRoute.contextWindow,
      }),
      trace,
    );
    cloudCodeBackend = partitioned.backend;
    backendRoutes = partitioned.backendItems;
  }

  return {
    routes: [...backendRoutes, ...buildCodexProxyRoutesFromResolved(regularResolved, models.providersById)],
    cloudCodeBackend,
  };
}

function selectNativePayloadRelayModel(models: NativeCodexCatalogSnapshot['models']): string {
  for (const preferred of ['gpt-5.4-mini', 'gpt-5.4']) {
    if (models.some(model => model.slug === preferred)) return preferred;
  }
  const fallback = models.find(model => model.visibility === 'list' && model.multi_agent_version !== 'disabled');
  if (!fallback) throw new Error('Mixed Codex mode requires one native model for collaboration payload relay');
  return fallback.slug;
}

export function buildCodexMixedLaunchPlan(input: {
  nativeCatalog: NativeCodexCatalogSnapshot;
  models: ResolvedCodexMixedModels;
  relayRoutes?: CodexProxyRoute[];
  multiAgentV2Supported?: boolean;
}): CodexMixedLaunchPlan {
  const relayRoutes = input.relayRoutes ?? buildCodexProxyRoutesFromResolved(input.models.all, input.models.providersById);
  const routeByKey = new Set(relayRoutes.map(route => route.modelId));
  const visibleRelay = input.models.visible
    .map(resolved => ({ resolved, slug: mixedRelaySlug(resolved.providerId, resolved.model.id) }))
    .filter(entry => routeByKey.has(entry.slug));
  const subagentRelay = input.models.subagents
    .map(resolved => ({ resolved, slug: mixedRelaySlug(resolved.providerId, resolved.model.id) }))
    .filter(entry => routeByKey.has(entry.slug));
  const selectedSlug = codexCliFavoritesSlug(input.models.selected.providerId, input.models.selected.model.id);
  const hasSubagents = input.models.subagents.length > 0;
  if (input.models.subagents.length > 1) {
    throw new Error('Codex mixed mode supports exactly one Relay Sub-agent model');
  }
  if (hasSubagents && input.multiAgentV2Supported === false) {
    throw new Error('Configured Codex Sub-agents require a Codex runtime with multi_agent_v2 support');
  }
  const multiAgent: 'v1' | 'v2' = input.nativeCatalog.models.some(model => model.multi_agent_version === 'v2')
    ? 'v2'
    : 'v1';
  const multiAgentV2Enabled = hasSubagents && input.multiAgentV2Supported === true;
  return {
    selectedSlug,
    nativeCatalog: input.nativeCatalog,
    catalog: composeMixedCodexCatalog({
      nativeModels: input.nativeCatalog.models,
      visibleRelay,
      subagentRelay,
      selectedSlug,
      externalMultiAgentVersion: multiAgent,
    }),
    relayRoutes,
    nativeModelIds: new Set(input.nativeCatalog.models.map(model => model.slug)),
    subagentModelCount: input.models.subagents.length,
    subagentRouteModelId: subagentRelay[0]?.slug,
    multiAgentV2Enabled,
    nativePayloadRelayModel: selectNativePayloadRelayModel(input.nativeCatalog.models),
    capability: createMixedProxyCapability(),
  };
}
