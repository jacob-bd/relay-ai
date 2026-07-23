// src/core/catalog.ts — credential-free model catalog for embedded consumers.

import { loadPreferences } from '../config.js';
import { getReasoningCapabilities } from '../provider-factory.js';
import { loadRegistry } from '../registry/io.js';
import { REGISTRY_SCHEMA_VERSION, type CachedModel, type ProviderRegistry, type RegistryProvider } from '../registry/types.js';
import { RelayCoreError } from './errors.js';
import { toRelayRouteId } from './route-id.js';
import type { RelayModelDescriptor } from './types.js';

/** Read the registry without ever persisting migrations, and reject newer schemas. */
export function loadCoreRegistry(path?: string): ProviderRegistry {
  const registry = loadRegistry(path, { persist: false });
  if (registry.schemaVersion > REGISTRY_SCHEMA_VERSION) {
    throw new RelayCoreError(
      'UNSUPPORTED_REGISTRY_VERSION',
      `Registry schema v${registry.schemaVersion} is newer than supported v${REGISTRY_SCHEMA_VERSION} — upgrade relay-ai.`,
    );
  }
  return registry;
}

type ReasoningInfo = RelayModelDescriptor['capabilities'];

function mapReasoning(provider: RegistryProvider, model: CachedModel): ReasoningInfo {
  const base = { tools: 'unknown' as const, vision: 'unknown' as const };
  const npm = model.npm ?? provider.api.npm ?? '';
  const upstreamModelId = model.upstreamModelId ?? model.id;
  try {
    const caps = getReasoningCapabilities(npm, upstreamModelId, {
      providerId: provider.id,
      apiBaseUrl: model.apiUrl ?? provider.api.url,
      supportedParameters: model.supportedParameters,
      reasoning: model.reasoning,
      interleavedReasoningField: model.interleavedReasoningField,
      upstreamModelId,
    });
    switch (caps.mode) {
      case 'none':
        return { ...base, reasoning: 'none' };
      case 'internal-only':
        return { ...base, reasoning: 'fixed' };
      case 'controllable':
        return {
          ...base,
          reasoning: 'adjustable',
          reasoningLevels: [...caps.levels],
          defaultReasoningLevel: caps.defaultLevel,
        };
      default:
        return { ...base, reasoning: 'unknown' };
    }
  } catch {
    // Reasoning classification is best-effort; never fail the catalog over it.
    return { ...base, reasoning: 'unknown' };
  }
}

function favoriteKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

function toDescriptor(provider: RegistryProvider, model: CachedModel, favorites: Set<string>): RelayModelDescriptor {
  const upstreamModelId = model.upstreamModelId ?? model.id;
  return {
    routeId: toRelayRouteId(provider.id, model.id),
    providerId: provider.id,
    providerName: provider.name,
    modelId: model.id,
    upstreamModelId,
    displayName: model.name,
    authType: provider.authType ?? 'api',
    favorite: favorites.has(favoriteKey(provider.id, model.id)),
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(model.cost
      ? {
          pricing: {
            input: model.cost.input,
            output: model.cost.output,
            ...(model.cost.cache_read !== undefined ? { cacheRead: model.cost.cache_read } : {}),
            ...(model.cost.cache_write !== undefined ? { cacheWrite: model.cost.cache_write } : {}),
          },
        }
      : {}),
    capabilities: mapReasoning(provider, model),
  };
}

/**
 * List the credential-free model catalog: one descriptor per cached model of
 * every enabled provider. Never resolves credentials, refreshes OAuth, hits a
 * provider API, or writes to disk.
 */
export function listRelayModels(registryPath?: string): RelayModelDescriptor[] {
  const registry = loadCoreRegistry(registryPath);
  const favorites = new Set(
    (loadPreferences().favoriteModels ?? []).map(f => favoriteKey(f.providerId, f.modelId)),
  );

  const descriptors: RelayModelDescriptor[] = [];
  for (const provider of registry.providers) {
    if (!provider.enabled) continue;
    for (const model of provider.modelsCache?.models ?? []) {
      descriptors.push(toDescriptor(provider, model, favorites));
    }
  }

  return descriptors.sort((a, b) =>
    Number(b.favorite) - Number(a.favorite)
    || a.providerName.localeCompare(b.providerName)
    || a.displayName.localeCompare(b.displayName),
  );
}
