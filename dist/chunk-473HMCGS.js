#!/usr/bin/env node
import {
  clearDisabledPoolMember,
  disabledMessage,
  disabledPoolMembers,
  readBody,
  sendJson
} from "./chunk-4CGNDYTT.js";
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
} from "./chunk-MZWORR4O.js";
import {
  addFreePoolMember,
  classifyFreeStatus,
  currentPoolReceipt,
  guessModelKindFromName,
  loadPreferences,
  loadRegistry,
  modelsDevModelKind,
  nameKindOutranksChatTest,
  parseFreePool,
  poolEndpointRevision,
  removeFreePoolMember,
  savePreferences
} from "./chunk-5DM6VAEL.js";

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
function modelMetadata(provider, model) {
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
    ...candidateKind(provider.id, model.id)
  };
}
function failedTestProblem(providerId, modelId) {
  const result = loadRegistry().providers.find((item) => item.id === providerId)?.modelTestResults?.[modelId];
  return result && !result.ok && !result.transient ? "Failed its last test. Run Test again; it can be added once a test passes." : void 0;
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
async function handlePoolApi(req, res) {
  try {
    const providers = await fetchProviderCatalog();
    let pool = parseFreePool(loadPreferences().freePool);
    if (req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      if ("receipts" in body) throw new Error("Capability receipts are created only by verification");
      if (body.action === "effort") pool = parseFreePool({ ...pool, effort: body.effort });
      else if (body.action === "enabled") {
        if (typeof body.enabled !== "boolean") throw new Error("enabled must be true or false");
        pool = parseFreePool({ ...pool, enabled: body.enabled });
      } else {
        const member = { providerId: body.providerId, modelId: body.modelId };
        if (typeof member.providerId !== "string" || typeof member.modelId !== "string") throw new Error("Choose a provider account and model");
        const index = pool.members.findIndex((item) => item.providerId === member.providerId && item.modelId === member.modelId);
        if (body.action === "add") {
          const provider = providers.find((item) => item.id === member.providerId);
          const model = provider?.models.find((item) => item.id === member.modelId);
          if (!provider || !model) throw new Error("Model is unavailable or hidden");
          const reason = poolMembershipProblem(provider, model) ?? failedTestProblem(member.providerId, member.modelId);
          if (reason) throw new Error(reason);
          pool = addFreePoolMember(pool, member);
        } else if (body.action === "remove") pool = removeFreePoolMember(pool, member);
        else if (body.action === "move") {
          if (index < 0 || ![-1, 1].includes(body.direction)) throw new Error("Invalid priority change");
          const next = index + body.direction;
          if (next >= 0 && next < pool.members.length) [pool.members[index], pool.members[next]] = [pool.members[next], pool.members[index]];
        } else if (body.action === "verify") {
          if (index < 0) throw new Error("Add the model to the pool first");
          const provider = providers.find((item) => item.id === member.providerId);
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
    return {
      ...modelMetadata(provider, model),
      ...raw,
      status: membershipProblem ? "Unavailable" : off ? "Disabled" : routingProblem ? "Needs test" : receipt ? "Ready" : "Needs test",
      reason: membershipProblem ?? (off ? disabledMessage(off.note) : routingProblem),
      // The window routing actually uses is the one saved by the last Test; it can lag a size set or measured since.
      routingContextWindow: receipt?.contextWindow,
      targets: receipt?.targets ?? [],
      expiresAt: receipt?.expiresAt,
      effortLevels: receipt?.effortLevels ?? []
    };
  });
  const candidates = providers.flatMap((provider) => provider.models.filter((model) => !model.hidden && isFreeListEntry(model) && meetsContextFloor("claude", model.contextWindow)).map((model) => {
    const alreadyAdded = poolMember(pool, { providerId: provider.id, modelId: model.id });
    const membershipProblem = poolMembershipProblem(provider, model) ?? (alreadyAdded ? void 0 : failedTestProblem(provider.id, model.id));
    const testResult = testResultFor(provider.id, model.id);
    return {
      ...modelMetadata(provider, model),
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
    // Shown as a banner so a disabled member is never easy to miss, wherever it sits in the priority list.
    disabled: members.filter((member) => member.status === "Disabled").map((member) => ({ providerId: member.providerId, modelId: member.modelId, reason: member.reason }))
  };
}

export {
  invalidateUiPoolMember,
  verifyUiPoolMember,
  handlePoolApi,
  poolView
};
//# sourceMappingURL=chunk-473HMCGS.js.map