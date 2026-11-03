#!/usr/bin/env node
import {
  fetchProviderCatalog,
  resolveLocalProviderApiKey
} from "./chunk-KOGVCPNK.js";
import {
  providerRefreshToken
} from "./chunk-LXTF7TOF.js";
import {
  addFreePoolMember,
  classifyFreeStatus,
  createLanguageModel,
  effortProviderOptions,
  loadPreferences,
  parseFreePool,
  parsePoolReceipt,
  poolEndpointRevision,
  removeFreePoolMember,
  savePreferences
} from "./chunk-IBEBOL44.js";
import "./chunk-RKRPDZVV.js";
import "./chunk-KNCSTHR4.js";
import "./chunk-JIDIH7DS.js";

// src/pool/command.ts
import pc from "picocolors";

// src/pool/probe.ts
import { streamText, tool, jsonSchema } from "ai";
async function probePoolModel(model, signal, timeoutMs = 2e4, onError) {
  const result = { text: "failed", tools: "failed" };
  const call = async (withTool) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const abortSignal = AbortSignal.any([signal, timeout]);
    const response = streamText({
      model,
      abortSignal,
      maxRetries: 0,
      maxOutputTokens: 256,
      prompt: withTool ? 'Call relay_pool_probe with value "ok". Do not perform any other action.' : "Reply with exactly OK.",
      ...withTool ? { toolChoice: { type: "tool", toolName: "relay_pool_probe" }, tools: {
        relay_pool_probe: tool({
          description: "Harmless enrollment capability probe; it is never executed.",
          inputSchema: jsonSchema({ type: "object", properties: { value: { type: "string", enum: ["ok"] } }, required: ["value"], additionalProperties: false })
        })
      } } : {},
      onError: () => {
      }
    });
    for (const promise of [response.text, response.toolCalls, response.finishReason, response.usage, response.response]) Promise.resolve(promise).catch(() => {
    });
    let text = "";
    let validTool = false;
    let finish = "";
    for await (const part of response.stream) {
      if (part.type === "error") throw part.error;
      if (part.type === "text-delta") text += part.text;
      if (part.type === "tool-call") validTool = part.toolName === "relay_pool_probe" && part.input?.value === "ok";
      if (part.type === "finish") finish = part.finishReason;
    }
    if (finish === "length") return "truncated";
    return withTool ? validTool && finish === "tool-calls" : text.trim() === "OK" && finish === "stop";
  };
  try {
    const text = await call(false);
    if (text !== true) return { ...result, failure: text === "truncated" ? "truncated" : "invalid-output" };
    result.text = "passed";
    const tools = await call(true);
    if (tools !== true) return { ...result, failure: tools === "truncated" ? "truncated" : "invalid-output" };
    result.tools = "passed";
    return result;
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    onError?.(error);
    return { ...result, failure: error?.name === "TimeoutError" ? "timeout" : "provider" };
  }
}
async function probePoolEffort(model, providerOptions, signal, timeoutMs = 2e4, onError) {
  try {
    const abortSignal = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    const response = streamText({
      model,
      abortSignal,
      maxRetries: 0,
      maxOutputTokens: 32,
      prompt: "Reply with exactly OK.",
      providerOptions,
      onError: () => {
      }
    });
    for (const promise of [response.text, response.toolCalls, response.finishReason, response.usage, response.response]) {
      Promise.resolve(promise).catch(() => {
      });
    }
    let text = "";
    let finish = "";
    for await (const part of response.stream) {
      if (part.type === "error") {
        onError?.(part.error);
        return false;
      }
      if (part.type === "text-delta") text += part.text;
      if (part.type === "finish") finish = part.finishReason;
    }
    return finish === "stop" && text.trim().length > 0;
  } catch (error) {
    onError?.(error);
    return false;
  }
}

// src/pool/enroll.ts
var RECEIPT_TTL_MS = 24 * 60 * 60 * 1e3;
var ENROLL_MAX_OUTPUT_TOKENS = 4096;
async function verifyPoolMember(member, providers, signal, deps, now = Date.now()) {
  const provider = providers.find((item) => item.id === member.providerId);
  const model = provider?.models.find((item) => item.id === member.modelId);
  if (!provider || !model) return { member, status: "skipped", reason: "unavailable" };
  if (!model.npm || model.modelFormat === "cloud-code") return { member, status: "skipped", reason: "unsupported-transport" };
  if (!Number.isSafeInteger(model.contextWindow) || !model.contextWindow || model.contextWindow <= 0) {
    return { member, status: "skipped", reason: "unverified-context-window" };
  }
  const freeStatus = classifyFreeStatus({ model, providerId: provider.id });
  if (freeStatus !== "verified_free" && freeStatus !== "free_provider") {
    return { member, status: "skipped", reason: "not-free" };
  }
  if (freeStatus !== "verified_free") {
    return { member, status: "skipped", reason: "billing-safeguard-unverified" };
  }
  const apiKey = await deps.resolveKey(provider);
  if (!apiKey) return { member, status: "skipped", reason: "missing-credential" };
  const languageModel = await deps.createModel(provider, model, apiKey);
  const probe = await deps.probe(languageModel, signal);
  if (probe.text !== "passed" || probe.tools !== "passed") {
    return { member, status: "skipped", reason: "probe-" + (probe.failure ?? "failed") };
  }
  const targets = ["codex", "claude"];
  const effortLevels = [];
  if (deps.probeEffort && model.reasoning) {
    const declared = (model.reasoningEffortLevels ?? []).filter((level) => ["low", "medium", "high", "xhigh", "max"].includes(level));
    const candidates = [...new Set(declared.length > 0 ? declared : ["high"])].slice(0, 4);
    for (const level of candidates) {
      if (await deps.probeEffort(languageModel, level, signal)) effortLevels.push(level);
    }
    if (effortLevels.length > 0) targets.push("antigravity");
  }
  const revision = poolEndpointRevision({
    providerId: provider.id,
    authRef: provider.authRef,
    npm: model.npm,
    baseURL: model.apiBaseUrl,
    upstreamModelId: model.upstreamModelId,
    headers: provider.headers
  });
  return {
    member,
    status: "verified",
    receipt: {
      member: { providerId: member.providerId, modelId: member.modelId },
      endpointRevision: revision,
      verifiedAt: now,
      expiresAt: now + RECEIPT_TTL_MS,
      targets,
      tools: true,
      maxOutputTokens: ENROLL_MAX_OUTPUT_TOKENS,
      contextWindow: model.contextWindow,
      contextSource: "provider",
      reasoningAccounting: "inside-output",
      effortLevels,
      billingSafe: true
    }
  };
}

// src/pool/command.ts
var poolHelpText = [
  "Usage: relay-ai pool [list | verify | add <provider-account> <model> | remove <provider-account> <model> | effort <auto|low|medium|high>]",
  "Manage shared membership independently of favorites. Order is routing priority.",
  "verify   Opt-in text + tool probe per member; mints a 24h capability receipt.",
  "Members without a fresh receipt stay saved but are never routed."
].join(String.fromCharCode(10));
function traceProbeFailure(label) {
  return (error) => {
    if (process.env.RELAY_AI_TRACE !== "1") return;
    const detail = error instanceof Error ? error.message : String(error);
    console.error(pc.dim("[pool] " + label + ": " + detail));
  };
}
function validPoolReceipts(receipts) {
  const valid = [];
  const seen = /* @__PURE__ */ new Set();
  let discarded = 0;
  for (const raw of receipts) {
    const receipt = parsePoolReceipt(raw);
    if (!receipt) {
      discarded++;
      continue;
    }
    const key = JSON.stringify([receipt.member.providerId, receipt.member.modelId, receipt.endpointRevision]);
    if (seen.has(key)) {
      discarded++;
      continue;
    }
    seen.add(key);
    valid.push(receipt);
  }
  return { receipts: valid, discarded };
}
async function runPoolCommand(args) {
  try {
    const pool = parseFreePool(loadPreferences().freePool);
    const [action = "list", first, second] = args;
    if (action === "list" && args.length <= 1) {
      console.log(JSON.stringify(pool, null, 2));
      return 0;
    }
    if (action === "verify" && args.length === 1) {
      if (pool.members.length === 0) throw new Error("Add pool members before verifying.");
      const providers = await fetchProviderCatalog();
      const signal = new AbortController().signal;
      const receipts = [...pool.receipts];
      let failed = 0;
      for (const member of pool.members) {
        const foundProvider = providers.find((item) => item.id === member.providerId);
        const foundModel = foundProvider?.models.find((item) => item.id === member.modelId);
        const result = await verifyPoolMember(member, providers, signal, {
          resolveKey: resolveLocalProviderApiKey,
          createModel: (provider, model, apiKey) => createLanguageModel({
            npm: model.npm,
            modelId: model.upstreamModelId,
            apiKey,
            baseURL: model.apiBaseUrl,
            providerId: provider.id,
            authType: provider.authType,
            oauthAccountId: provider.oauthAccountId,
            providerData: provider.providerData,
            headers: provider.headers,
            refreshToken: providerRefreshToken(provider.id, provider.authType, provider.authRef)
          }),
          probe: (languageModel, signal2) => probePoolModel(
            languageModel,
            signal2,
            2e4,
            traceProbeFailure(member.providerId + "/" + member.modelId + " probe")
          ),
          probeEffort: foundProvider && foundModel ? (languageModel, level) => probePoolEffort(
            languageModel,
            effortProviderOptions(foundModel.npm, level, foundModel.upstreamModelId, {
              ...foundModel,
              providerId: foundProvider.id,
              apiBaseUrl: foundModel.apiBaseUrl
            }),
            signal,
            2e4,
            traceProbeFailure(member.providerId + "/" + member.modelId + " effort " + level)
          ) : void 0
        });
        if (result.status === "verified") {
          const index = receipts.findIndex((receipt) => receipt.member.providerId === member.providerId && receipt.member.modelId === member.modelId);
          if (index === -1) receipts.push(result.receipt);
          else receipts[index] = result.receipt;
          console.log(pc.green("verified") + "  " + member.providerId + " / " + member.modelId);
        } else {
          failed++;
          console.log(pc.yellow("skipped ") + "  " + member.providerId + " / " + member.modelId + "  " + pc.dim(result.reason));
        }
      }
      const checked = validPoolReceipts(receipts);
      if (checked.discarded > 0) {
        console.log(pc.yellow("Discarded " + checked.discarded + " invalid or duplicate receipt(s)."));
      }
      savePreferences({ freePool: parseFreePool({ ...pool, receipts: checked.receipts }) });
      console.log(pc.dim("Receipts are valid for 24h. Membership was not changed."));
      return failed === pool.members.length ? 1 : 0;
    }
    let next;
    if ((action === "add" || action === "remove") && args.length === 3) {
      const member = { providerId: first, modelId: second };
      next = action === "add" ? addFreePoolMember(pool, member) : removeFreePoolMember(pool, member);
    } else if (action === "effort" && args.length === 2) {
      next = parseFreePool({ ...pool, effort: first });
    } else throw new Error(poolHelpText);
    savePreferences({ freePool: next });
    console.log("Free pool saved.");
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unable to update free pool");
    return 1;
  }
}
export {
  poolHelpText,
  runPoolCommand,
  validPoolReceipts
};
//# sourceMappingURL=command-N42AEJZY.js.map