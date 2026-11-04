import { createLanguageModel, effortProviderOptions } from '../provider-factory.js';
import { resolveLocalProviderApiKey } from '../provider-catalog.js';
import { providerRefreshToken } from '../provider-runtime.js';
import { classifyFreeStatus } from '../free-models.js';
import type { FavoriteModel, LocalProvider, LocalProviderModel } from '../types.js';
import { verifyPoolMember, type EnrollResult } from './enroll.js';
import { probePoolModel, probePoolEffort, type PoolProbeResult } from './probe.js';

/** Membership may be saved before its context size has been measured. */
export function poolMembershipProblem(provider: LocalProvider, model: LocalProviderModel): string | undefined {
  if (classifyFreeStatus({ model, providerId: provider.id }) !== 'verified_free') return 'Requires verified zero pricing';
  if (!model.npm || model.modelFormat === 'cloud-code') return 'Unsupported pool transport';
  return undefined;
}

/** Routing evidence additionally needs a trustworthy context window. */
export function poolRoutingProblem(provider: LocalProvider, model: LocalProviderModel): string | undefined {
  const membership = poolMembershipProblem(provider, model);
  if (membership) return membership;
  if (model.contextWindowEstimated) return 'Set or measure the context size before Relay can route this model';
  if (!Number.isSafeInteger(model.contextWindow) || !model.contextWindow || model.contextWindow <= 0) {
    return 'A verified context size is required';
  }
  return undefined;
}

/** Guess or missing size: refuse before any provider call, without credentials in the message. */
function enrollmentContextProblem(model: LocalProviderModel): boolean {
  return Boolean(model.contextWindowEstimated)
    || !Number.isSafeInteger(model.contextWindow) || !model.contextWindow || model.contextWindow <= 0;
}

/** Error text for pool diagnostics; strips anything that looks like a credential. */
export function poolDiagnostic(error: unknown): string | undefined {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const redacted = text
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]')
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{6,}/gi, '[redacted]')
    .replace(/\b(?:sk|pk|rk|api[-_]?key|token|secret|authorization)[-_A-Za-z0-9]*\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{6,}/gi,
      '[redacted]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return redacted ? redacted.slice(0, 160) : undefined;
}

/** One canonical enrollment path shared by CLI and the UI Test action. */
export async function verifyConfiguredPoolMember(
  member: FavoriteModel,
  providers: readonly LocalProvider[],
  signal: AbortSignal,
  options: { evidence?: PoolProbeResult; reasoning?: boolean } = {},
): Promise<EnrollResult> {
  const provider = providers.find(item => item.id === member.providerId);
  const model = provider?.models.find(item => item.id === member.modelId);
  if (!provider || !model) return { member, status: 'skipped', reason: 'unavailable' };
  if (enrollmentContextProblem(model)) return { member, status: 'skipped', reason: 'unverified-context-window' };
  const routingProblem = poolRoutingProblem(provider, model);
  if (routingProblem) return { member, status: 'skipped', reason: routingProblem };
  try {
    return await verifyPoolMember(member, providers, signal, {
      resolveKey: resolveLocalProviderApiKey,
      createModel: (provider, model, apiKey) => createLanguageModel({
        npm: model.npm!, modelId: model.upstreamModelId, apiKey, baseURL: model.apiBaseUrl,
        providerId: provider.id, authType: provider.authType, oauthAccountId: provider.oauthAccountId,
        providerData: provider.providerData, headers: provider.headers,
        refreshToken: providerRefreshToken(provider.id, provider.authType, provider.authRef),
      }),
      probe: options.evidence ? async () => options.evidence! : probePoolModel,
      probeEffort: options.reasoning ? (languageModel, level) => probePoolEffort(languageModel,
        effortProviderOptions(model.npm!, level, model.upstreamModelId, {
          ...model, providerId: provider.id, apiBaseUrl: model.apiBaseUrl,
        }) as never, signal) : undefined,
    });
  } catch (error) {
    // A probe failure is pool evidence only; the caller's ordinary Test stays successful.
    return { member, status: 'skipped', reason: 'probe-failed', diagnostic: poolDiagnostic(error) };
  }
}
