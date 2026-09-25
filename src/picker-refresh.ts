import { runProvidersRefreshModels } from './providers-command.js';
import type { LocalProvider } from './types.js';

/**
 * "↻ Refresh models" in a launch picker: refresh the provider's models from its
 * API (same as `relay-ai providers` → refresh), then swap the reloaded list into
 * `provider.models`. `reload` must rebuild the provider exactly as the launch
 * command filtered it (target compatibility, context floor, routable models).
 * On a failed refresh the stored list is unchanged, so the picker keeps it.
 */
export function pickerRefresh(
  provider: LocalProvider,
  reload: () => Promise<LocalProvider | undefined>,
): () => Promise<void> {
  return async () => {
    await runProvidersRefreshModels(provider.id);
    const fresh = await reload();
    if (fresh) provider.models = fresh.models;
  };
}
