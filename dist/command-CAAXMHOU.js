#!/usr/bin/env node
import {
  probePoolEffort,
  probePoolModel,
  verifyPoolMember
} from "./chunk-PHD4X47E.js";
import {
  fetchProviderCatalog,
  resolveLocalProviderApiKey
} from "./chunk-4FWLRJ2U.js";
import {
  providerRefreshToken
} from "./chunk-RNHGBUKM.js";
import {
  addFreePoolMember,
  createLanguageModel,
  effortProviderOptions,
  loadPreferences,
  parseFreePool,
  parsePoolReceipt,
  removeFreePoolMember,
  savePreferences
} from "./chunk-IBAUEWWV.js";
import "./chunk-RKRPDZVV.js";
import "./chunk-KNCSTHR4.js";
import "./chunk-JIDIH7DS.js";

// src/pool/command.ts
import pc from "picocolors";
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
//# sourceMappingURL=command-CAAXMHOU.js.map