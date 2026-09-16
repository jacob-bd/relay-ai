import { BACKENDS, classifyModelFormat } from '../constants.js';
import { findModelsDevModel, loadModelsDevCache, type ModelsDevCacheFile } from './models-dev.js';
import type { CachedModel, RegistryProvider } from './types.js';

/**
 * Reconcile an automatically fetched Zen/Go model with the current provider
 * metadata. Registry caches can be older than models.dev and may retain the
 * old OpenAI-compatible default after a gateway adds a Messages route.
 * Manual entries and providers outside the built-in OpenCode backends retain
 * their explicit routing fields.
 */
export function reconcileCachedModelProtocol(
  model: CachedModel,
  provider: RegistryProvider,
  metadata: ModelsDevCacheFile = loadModelsDevCache(),
): CachedModel {
  if (model.source === 'manual') return model;
  const isZenGo = provider.id === 'zen' || provider.id === 'go'
    || provider.templateId === 'zen' || provider.templateId === 'go';
  if (!isZenGo) return model;

  const metadataNpm = findModelsDevModel(provider.id, model.id, metadata)?.provider?.npm;
  if (!metadataNpm) return model;
  const format = classifyModelFormat(model.id, metadataNpm);
  if (format === 'unsupported') return model;

  const backendId = provider.id === 'go' || provider.templateId === 'go' ? 'go' : 'zen';
  const apiUrl = model.apiUrl ?? provider.api.url ?? BACKENDS[backendId].baseUrl;
  return {
    ...model,
    modelFormat: format,
    npm: metadataNpm,
    apiUrl,
  };
}
