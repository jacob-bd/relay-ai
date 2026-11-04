import type { PoolProbeResult } from '../pool/probe.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadPreferences, savePreferences } from '../config.js';
import { fetchProviderCatalog } from '../provider-catalog.js';
import { classifyFreeStatus } from '../free-models.js';
import { readBody, sendJson } from '../http-utils.js';
import { loadRegistry } from '../registry/io.js';
import { guessModelKindFromName, nameKindOutranksChatTest, type ModelKind } from '../registry/model-kind.js';
import { modelsDevModelKind } from '../registry/models-dev.js';
import { addFreePoolMember, parseFreePool, removeFreePoolMember } from '../pool/membership.js';
import { currentPoolReceipt, poolEndpointRevision } from '../pool/capabilities.js';
import { poolDiagnostic, poolMembershipProblem, poolRoutingProblem, verifyConfiguredPoolMember } from '../pool/verify.js';
import type { FavoriteModel, FreePoolPreferences, LocalProvider, LocalProviderModel } from '../types.js';

const verifying = new Set<string>();
const memberKey = (member: FavoriteModel) => JSON.stringify([member.providerId, member.modelId]);

function revision(provider: LocalProvider, model: LocalProviderModel) {
  return poolEndpointRevision({ providerId: provider.id, authRef: provider.authRef, npm: model.npm!,
    baseURL: model.apiBaseUrl, upstreamModelId: model.upstreamModelId, headers: provider.headers });
}

/** Kept in step with the Providers table's model-kind precedence. */
function candidateKind(providerId: string, modelId: string): { kind?: ModelKind | 'not-chat'; kindSource?: string } {
  const provider = loadRegistry().providers.find(item => item.id === providerId);
  if (!provider) return {};
  const manual = provider.modelKindOverrides?.[modelId];
  if (manual) return { kind: manual, kindSource: 'manual' };
  if (provider.nonChatModelIds?.includes(modelId)) return { kind: 'not-chat', kindSource: 'test' };
  const guessed = guessModelKindFromName(modelId);
  if (provider.chatModelIds?.includes(modelId)) {
    return nameKindOutranksChatTest(guessed) ? { kind: guessed, kindSource: 'name' } : { kind: 'chat', kindSource: 'test' };
  }
  const known = modelsDevModelKind(provider.id, modelId);
  if (known) return { kind: known, kindSource: 'models.dev' };
  return guessed ? { kind: guessed, kindSource: 'name' } : {};
}

function isFreeListEntry(model: LocalProviderModel): boolean {
  return Boolean(model.isFree || model.freeStatus === 'verified_free' || model.freeStatus === 'free_provider'
    || (model.cost && model.cost.input === 0 && model.cost.output === 0));
}

function modelMetadata(provider: LocalProvider, model: LocalProviderModel) {
  const freeStatus = classifyFreeStatus({ model, providerId: provider.id });
  return {
    providerId: provider.id, providerName: provider.name,
    modelId: model.id, name: model.name ?? model.id,
    family: model.family, brand: model.brand,
    reasoningTestRequests: model.reasoning ? 1 + Math.min(4, new Set((model.reasoningEffortLevels ?? []).filter(level => ['low', 'medium', 'high', 'xhigh', 'max'].includes(level))).size || 1) : 1,
    contextWindow: model.contextWindow, contextWindowEstimated: model.contextWindowEstimated === true,
    cost: model.cost, freeStatus, ...candidateKind(provider.id, model.id),
  };
}

function poolMember(pool: FreePoolPreferences, member: FavoriteModel) {
  return pool.members.some(item => item.providerId === member.providerId && item.modelId === member.modelId);
}

function saveReceipts(member: FavoriteModel, receipt: FreePoolPreferences['receipts'][number] | undefined) {
  // Reload after network work so a concurrent add/remove/reorder is retained.
  const current = parseFreePool(loadPreferences().freePool);
  const next = parseFreePool({
    ...current,
    receipts: [
      ...current.receipts.filter(item => item.member.providerId !== member.providerId || item.member.modelId !== member.modelId),
      ...(receipt ? [receipt] : []),
    ],
  });
  savePreferences({ freePool: next });
  return next;
}

/**
 * Drops stale pool evidence after a failed responsiveness Test. Membership is
 * untouched: the model stays saved but stops routing until tested again.
 */
export function invalidateUiPoolMember(providerId: string, modelId: string): boolean {
  try {
    const current = parseFreePool(loadPreferences().freePool);
    const receipts = current.receipts.filter(item =>
      item.member.providerId !== providerId || item.member.modelId !== modelId);
    if (receipts.length === current.receipts.length) return false;
    savePreferences({ freePool: parseFreePool({ ...current, receipts }) });
    return true;
  } catch {
    return false;
  }
}

export interface PoolUiVerification {
  ok: boolean;
  status: 'verified' | 'skipped';
  reason?: string;
  /** Sanitized probe detail; never contains credentials. */
  diagnostic?: string;
  receipt?: FreePoolPreferences['receipts'][number];
}

/**
 * Reuses the explicit Test action as pool evidence for an eligible free model.
 * A model does not need to be a member first: the receipt is cached for a later
 * Add to Pool. Any pool failure is reported in the result and never thrown, so
 * a successful responsiveness Test stays successful.
 */
export async function verifyUiPoolMember(
  providerId: string,
  modelId: string,
  signal: AbortSignal,
  options: { evidence?: PoolProbeResult; reasoning?: boolean } = {},
): Promise<PoolUiVerification | undefined> {
  try {
    const providers = await fetchProviderCatalog();
    const provider = providers.find(item => item.id === providerId);
    const model = provider?.models.find(item => item.id === modelId);
    const member = { providerId, modelId };
    // Paid or hidden models are outside the free pool entirely: no pool work at all.
    if (!provider || !model || poolMembershipProblem(provider, model)) return undefined;
    if (poolRoutingProblem(provider, model)) return { ok: false, status: 'skipped', reason: 'unverified-context-window' };
    const key = memberKey(member);
    if (verifying.has(key)) return { ok: false, status: 'skipped', reason: 'verification-in-progress' };
    verifying.add(key);
    try {
      const result = await verifyConfiguredPoolMember(member, providers, signal, options);
      if (result.status !== 'verified') {
        // A failed recheck must not leave an older receipt routing this model.
        try {
          saveReceipts(member, undefined);
        } catch (error) {
          return { ok: false, status: 'skipped', reason: 'receipt-save-failed', diagnostic: poolDiagnostic(error) };
        }
        return { ok: false, status: 'skipped', reason: result.reason,
          ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}) };
      }
      try {
        saveReceipts(member, result.receipt);
      } catch (error) {
        return { ok: false, status: 'skipped', reason: 'receipt-save-failed', diagnostic: poolDiagnostic(error) };
      }
      return { ok: true, status: 'verified', receipt: result.receipt };
    } finally {
      verifying.delete(key);
    }
  } catch (error) {
    return { ok: false, status: 'skipped', reason: 'pool-verification-failed', diagnostic: poolDiagnostic(error) };
  }
}

export async function handlePoolApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const providers = await fetchProviderCatalog();
    let pool = parseFreePool(loadPreferences().freePool);
    if (req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      // Never accept capability receipts supplied by a browser.
      if ('receipts' in body) throw new Error('Capability receipts are created only by verification');
      if (body.action === 'effort') pool = parseFreePool({ ...pool, effort: body.effort });
      else if (body.action === 'enabled') {
        if (typeof body.enabled !== 'boolean') throw new Error('enabled must be true or false');
        pool = parseFreePool({ ...pool, enabled: body.enabled });
      } else {
        const member = { providerId: body.providerId, modelId: body.modelId };
        if (typeof member.providerId !== 'string' || typeof member.modelId !== 'string') throw new Error('Choose a provider account and model');
        const index = pool.members.findIndex(item => item.providerId === member.providerId && item.modelId === member.modelId);
        if (body.action === 'add') {
          const provider = providers.find(item => item.id === member.providerId);
          const model = provider?.models.find(item => item.id === member.modelId);
          if (!provider || !model) throw new Error('Model is unavailable or hidden');
          const reason = poolMembershipProblem(provider, model);
          if (reason) throw new Error(reason);
          pool = addFreePoolMember(pool, member);
        } else if (body.action === 'remove') pool = removeFreePoolMember(pool, member);
        else if (body.action === 'move') {
          if (index < 0 || ![-1, 1].includes(body.direction)) throw new Error('Invalid priority change');
          const next = index + body.direction;
          if (next >= 0 && next < pool.members.length) [pool.members[index], pool.members[next]] = [pool.members[next]!, pool.members[index]!];
        } else if (body.action === 'verify') {
          // Backward-compatible explicit endpoint; the normal UI reuses Test instead.
          if (index < 0) throw new Error('Add the model to the pool first');
          const provider = providers.find(item => item.id === member.providerId);
          const model = provider?.models.find(item => item.id === member.modelId);
          if (!provider || !model) throw new Error('Model is unavailable or hidden');
          const result = await verifyUiPoolMember(member.providerId, member.modelId, AbortSignal.timeout(body.reasoning === true ? 100_000 : 20_000), { reasoning: body.reasoning === true });
          if (!result) throw new Error('Model is not eligible for the free pool');
          if (!result.ok) throw new Error(result.reason ?? 'Verification failed');
          // The helper saved receipts into a fresh read; keep them instead of writing our stale copy.
          pool = parseFreePool(loadPreferences().freePool);
        } else throw new Error('Unknown pool action');
      }
      savePreferences({ freePool: pool });
      sendJson(res, 200, { ok: true });
      return;
    }
    sendJson(res, 200, poolView(providers, pool));
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'Unable to update the free pool' });
  }
}

export function poolView(providers: LocalProvider[], pool: FreePoolPreferences) {
  const members = pool.members.map(raw => {
    const provider = providers.find(item => item.id === raw.providerId);
    const model = provider?.models.find(item => item.id === raw.modelId);
    if (!provider || !model) return { ...raw, name: raw.modelId, providerName: raw.providerId,
      status: 'Unavailable', reason: 'Model is unavailable or hidden', targets: [], effortLevels: [] };
    const membershipProblem = poolMembershipProblem(provider, model);
    const routingProblem = poolRoutingProblem(provider, model);
    const receipt = membershipProblem ? undefined : currentPoolReceipt(pool.receipts, raw, revision(provider, model), Date.now());
    return { ...modelMetadata(provider, model), ...raw,
      status: membershipProblem ? 'Unavailable' : routingProblem ? 'Needs test' : receipt ? 'Ready' : 'Needs test',
      reason: membershipProblem ?? routingProblem,
      targets: receipt?.targets ?? [], expiresAt: receipt?.expiresAt, effortLevels: receipt?.effortLevels ?? [] };
  });
  // This is the same free-only universe shown by the Providers table. Models
  // that the pool cannot transport stay visible with an explanation so the
  // Free Pool total never silently differs from the free catalog.
  const candidates = providers.flatMap(provider => provider.models
    .filter(model => !model.hidden && isFreeListEntry(model))
    .map(model => {
      const membershipProblem = poolMembershipProblem(provider, model);
      return { ...modelMetadata(provider, model),
        alreadyAdded: poolMember(pool, { providerId: provider.id, modelId: model.id }),
        canAdd: !membershipProblem, addReason: membershipProblem,
        canRouteUntilTested: poolRoutingProblem(provider, model) === undefined };
    }));
  return { enabled: pool.enabled === true, members, candidates, effort: pool.effort };
}
