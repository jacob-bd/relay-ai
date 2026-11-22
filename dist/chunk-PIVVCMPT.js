#!/usr/bin/env node
import {
  buildIntelligenceLookup,
  loadIntelligenceCache
} from "./chunk-6B7CWB2A.js";
import {
  clearDisabledPoolMember,
  clearPoolMemberHealth,
  disabledMessage,
  disabledPoolMembers,
  readBody,
  recordTestPoolFailure,
  sendJson
} from "./chunk-JZ53BAL4.js";
import {
  recordModelTestResult
} from "./chunk-7CHQ4LKN.js";
import {
  fetchProviderCatalog,
  groupPoolActivity,
  meetsContextFloor,
  poolDiagnostic,
  poolMembershipProblem,
  poolRoutingProblem,
  readPoolActivity,
  summarizePoolEvents,
  verifyConfiguredPoolMember
} from "./chunk-SDRVP6UH.js";
import {
  addFreePoolMember,
  classifyFreeStatus,
  currentPoolReceipt,
  guessModelKindFromName,
  loadPreferences,
  loadRegistry,
  modelsDevModelKind,
  moveFreePoolMemberTo,
  nameKindOutranksChatTest,
  parseFreePool,
  poolEndpointRevision,
  removeFreePoolMember,
  savePreferences
} from "./chunk-2UFMXYWV.js";

// src/ui/pool-api.ts
var verifying = /* @__PURE__ */ new Set();
var memberKey = (member) => JSON.stringify([member.providerId, member.modelId]);
function revision(provider, model) {
  return poolEndpointRevision({
    providerId: provider.id,
    authRef: provider.authRef,
    npm: model.npm,
    baseURL: model.apiBaseUrl,
    upstreamModelId: model.upstreamModelId,
    headers: provider.headers
  });
}
function candidateKind(providerId, modelId) {
  const provider = loadRegistry().providers.find((item) => item.id === providerId);
  if (!provider) return {};
  const manual = provider.modelKindOverrides?.[modelId];
  if (manual) return { kind: manual, kindSource: "manual" };
  if (provider.nonChatModelIds?.includes(modelId)) return { kind: "not-chat", kindSource: "test" };
  const guessed = guessModelKindFromName(modelId);
  if (provider.chatModelIds?.includes(modelId)) {
    return nameKindOutranksChatTest(guessed) ? { kind: guessed, kindSource: "name" } : { kind: "chat", kindSource: "test" };
  }
  const known = modelsDevModelKind(provider.id, modelId);
  if (known) return { kind: known, kindSource: "models.dev" };
  return guessed ? { kind: guessed, kindSource: "name" } : {};
}
function isFreeListEntry(model) {
  return Boolean(model.isFree || model.freeStatus === "verified_free" || model.freeStatus === "free_provider" || model.cost && model.cost.input === 0 && model.cost.output === 0);
}
function contextSourceFor(providerId, model) {
  const override = loadRegistry().providers.find((item) => item.id === providerId)?.contextWindowOverrides?.[model.id];
  if (override?.source === "user") return "set";
  if (override?.source === "measured") return "measured";
  return model.contextWindowEstimated === true ? "estimate" : void 0;
}
function modelMetadata(provider, model, intelligenceFor) {
  const intelligence = intelligenceFor?.(model.id);
  const freeStatus = classifyFreeStatus({ model, providerId: provider.id });
  return {
    providerId: provider.id,
    providerName: provider.name,
    modelId: model.id,
    name: model.name ?? model.id,
    family: model.family,
    brand: model.brand,
    reasoningTestRequests: model.reasoning ? 1 + Math.min(4, new Set((model.reasoningEffortLevels ?? []).filter((level) => ["low", "medium", "high", "xhigh", "max"].includes(level))).size || 1) : 1,
    contextWindow: model.contextWindow,
    contextWindowEstimated: model.contextWindowEstimated === true,
    contextSource: contextSourceFor(provider.id, model),
    cost: model.cost,
    freeStatus,
    ...candidateKind(provider.id, model.id),
    ...intelligence ? { intelligence: { score: intelligence.score, name: intelligence.name } } : {}
  };
}
function failedTestProblem(providerId, modelId) {
  const result = loadRegistry().providers.find((item) => item.id === providerId)?.modelTestResults?.[modelId];
  if (!result) return void 0;
  if (!result.ok && !result.transient) return "Failed its last test. Run Test again; it can be added once a test passes.";
  if (result.ok && result.toolsPassed === false) return "Tool calling was not confirmed in the last test. The Relay Free Pool requires tool calling for coding tools.";
  return void 0;
}
function testResultFor(providerId, modelId) {
  return loadRegistry().providers.find((item) => item.id === providerId)?.modelTestResults?.[modelId];
}
function poolMember(pool, member) {
  return pool.members.some((item) => item.providerId === member.providerId && item.modelId === member.modelId);
}
function saveReceipts(member, receipt) {
  const current = parseFreePool(loadPreferences().freePool);
  const next = parseFreePool({
    ...current,
    receipts: [
      ...current.receipts.filter((item) => item.member.providerId !== member.providerId || item.member.modelId !== member.modelId),
      ...receipt ? [receipt] : []
    ]
  });
  savePreferences({ freePool: next });
  return next;
}
function invalidateUiPoolMember(providerId, modelId) {
  try {
    const current = parseFreePool(loadPreferences().freePool);
    const receipts = current.receipts.filter((item) => item.member.providerId !== providerId || item.member.modelId !== modelId);
    if (receipts.length === current.receipts.length) return false;
    savePreferences({ freePool: parseFreePool({ ...current, receipts }) });
    return true;
  } catch {
    return false;
  }
}
async function verifyUiPoolMember(providerId, modelId, signal, options = {}) {
  try {
    const providers = await fetchProviderCatalog();
    const provider = providers.find((item) => item.id === providerId);
    const model = provider?.models.find((item) => item.id === modelId);
    const member = { providerId, modelId };
    if (!provider || !model || poolMembershipProblem(provider, model)) return void 0;
    if (poolRoutingProblem(provider, model)) return { ok: false, status: "skipped", reason: "unverified-context-window" };
    const key = memberKey(member);
    if (verifying.has(key)) return { ok: false, status: "skipped", reason: "verification-in-progress" };
    verifying.add(key);
    try {
      const result = await verifyConfiguredPoolMember(member, providers, signal, options);
      if (result.status !== "verified") {
        if (result.poolFailure && (result.poolFailure.kind === "disabled" || result.poolFailure.kind === "missing")) {
          try {
            const currentPool = parseFreePool(loadPreferences().freePool);
            if (poolMember(currentPool, member)) {
              await recordTestPoolFailure(member, providers, result.poolFailure);
            }
          } catch {
          }
        }
        try {
          saveReceipts(member, void 0);
        } catch (error) {
          return { ok: false, status: "skipped", reason: "receipt-save-failed", diagnostic: poolDiagnostic(error) };
        }
        return {
          ok: false,
          status: "skipped",
          reason: result.reason,
          ...result.diagnostic ? { diagnostic: result.diagnostic } : {}
        };
      }
      try {
        saveReceipts(member, result.receipt);
      } catch (error) {
        return { ok: false, status: "skipped", reason: "receipt-save-failed", diagnostic: poolDiagnostic(error) };
      }
      await clearDisabledPoolMember(member, result.receipt.endpointRevision);
      return { ok: true, status: "verified", receipt: result.receipt };
    } finally {
      verifying.delete(key);
    }
  } catch (error) {
    return { ok: false, status: "skipped", reason: "pool-verification-failed", diagnostic: poolDiagnostic(error) };
  }
}
async function recordUiPoolTestFailure(providerId, modelId, failure) {
  if (!failure || failure.kind !== "disabled" && failure.kind !== "missing") {
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
async function checkUiPoolMember(providerId, modelId, signal, options = {}) {
  const started = Date.now();
  try {
    const providers = options.providers ?? await fetchProviderCatalog();
    const provider = providers.find((item) => item.id === providerId);
    const model = provider?.models.find((item) => item.id === modelId);
    const member = { providerId, modelId };
    if (!provider || !model) {
      return { ok: false, status: "unavailable", reason: "Model is unavailable or hidden" };
    }
    const membershipProblem = poolMembershipProblem(provider, model);
    if (membershipProblem) {
      return { ok: false, status: "unavailable", reason: membershipProblem };
    }
    const routingProblem = poolRoutingProblem(provider, model);
    if (routingProblem) {
      return { ok: false, status: "failed", reason: routingProblem };
    }
    const key = memberKey(member);
    if (verifying.has(key)) {
      return { ok: false, status: "transient", transient: true, reason: "Verification already in progress" };
    }
    verifying.add(key);
    try {
      const result = await verifyConfiguredPoolMember(member, providers, signal);
      const latencyMs = Date.now() - started;
      if (result.status === "verified") {
        try {
          saveReceipts(member, result.receipt);
        } catch (error) {
          return { ok: false, status: "failed", reason: "receipt-save-failed", diagnostic: poolDiagnostic(error), latencyMs };
        }
        await clearDisabledPoolMember(member, result.receipt.endpointRevision);
        try {
          const prev = testResultFor(provider.id, model.id);
          const ctxConfirmed = prev?.contextConfirmed === true || contextSourceFor(provider.id, model) === "measured" || contextSourceFor(provider.id, model) === "set";
          recordModelTestResult(provider.id, model.id, {
            ok: true,
            latencyMs,
            toolsPassed: true,
            ...ctxConfirmed ? { contextConfirmed: true } : {},
            ...result.receipt.contextWindow ? { contextWindow: result.receipt.contextWindow } : {}
          });
        } catch {
        }
        return { ok: true, status: "verified", latencyMs };
      }
      const failure = result.poolFailure;
      const rateLimited = failure?.kind === "rate-limit" || failure?.kind === "quota";
      const isTransient = rateLimited || failure?.kind === "transient" || result.reason === "probe-timeout";
      let disabled = false;
      let disabledNote;
      if (failure?.kind === "disabled" || failure?.kind === "missing") {
        const currentPool = parseFreePool(loadPreferences().freePool);
        if (poolMember(currentPool, member)) {
          const recorded = await recordTestPoolFailure(member, providers, failure);
          disabled = recorded.disabled;
          disabledNote = recorded.note ?? failure.note;
        }
      }
      if (!isTransient || !options.preserveReceiptOnTransient) {
        try {
          saveReceipts(member, void 0);
        } catch {
        }
      }
      if (disabled) {
        const msg = disabledMessage(disabledNote ?? "model no longer available");
        try {
          recordModelTestResult(provider.id, model.id, { ok: false, error: msg });
        } catch {
        }
        return {
          ok: false,
          status: "disabled",
          permanent: true,
          disabledNote: disabledNote ?? "model no longer available",
          reason: msg,
          ...result.diagnostic ? { diagnostic: result.diagnostic } : {},
          latencyMs
        };
      }
      if (rateLimited) {
        const msg = failure?.kind === "quota" ? "Provider quota or credits exhausted" : "Provider rate limit reached (429)";
        try {
          recordModelTestResult(provider.id, model.id, { ok: false, error: msg, transient: true });
        } catch {
        }
        return {
          ok: false,
          status: "rate-limited",
          transient: true,
          rateLimited: true,
          reason: msg,
          latencyMs
        };
      }
      if (failure?.kind === "missing") {
        const msg = "Not found (404) \u2014 run Test again to confirm, or remove from pool";
        try {
          recordModelTestResult(provider.id, model.id, { ok: false, error: msg });
        } catch {
        }
        return {
          ok: false,
          status: "failed",
          reason: msg,
          ...result.diagnostic ? { diagnostic: result.diagnostic } : {},
          latencyMs
        };
      }
      if (isTransient) {
        const msg = result.reason === "probe-timeout" ? "Timed out waiting for response" : "Temporary provider error";
        try {
          recordModelTestResult(provider.id, model.id, { ok: false, error: msg, transient: true });
        } catch {
        }
        return {
          ok: false,
          status: "transient",
          transient: true,
          reason: msg,
          ...result.diagnostic ? { diagnostic: result.diagnostic } : {},
          latencyMs
        };
      }
      const failMsg = result.reason === "probe-invalid-output" ? "Tool calling was not confirmed (model did not return a valid tool call)" : result.reason === "probe-truncated" ? "Response truncated before completing the tool call" : result.reason;
      try {
        recordModelTestResult(provider.id, model.id, { ok: false, error: failMsg });
      } catch {
      }
      return {
        ok: false,
        status: "failed",
        reason: failMsg,
        ...result.diagnostic ? { diagnostic: result.diagnostic } : {},
        latencyMs
      };
    } finally {
      verifying.delete(key);
    }
  } catch (error) {
    return {
      ok: false,
      status: "transient",
      transient: true,
      reason: "pool-verification-failed",
      diagnostic: poolDiagnostic(error),
      latencyMs: Date.now() - started
    };
  }
}
async function handlePoolApi(req, res) {
  try {
    let catalog;
    const loadCatalog = async () => catalog ??= await fetchProviderCatalog();
    let pool = parseFreePool(loadPreferences().freePool);
    if (req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      if ("receipts" in body) throw new Error("Capability receipts are created only by verification");
      if (body.action === "effort") pool = parseFreePool({ ...pool, effort: body.effort });
      else if (body.action === "enabled") {
        if (typeof body.enabled !== "boolean") throw new Error("enabled must be true or false");
        pool = parseFreePool({ ...pool, enabled: body.enabled });
      } else if (body.action === "remove-batch") {
        if (!Array.isArray(body.members) || body.members.length === 0) {
          throw new Error("Provide a non-empty list of members to remove");
        }
        const targets = [];
        for (const item of body.members) {
          if (!item || typeof item.providerId !== "string" || typeof item.modelId !== "string") {
            throw new Error("Each member to remove must specify providerId and modelId");
          }
          targets.push({ providerId: item.providerId, modelId: item.modelId });
        }
        const providers2 = await loadCatalog().catch(() => []);
        let latest = parseFreePool(loadPreferences().freePool);
        const oldReceipts = latest.receipts;
        let removed = 0;
        for (const target of targets) {
          const before = latest.members.length;
          latest = removeFreePoolMember(latest, target);
          if (latest.members.length < before) removed += 1;
          await clearPoolMemberHealth(target, providers2, oldReceipts);
        }
        savePreferences({ freePool: latest });
        sendJson(res, 200, { ok: true, removed });
        return;
      } else {
        const member = { providerId: body.providerId, modelId: body.modelId };
        if (typeof member.providerId !== "string" || typeof member.modelId !== "string") throw new Error("Choose a provider account and model");
        const index = pool.members.findIndex((item) => item.providerId === member.providerId && item.modelId === member.modelId);
        if (body.action === "add") {
          const provider = (await loadCatalog()).find((item) => item.id === member.providerId);
          const model = provider?.models.find((item) => item.id === member.modelId);
          if (!provider || !model) throw new Error("Model is unavailable or hidden");
          const reason = poolMembershipProblem(provider, model) ?? failedTestProblem(member.providerId, member.modelId);
          if (reason) throw new Error(reason);
          pool = addFreePoolMember(pool, member);
        } else if (body.action === "remove") {
          const providers2 = await loadCatalog().catch(() => []);
          const fresh = parseFreePool(loadPreferences().freePool);
          const oldReceipts = fresh.receipts;
          pool = removeFreePoolMember(fresh, member);
          await clearPoolMemberHealth(member, providers2, oldReceipts);
        } else if (body.action === "move") {
          if (index < 0) throw new Error("Invalid priority change");
          if (Number.isInteger(body.toIndex)) {
            pool = moveFreePoolMemberTo(pool, member, body.toIndex);
          } else if ([-1, 1].includes(body.direction)) {
            const next = index + body.direction;
            if (next >= 0 && next < pool.members.length) pool = moveFreePoolMemberTo(pool, member, next);
          } else throw new Error("Invalid priority change");
        } else if (body.action === "check") {
          if (index < 0) throw new Error("Add the model to the pool first");
          const controller = new AbortController();
          const cancel = () => {
            if (!res.writableEnded) controller.abort();
          };
          res.once("close", cancel);
          try {
            const timeout = AbortSignal.timeout(25e3);
            const result = await checkUiPoolMember(
              member.providerId,
              member.modelId,
              AbortSignal.any([controller.signal, timeout]),
              { preserveReceiptOnTransient: body.preserveReceiptOnTransient === true }
            );
            if (!res.destroyed) sendJson(res, 200, result);
          } finally {
            res.removeListener("close", cancel);
          }
          return;
        } else if (body.action === "verify") {
          if (index < 0) throw new Error("Add the model to the pool first");
          const provider = (await loadCatalog()).find((item) => item.id === member.providerId);
          const model = provider?.models.find((item) => item.id === member.modelId);
          if (!provider || !model) throw new Error("Model is unavailable or hidden");
          const result = await verifyUiPoolMember(member.providerId, member.modelId, AbortSignal.timeout(body.reasoning === true ? 1e5 : 2e4), { reasoning: body.reasoning === true });
          if (!result) throw new Error("Model is not eligible for the free pool");
          if (!result.ok) throw new Error(result.reason ?? "Verification failed");
          pool = parseFreePool(loadPreferences().freePool);
        } else throw new Error("Unknown pool action");
      }
      savePreferences({ freePool: pool });
      sendJson(res, 200, { ok: true });
      return;
    }
    const providers = await loadCatalog();
    sendJson(res, 200, { ...poolView(providers, pool, await disabledPoolMembers(providers, pool)), activity: poolActivityView() });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "Unable to update the free pool" });
  }
}
function poolActivityView() {
  const requests = groupPoolActivity([...readPoolActivity(400)].reverse());
  const state = summarizePoolEvents(requests);
  return {
    current: state.current,
    since: state.since,
    quiet: state.quiet,
    events: state.events.slice(-12).reverse(),
    recent: requests.slice(-30).reverse()
  };
}
function poolView(providers, pool, disabled = /* @__PURE__ */ new Map()) {
  const intelligenceFor = buildIntelligenceLookup(loadIntelligenceCache());
  const members = pool.members.map((raw) => {
    const provider = providers.find((item) => item.id === raw.providerId);
    const model = provider?.models.find((item) => item.id === raw.modelId);
    if (!provider || !model) return {
      ...raw,
      name: raw.modelId,
      providerName: raw.providerId,
      status: "Unavailable",
      reason: "Model is unavailable or hidden",
      targets: [],
      effortLevels: []
    };
    const membershipProblem = poolMembershipProblem(provider, model);
    const routingProblem = poolRoutingProblem(provider, model);
    const receipt = membershipProblem ? void 0 : currentPoolReceipt(pool.receipts, raw, revision(provider, model), Date.now());
    const off = membershipProblem ? void 0 : disabled.get(raw.providerId + "/" + raw.modelId);
    const lastTest = testResultFor(provider.id, model.id);
    const noToolsNote = !receipt && lastTest?.ok && lastTest.toolsPassed === false ? "Tool calling was not confirmed in the last test (required for the Relay Free Pool)." : void 0;
    return {
      ...modelMetadata(provider, model, intelligenceFor),
      ...raw,
      status: membershipProblem ? "Unavailable" : off ? "Disabled" : routingProblem ? "Needs test" : receipt ? "Ready" : "Needs test",
      reason: membershipProblem ?? (off ? disabledMessage(off.note) : routingProblem ?? noToolsNote),
      // The window routing actually uses is the one saved by the last Test; it can lag a size set or measured since.
      routingContextWindow: receipt?.contextWindow,
      ...lastTest ? { testResult: lastTest } : {},
      targets: receipt?.targets ?? [],
      effortLevels: receipt?.effortLevels ?? []
    };
  });
  const candidates = providers.flatMap((provider) => provider.models.filter((model) => !model.hidden && isFreeListEntry(model) && meetsContextFloor("claude", model.contextWindow)).map((model) => {
    const alreadyAdded = poolMember(pool, { providerId: provider.id, modelId: model.id });
    const membershipProblem = poolMembershipProblem(provider, model) ?? (alreadyAdded ? void 0 : failedTestProblem(provider.id, model.id));
    const testResult = testResultFor(provider.id, model.id);
    return {
      ...modelMetadata(provider, model, intelligenceFor),
      alreadyAdded,
      ...testResult ? { testResult } : {},
      canAdd: !membershipProblem,
      addReason: membershipProblem,
      canRouteUntilTested: poolRoutingProblem(provider, model) === void 0
    };
  }));
  return {
    enabled: pool.enabled === true,
    members,
    candidates,
    effort: pool.effort,
    // Shown as banners so disabled or catalog-missing members are never easy to miss, wherever they sit in priority order.
    disabled: members.filter((member) => member.status === "Disabled").map((member) => ({ providerId: member.providerId, modelId: member.modelId, reason: member.reason })),
    unavailable: members.filter((member) => member.status === "Unavailable").map((member) => ({ providerId: member.providerId, modelId: member.modelId, reason: member.reason }))
  };
}

export {
  invalidateUiPoolMember,
  verifyUiPoolMember,
  recordUiPoolTestFailure,
  handlePoolApi,
  poolView
};
//# sourceMappingURL=chunk-PIVVCMPT.js.map