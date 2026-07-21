export type {
  CachedModel,
  ProviderRegistry,
  RegistryProvider,
  RegistrySubscriptionFilter,
} from './types.js';
export { REGISTRY_SCHEMA_VERSION } from './types.js';
export { isValidProviderId, slugifyProviderId, customProviderId, PROVIDER_ID_PATTERN } from './validate.js';
export { materializeRegistry, type CredentialResolver } from './materialize.js';
export {
  ensureSecureAppHome,
  emptyRegistry,
  loadRegistry,
  saveRegistry,
} from './io.js';
export { localProviderToRegistry } from './convert.js';
export { importFromOpencode, type ImportOpencodeResult } from './import-opencode.js';
export { loadRegistryProviders, loadRegistryProvidersSync } from './load.js';
export {
  addGoRegistryStub,
  addZenRegistryStub,
  ensureOpencodeCloudProviders,
  removeProviderFromRegistry,
  toggleProviderEnabled,
} from './crud.js';
