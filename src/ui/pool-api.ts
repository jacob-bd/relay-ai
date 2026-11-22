import type { PoolProbeResult } from '../pool/probe.js';
import { buildIntelligenceLookup, loadIntelligenceCache } from '../intelligence/artificial-analysis.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadPreferences, savePreferences } from '../config.js';
import { fetchProviderCatalog } from '../provider-catalog.js';
import { classifyFreeStatus } from '../free-models.js';
import { meetsContextFloor } from '../target-compatibility.js';
import { readBody, sendJson } from '../http-utils.js';
import { loadRegistry } from '../registry/io.js';
import { recordModelTestResult } from '../registry/crud.js';
import { guessModelKindFromName, nameKindOutranksChatTest, type ModelKind } from '../registry/model-kind.js';
import { modelsDevModelKind } from '../registry/models-dev.js';
import { groupPoolActivity, readPoolActivity, summarizePoolEvents } from '../pool/activity.js';
import { addFreePoolMember, moveFreePoolMemberTo, parseFreePool, removeFreePoolMember } from '../pool/membership.js';
import { currentPoolReceipt, poolEndpointRevision } from '../pool/capabilities.js';
import {
  clearDisabledPoolMember,
  clearPoolMemberHealth,
  disabledMessage,
  disabledPoolMembers,
  recordTestPoolFailure,
} from '../pool/disabled.js';
import type { PoolFailure } from '../pool/errors.js';
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

/** Where the shown window came from: typed by the user, measured from the server, a guess, or reported by the provider. */
function contextSourceFor(providerId: string, model: LocalProviderModel): 'set' | 'measured' | 'estimate' | undefined {
  const override = loadRegistry().providers.find(item => item.id === providerId)?.contextWindowOverrides?.[model.id];
  if (override?.source === 'user') return 'set';
  if (override?.source === 'measured') return 'measured';
  return model.contextWindowEstimated === true ? 'estimate' : undefined;
}

function modelMetadata(provider: LocalProvider, model: LocalProviderModel, intelligenceFor?: ReturnType<typeof buildIntelligenceLookup>) {
  const intelligence = intelligenceFor?.(model.id);
  const freeStatus = classifyFreeStatus({ model, providerId: provider.id });
  return {
    providerId: provider.id, providerName: provider.name,
    modelId: model.id, name: model.name ?? model.id,
    family: model.family, brand: model.brand,
    reasoningTestRequests: model.reasoning ? 1 + Math.min(4, new Set((model.reasoningEffortLevels ?? []).filter(level => ['low', 'medium', 'high', 'xhigh', 'max'].includes(level))).size || 1) : 1,
    contextWindow: model.contextWindow, contextWindowEstimated: model.contextWindowEstimated === true,
    contextSource: contextSourceFor(provider.id, model),
    cost: model.cost, freeStatus, ...candidateKind(provider.id, model.id),
    ...(intelligence ? { intelligence: { score: intelligence.score, name: intelligence.name } } : {}),
  };
}

/** A model whose latest Test failed or did not confirm tool calling cannot join the pool until a Test passes with tools. */
function failedTestProblem(providerId: string, modelId: string): string | undefined {
  const result = loadRegistry().providers.find(item => item.id === providerId)?.modelTestResults?.[modelId];
  if (!result) return undefined;
  if (!result.ok && !result.transient) return 'Failed its last test. Run Test again; it can be added once a test passes.';
  if (result.ok && result.toolsPassed === false) return 'Tool calling was not confirmed in the last test. The Relay Free Pool requires tool calling for coding tools.';
  return undefined;
}

function testResultFor(providerId: string, modelId: string) {
  return loadRegistry().providers.find(item => item.id === providerId)?.modelTestResults?.[modelId];
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
        if (result.poolFailure && (result.poolFailure.kind === 'disabled' || result.poolFailure.kind === 'missing')) {
          try {
            const currentPool = parseFreePool(loadPreferences().freePool);
            if (poolMember(currentPool, member)) {
              await recordTestPoolFailure(member, providers, result.poolFailure);
            }
          } catch { /* best effort */ }
        }
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
      // Passing the Test is what re-enables a member that was disabled by an error.
      await clearDisabledPoolMember(member, result.receipt.endpointRevision);
      return { ok: true, status: 'verified', receipt: result.receipt };
    } finally {
      verifying.delete(key);
    }
  } catch (error) {
    return { ok: false, status: 'skipped', reason: 'pool-verification-failed', diagnostic: poolDiagnostic(error) };
  }
}

export interface PoolUiCheckResult {
  ok: boolean;
  status: 'verified' | 'disabled' | 'rate-limited' | 'transient' | 'unavailable' | 'failed';
  reason?: string;
  diagnostic?: string;
  permanent?: boolean;
  transient?: boolean;
  rateLimited?: boolean;
  disabledNote?: string;
  latencyMs?: number;
}

/**
 * Records a permanent or 404/410 test failure for a saved pool member (never
 * touches health.json for non-pool candidates tested from the Providers table).
 */
export async function recordUiPoolTestFailure(
  providerId: string,
  modelId: string,
  failure: PoolFailure | undefined,
): Promise<{ disabled: boolean; note?: string }> {
  if (!failure || (failure.kind !== 'disabled' && failure.kind !== 'missing')) {
    return { disabled: false };
  }
  try {
    const pool = parseFreePool(loadPreferences().freePool);
    if (!poolMember(pool, { providerId, modelId })) return { disabled: false };
    const providers = await fetchProviderCatalog();
    return await recordTestPoolFailure({ providerId, modelId }, providers, failure);
  } catch {
    return { disabled: false };
  }
}

/**
 * Structured single-member health check used by the UI "Test pool" / "Retest all"
 * batch runner. Runs 1 lightweight probe (no extra context probe), records permanent
 * verdicts as Disabled in PoolHealthStore, and optionally preserves valid Ready
 * receipts on transient errors (429 / 5xx / timeout).
 */
export async function checkUiPoolMember(
  providerId: string,
  modelId: string,
  signal: AbortSignal,
  options: { preserveReceiptOnTransient?: boolean; providers?: LocalProvider[] } = {},
): Promise<PoolUiCheckResult> {
  const started = Date.now();
  try {
    const providers = options.providers ?? await fetchProviderCatalog();
    const provider = providers.find(item => item.id === providerId);
    const model = provider?.models.find(item => item.id === modelId);
    const member = { providerId, modelId };
    if (!provider || !model) {
      return { ok: false, status: 'unavailable', reason: 'Model is unavailable or hidden' };
    }
    const membershipProblem = poolMembershipProblem(provider, model);
    if (membershipProblem) {
      return { ok: false, status: 'unavailable', reason: membershipProblem };
    }
    const routingProblem = poolRoutingProblem(provider, model);
    if (routingProblem) {
      return { ok: false, status: 'failed', reason: routingProblem };
    }
    const key = memberKey(member);
    if (verifying.has(key)) {
      return { ok: false, status: 'transient', transient: true, reason: 'Verification already in progress' };
    }
    verifying.add(key);
    try {
      const result = await verifyConfiguredPoolMember(member, providers, signal);
      const latencyMs = Date.now() - started;
      if (result.status === 'verified') {
        try {
          saveReceipts(member, result.receipt);
        } catch (error) {
          return { ok: false, status: 'failed', reason: 'receipt-save-failed', diagnostic: poolDiagnostic(error), latencyMs };
        }
        await clearDisabledPoolMember(member, result.receipt.endpointRevision);
        try {
          const prev = testResultFor(provider.id, model.id);
          const ctxConfirmed = prev?.contextConfirmed === true || contextSourceFor(provider.id, model) === 'measured' || contextSourceFor(provider.id, model) === 'set';
          recordModelTestResult(provider.id, model.id, {
            ok: true,
            latencyMs,
            toolsPassed: true,
            ...(ctxConfirmed ? { contextConfirmed: true } : {}),
            ...(result.receipt.contextWindow ? { contextWindow: result.receipt.contextWindow } : {}),
          });
        } catch { /* logging must never fail verification */ }
        return { ok: true, status: 'verified', latencyMs };
      }

      const failure = result.poolFailure;
      const rateLimited = failure?.kind === 'rate-limit' || failure?.kind === 'quota';
      const isTransient = rateLimited
        || failure?.kind === 'transient'
        || result.reason === 'probe-timeout';

      // Record permanent / 404 verdicts in PoolHealthStore for saved pool members.
      let disabled = false;
      let disabledNote: string | undefined;
      if (failure?.kind === 'disabled' || failure?.kind === 'missing') {
        const currentPool = parseFreePool(loadPreferences().freePool);
        if (poolMember(currentPool, member)) {
          const recorded = await recordTestPoolFailure(member, providers, failure);
          disabled = recorded.disabled;
          disabledNote = recorded.note ?? failure.note;
        }
      }

      // Preserve a valid Ready receipt when retesting hits a transient 429/5xx/timeout;
      // always clear the receipt on permanent or non-transient failures.
      if (!isTransient || !options.preserveReceiptOnTransient) {
        try { saveReceipts(member, undefined); } catch { /* best effort */ }
      }

      if (disabled) {
        const msg = disabledMessage(disabledNote ?? 'model no longer available');
        try { recordModelTestResult(provider.id, model.id, { ok: false, error: msg }); } catch { /* best effort */ }
        return {
          ok: false,
          status: 'disabled',
          permanent: true,
          disabledNote: disabledNote ?? 'model no longer available',
          reason: msg,
          ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
          latencyMs,
        };
      }
      if (rateLimited) {
        const msg = failure?.kind === 'quota' ? 'Provider quota or credits exhausted' : 'Provider rate limit reached (429)';
        try { recordModelTestResult(provider.id, model.id, { ok: false, error: msg, transient: true }); } catch { /* best effort */ }
        return {
          ok: false,
          status: 'rate-limited',
          transient: true,
          rateLimited: true,
          reason: msg,
          latencyMs,
        };
      }
      if (failure?.kind === 'missing') {
        const msg = 'Not found (404) — run Test again to confirm, or remove from pool';
        try { recordModelTestResult(provider.id, model.id, { ok: false, error: msg }); } catch { /* best effort */ }
        return {
          ok: false,
          status: 'failed',
          reason: msg,
          ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
          latencyMs,
        };
      }
      if (isTransient) {
        const msg = result.reason === 'probe-timeout' ? 'Timed out waiting for response' : 'Temporary provider error';
        try { recordModelTestResult(provider.id, model.id, { ok: false, error: msg, transient: true }); } catch { /* best effort */ }
        return {
          ok: false,
          status: 'transient',
          transient: true,
          reason: msg,
          ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
          latencyMs,
        };
      }
      const failMsg = result.reason === 'probe-invalid-output'
        ? 'Tool calling was not confirmed (model did not return a valid tool call)'
        : result.reason === 'probe-truncated'
          ? 'Response truncated before completing the tool call'
          : result.reason;
      try { recordModelTestResult(provider.id, model.id, { ok: false, error: failMsg }); } catch { /* best effort */ }
      return {
        ok: false,
        status: 'failed',
        reason: failMsg,
        ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
        latencyMs,
      };
    } finally {
      verifying.delete(key);
    }
  } catch (error) {
    return {
      ok: false,
      status: 'transient',
      transient: true,
      reason: 'pool-verification-failed',
      diagnostic: poolDiagnostic(error),
      latencyMs: Date.now() - started,
    };
  }
}

export async function handlePoolApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    // Loading the catalog is the slow part; reorder, effort and on/off never need it.
    let catalog: LocalProvider[] | undefined;
    const loadCatalog = async () => (catalog ??= await fetchProviderCatalog());
    let pool = parseFreePool(loadPreferences().freePool);
    if (req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      // Never accept capability receipts supplied by a browser.
      if ('receipts' in body) throw new Error('Capability receipts are created only by verification');
      if (body.action === 'effort') pool = parseFreePool({ ...pool, effort: body.effort });
      else if (body.action === 'enabled') {
        if (typeof body.enabled !== 'boolean') throw new Error('enabled must be true or false');
        pool = parseFreePool({ ...pool, enabled: body.enabled });
      } else if (body.action === 'remove-batch') {
        if (!Array.isArray(body.members) || body.members.length === 0) {
          throw new Error('Provide a non-empty list of members to remove');
        }
        const targets: FavoriteModel[] = [];
        for (const item of body.members) {
          if (!item || typeof item.providerId !== 'string' || typeof item.modelId !== 'string') {
            throw new Error('Each member to remove must specify providerId and modelId');
          }
          targets.push({ providerId: item.providerId, modelId: item.modelId });
        }
        const providers = await loadCatalog().catch(() => [] as LocalProvider[]);
        // Re-read fresh after async catalog load so concurrent edits are never clobbered.
        let latest = parseFreePool(loadPreferences().freePool);
        const oldReceipts = latest.receipts;
        let removed = 0;
        for (const target of targets) {
          const before = latest.members.length;
          latest = removeFreePoolMember(latest, target);
          if (latest.members.length < before) removed += 1;
          await clearPoolMemberHealth(target, providers, oldReceipts);
        }
        savePreferences({ freePool: latest });
        sendJson(res, 200, { ok: true, removed });
        return;
      } else {
        const member = { providerId: body.providerId, modelId: body.modelId };
        if (typeof member.providerId !== 'string' || typeof member.modelId !== 'string') throw new Error('Choose a provider account and model');
        const index = pool.members.findIndex(item => item.providerId === member.providerId && item.modelId === member.modelId);
        if (body.action === 'add') {
          const provider = (await loadCatalog()).find(item => item.id === member.providerId);
          const model = provider?.models.find(item => item.id === member.modelId);
          if (!provider || !model) throw new Error('Model is unavailable or hidden');
          const reason = poolMembershipProblem(provider, model) ?? failedTestProblem(member.providerId, member.modelId);
          if (reason) throw new Error(reason);
          pool = addFreePoolMember(pool, member);
        } else if (body.action === 'remove') {
          const providers = await loadCatalog().catch(() => [] as LocalProvider[]);
          const fresh = parseFreePool(loadPreferences().freePool);
          const oldReceipts = fresh.receipts;
          pool = removeFreePoolMember(fresh, member);
          await clearPoolMemberHealth(member, providers, oldReceipts);
        } else if (body.action === 'move') {
          if (index < 0) throw new Error('Invalid priority change');
          if (Number.isInteger(body.toIndex)) {
            pool = moveFreePoolMemberTo(pool, member, body.toIndex);
          } else if ([-1, 1].includes(body.direction)) {
            const next = index + body.direction;
            if (next >= 0 && next < pool.members.length) pool = moveFreePoolMemberTo(pool, member, next);
          } else throw new Error('Invalid priority change');
        } else if (body.action === 'check') {
          if (index < 0) throw new Error('Add the model to the pool first');
          const controller = new AbortController();
          const cancel = () => { if (!res.writableEnded) controller.abort(); };
          res.once('close', cancel);
          try {
            const timeout = AbortSignal.timeout(25_000);
            const result = await checkUiPoolMember(
              member.providerId,
              member.modelId,
              AbortSignal.any([controller.signal, timeout]),
              { preserveReceiptOnTransient: body.preserveReceiptOnTransient === true },
            );
            if (!res.destroyed) sendJson(res, 200, result);
          } finally {
            res.removeListener('close', cancel);
          }
          return;
        } else if (body.action === 'verify') {
          // Backward-compatible explicit endpoint; the normal UI reuses Test instead.
          if (index < 0) throw new Error('Add the model to the pool first');
          const provider = (await loadCatalog()).find(item => item.id === member.providerId);
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
    const providers = await loadCatalog();
    sendJson(res, 200, { ...poolView(providers, pool, await disabledPoolMembers(providers, pool)), activity: poolActivityView() });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'Unable to update the free pool' });
  }
}

/** Current model plus only the moments something happened; `recent` holds every request for the verbose view. */
function poolActivityView() {
  const requests = groupPoolActivity([...readPoolActivity(400)].reverse());
  const state = summarizePoolEvents(requests);
  return {
    current: state.current, since: state.since, quiet: state.quiet,
    events: state.events.slice(-12).reverse(),
    recent: requests.slice(-30).reverse(),
  };
}

export function poolView(providers: LocalProvider[], pool: FreePoolPreferences, disabled: ReadonlyMap<string, { note: string; since: number }> = new Map()) {
  const intelligenceFor = buildIntelligenceLookup(loadIntelligenceCache());
  const members = pool.members.map(raw => {
    const provider = providers.find(item => item.id === raw.providerId);
    const model = provider?.models.find(item => item.id === raw.modelId);
    if (!provider || !model) return { ...raw, name: raw.modelId, providerName: raw.providerId,
      status: 'Unavailable', reason: 'Model is unavailable or hidden', targets: [], effortLevels: [] };
    const membershipProblem = poolMembershipProblem(provider, model);
    const routingProblem = poolRoutingProblem(provider, model);
    const receipt = membershipProblem ? undefined : currentPoolReceipt(pool.receipts, raw, revision(provider, model), Date.now());
    const off = membershipProblem ? undefined : disabled.get(raw.providerId + '/' + raw.modelId);
    const lastTest = testResultFor(provider.id, model.id);
    const noToolsNote = !receipt && lastTest?.ok && lastTest.toolsPassed === false
      ? 'Tool calling was not confirmed in the last test (required for the Relay Free Pool).'
      : undefined;
    return { ...modelMetadata(provider, model, intelligenceFor), ...raw,
      status: membershipProblem ? 'Unavailable' : off ? 'Disabled' : routingProblem ? 'Needs test' : receipt ? 'Ready' : 'Needs test',
      reason: membershipProblem ?? (off ? disabledMessage(off.note) : routingProblem ?? noToolsNote),
      // The window routing actually uses is the one saved by the last Test; it can lag a size set or measured since.
      routingContextWindow: receipt?.contextWindow,
      ...(lastTest ? { testResult: lastTest } : {}),
      targets: receipt?.targets ?? [], effortLevels: receipt?.effortLevels ?? [] };
  });
  // This is the same free-only universe shown by the Providers table. Models
  // that the pool cannot transport stay visible with an explanation so the
  // Free Pool total never silently differs from the free catalog.
  const candidates = providers.flatMap(provider => provider.models
    .filter(model => !model.hidden && isFreeListEntry(model) && meetsContextFloor('claude', model.contextWindow))
    .map(model => {
      const alreadyAdded = poolMember(pool, { providerId: provider.id, modelId: model.id });
      const membershipProblem = poolMembershipProblem(provider, model)
        ?? (alreadyAdded ? undefined : failedTestProblem(provider.id, model.id));
      const testResult = testResultFor(provider.id, model.id);
      return { ...modelMetadata(provider, model, intelligenceFor),
        alreadyAdded,
        ...(testResult ? { testResult } : {}),
        canAdd: !membershipProblem, addReason: membershipProblem,
        canRouteUntilTested: poolRoutingProblem(provider, model) === undefined };
    }));
  return {
    enabled: pool.enabled === true,
    members,
    candidates,
    effort: pool.effort,
    // Shown as banners so disabled or catalog-missing members are never easy to miss, wherever they sit in priority order.
    disabled: members.filter(member => member.status === 'Disabled').map(member => ({ providerId: member.providerId, modelId: member.modelId, reason: member.reason })),
    unavailable: members.filter(member => member.status === 'Unavailable').map(member => ({ providerId: member.providerId, modelId: member.modelId, reason: member.reason })),
  };
}
