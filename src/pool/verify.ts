import { createLanguageModel, effortProviderOptions } from '../provider-factory.js';
import { resolveLocalProviderApiKey } from '../provider-catalog.js';
import { providerRefreshToken } from '../provider-runtime.js';
import type { FavoriteModel, LocalProvider } from '../types.js';
import { verifyPoolMember } from './enroll.js';
import { probePoolModel, probePoolEffort } from './probe.js';

/** Shared enrollment flow for explicit CLI and UI verification. */
export function verifyConfiguredPoolMember(member: FavoriteModel, providers: readonly LocalProvider[], signal: AbortSignal) {
  const provider = providers.find(item => item.id === member.providerId);
  const model = provider?.models.find(item => item.id === member.modelId);
  return verifyPoolMember(member, providers, signal, {
    resolveKey: resolveLocalProviderApiKey,
    createModel: (provider, model, apiKey) => createLanguageModel({
      npm: model.npm!, modelId: model.upstreamModelId, apiKey, baseURL: model.apiBaseUrl,
      providerId: provider.id, authType: provider.authType, oauthAccountId: provider.oauthAccountId,
      providerData: provider.providerData, headers: provider.headers,
      refreshToken: providerRefreshToken(provider.id, provider.authType, provider.authRef),
    }),
    probe: probePoolModel,
    probeEffort: provider && model ? (languageModel, level) => probePoolEffort(languageModel,
      effortProviderOptions(model.npm!, level, model.upstreamModelId, {
        ...model, providerId: provider.id, apiBaseUrl: model.apiBaseUrl,
      }) as never, signal) : undefined,
  });
}
