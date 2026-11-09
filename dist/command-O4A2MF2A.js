#!/usr/bin/env node
import {
  invalidateUiPoolMember,
  poolView,
  verifyUiPoolMember
} from "./chunk-GKCH6B3D.js";
import "./chunk-4RCYRXSV.js";
import {
  clearDisabledPoolMember,
  disabledPoolMembers,
  warnDisabledPoolMembers
} from "./chunk-XLXST7LL.js";
import {
  setContextWindowOverride,
  setModelHidden
} from "./chunk-WJXX65QT.js";
import {
  DEFAULT_FORCE_FAIL_MINUTES,
  PoolEventFilter,
  PoolRequestGrouper,
  clearForceFail,
  fetchProviderCatalog,
  followPoolActivity,
  formatPoolCurrentLine,
  formatPoolEventLines,
  formatPoolRequestLines,
  groupPoolActivity,
  poolProviderHeaders,
  probePoolEffort,
  probePoolModel,
  providerRefreshToken,
  readForceFailState,
  readPoolActivity,
  resolveLocalProviderApiKey,
  setForceFail,
  summarizePoolEvents,
  verifyPoolMember
} from "./chunk-RQPFBRCN.js";
import "./chunk-KITIQ3NG.js";
import "./chunk-5HGLQHX6.js";
import "./chunk-IRMXZJ3D.js";
import {
  addFreePoolMember,
  createLanguageModel,
  effortProviderOptions,
  loadPreferences,
  parseFreePool,
  parsePoolReceipt,
  removeFreePoolMember,
  savePreferences
} from "./chunk-25YDTUQR.js";
import "./chunk-I6I4JU6A.js";
import "./chunk-6DCEGHZH.js";
import "./chunk-W32XKRNU.js";
import "./chunk-XEH2JMTL.js";
import "./chunk-JIDIH7DS.js";

// src/pool/command.ts
import { randomUUID } from "crypto";
import pc from "picocolors";
var poolHelpText = [
  "Usage: relay-ai pool <command>   (experimental: tested with Claude Code first)",
  "  list                         Saved membership and receipts (no tests)",
  "  fail [--minutes N]           Test failover: fail whichever model answered last (repeat to fail the next one too)",
  "  force-fail <provider/model>... [--minutes N] | off   Test failover: make members fail (default 10 min), no request is sent to them",
  "  log [count] [-f|--follow] [-v|--verbose]   Current model, plus a line only when something happens (failure, failover, switch); -f keeps watching; -v shows every request",
  "  candidates [--search text] [--min-context tokens]  Free models, providers and total (no tests)",
  "  status                       Readiness, context, provider names and effort settings (no tests)",
  "  enable | disable             Add/remove Relay Free Pool in launched tool catalogs",
  "  add <provider> <model>        Save a member without testing; independent of favorites",
  "  remove <provider> <model>     Remove a member",
  "  move <provider> <model> <up|down>  Change routing priority",
  "  test <provider> <model>       1 request, max 1024 output tokens, no retries; response + tools",
  "  context <provider> <model>    Optional context measurement: 1 extra request",
  "  context <provider> <model> <tokens|reset>  Set/reset context without inference",
  "  reasoning <provider> <model>  Optional: up to 5 requests, no retries",
  "  hide | unhide <provider> <model>  Change provider-list visibility",
  "  effort <auto|low|medium|high>  Choose pool effort",
  "  verify [--reasoning]          Explicit bulk check of saved members; skips fresh receipts",
  "Adding, enabling, refreshing the UI list, and launching never run tests.",
  "A saved Test result stays valid until the endpoint changes or the member is removed; it does not expire with time.",
  "Context requests may consume quota even when rejected. Reasoning adds up to 4 checks.",
  "See docs/FREE_POOL.md for UI/CLI equivalents and quota costs."
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
    if (action === "--help" || action === "-h") {
      console.log(poolHelpText);
      return 0;
    }
    if (action === "candidates" || action === "status" && args.length === 1) {
      const catalogForView = await fetchProviderCatalog();
      const view = poolView(catalogForView, pool, await disabledPoolMembers(catalogForView, pool));
      let search = "";
      let minContext = 0;
      for (let i = 1; i < args.length; i += 2) {
        if (!args[i + 1]) throw new Error(poolHelpText);
        if (args[i] === "--search") search = args[i + 1].toLowerCase();
        else if (args[i] === "--min-context") {
          minContext = Number(args[i + 1]);
          if (!Number.isSafeInteger(minContext) || minContext < 0) throw new Error("Use a nonnegative context size");
        } else throw new Error(poolHelpText);
      }
      const models = view.candidates.filter((model) => (!search || [model.name, model.modelId, model.providerName, model.providerId].join(" ").toLowerCase().includes(search)) && (model.contextWindow ?? 0) >= minContext);
      console.log(JSON.stringify(action === "candidates" ? { total: view.candidates.length, shown: models.length, models } : view, null, 2));
      return 0;
    }
    if (["test", "context", "reasoning", "hide", "unhide"].includes(action) && first && second) {
      if (args.length !== 3 && !(action === "context" && args.length === 4)) throw new Error(poolHelpText);
      if (action === "hide" || action === "unhide") {
        const result2 = setModelHidden(first, second, action === "hide");
        if (!result2.ok) throw new Error(result2.error);
        console.log(JSON.stringify(result2));
        return 0;
      }
      const { testModel, checkContextWindow } = await import("./test-model-DCZ4SCJK.js");
      if (action === "context") {
        if (args.length === 4) {
          const value = args[3] === "reset" ? null : Number(args[3]);
          if (value !== null && (!Number.isSafeInteger(value) || value <= 0)) throw new Error("Use a positive token count or reset");
          const result2 = setContextWindowOverride(first, second, value, "user");
          if (!result2.ok) throw new Error(result2.error);
          console.log(JSON.stringify(result2));
          return 0;
        }
        console.log("Context measurement: 1 extra request; may consume quota even if rejected.");
        console.log(JSON.stringify(await checkContextWindow(first, second)));
        return 0;
      }
      const signal = new AbortController().signal;
      if (action === "reasoning") {
        console.log("Optional reasoning test: up to 5 requests, no retries.");
        const result2 = await verifyUiPoolMember(first, second, signal, { reasoning: true });
        console.log(JSON.stringify(result2 ?? { ok: false, reason: "not-eligible" }));
        return result2?.ok ? 0 : 1;
      }
      console.log("Test: 1 request, up to 1024 output tokens, no retries.");
      const result = await testModel(first, second, signal);
      if (!result.ok) invalidateUiPoolMember(first, second);
      const readiness = result.ok ? await verifyUiPoolMember(first, second, signal, {
        evidence: { text: "passed", tools: result.toolsPassed ? "passed" : "failed" }
      }) : void 0;
      console.log(JSON.stringify({ ...result, ...readiness ? { pool: readiness } : {} }));
      return result.ok ? 0 : 1;
    }
    if (action === "fail") {
      const rest = args.slice(1);
      let minutes = DEFAULT_FORCE_FAIL_MINUTES;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "--minutes") minutes = Number(rest[++i]);
        else throw new Error(poolHelpText);
      }
      const last = readPoolActivity(200).find((entry) => entry.event === "served");
      if (!last) throw new Error("No pool request has been answered yet. Send a message through Relay Free Pool first.");
      const target = `${last.providerId}/${last.modelId}`;
      const already = readForceFailState()?.members ?? [];
      if (already.includes(target)) {
        console.log(`${target} is already being forced to fail. Send a message so the next member answers, then run this again.`);
        return 0;
      }
      const state = setForceFail([...already, target], minutes);
      console.log(`Failing ${target}${already.length ? ` (already failing: ${already.join(", ")})` : ""}.`);
      console.log(`Active until ${new Date(state.expiresAt).toLocaleTimeString()}. Send a message in your session and watch: relay-ai pool log -f`);
      console.log("Run again to fail whichever member answers next; clear with: relay-ai pool force-fail off");
      return 0;
    }
    if (action === "force-fail") {
      const rest = args.slice(1);
      if (rest.length === 0) {
        const state2 = readForceFailState();
        console.log(state2 ? `Forcing failures on: ${state2.members.join(", ")} (until ${new Date(state2.expiresAt).toLocaleTimeString()})` : "No forced failures active.");
        return 0;
      }
      if (rest.length === 1 && ["off", "clear", "stop"].includes(rest[0])) {
        clearForceFail();
        console.log("Forced failures cleared. The pool behaves normally again.");
        return 0;
      }
      let minutes = DEFAULT_FORCE_FAIL_MINUTES;
      const members = [];
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "--minutes") {
          minutes = Number(rest[++i]);
          continue;
        }
        if (!rest[i].includes("/")) throw new Error("Use provider/model, for example: kilo/reflection/beam-free");
        members.push(rest[i]);
      }
      if (members.length === 0) throw new Error(poolHelpText);
      const state = setForceFail(members, minutes);
      console.log(`Forcing failures on: ${state.members.join(", ")}`);
      console.log(`They fail before any request is sent, until ${new Date(state.expiresAt).toLocaleTimeString()} (or run: relay-ai pool force-fail off).`);
      console.log("Send a message in a session started on the latest build and watch: relay-ai pool log -f");
      return 0;
    }
    if (action === "log" && args.length <= 4) {
      const rest = args.slice(1);
      const follow = rest.includes("-f") || rest.includes("--follow");
      const verbose = rest.includes("-v") || rest.includes("--verbose");
      const countArg = rest.find((arg) => !arg.startsWith("-"));
      if (rest.some((arg) => arg.startsWith("-") && !["-f", "--follow", "-v", "--verbose"].includes(arg))) throw new Error(poolHelpText);
      const count = countArg === void 0 ? 20 : Math.min(200, Math.max(1, Number(countArg) || 20));
      try {
        await warnDisabledPoolMembers(await fetchProviderCatalog(), pool);
      } catch {
      }
      const all = groupPoolActivity([...readPoolActivity(Math.max(count * 40, 400))].reverse());
      if (!follow) {
        if (all.length === 0) {
          console.log("No pool requests recorded yet.");
          return 0;
        }
        if (verbose) {
          for (const r of all.slice(-count).reverse()) console.log(formatPoolRequestLines(r));
          return 0;
        }
        const state = summarizePoolEvents(all);
        console.log(formatPoolCurrentLine(state));
        if (state.events.length === 0) console.log(pc.dim("No failures or failovers recorded. Use -v to see every request."));
        for (const block of state.events.slice(-count).reverse()) console.log(formatPoolEventLines(block));
        return 0;
      }
      const filter = new PoolEventFilter();
      for (const r of all) filter.push(r);
      console.log(formatPoolCurrentLine({ current: filter.current, since: filter.since, quiet: filter.quiet }));
      console.log(pc.dim(verbose ? "Watching: one line per request. Ctrl+C to stop." : "Watching: a line appears only when something happens (failure, failover, switch). Use -v for every request. Ctrl+C to stop."));
      const controller = new AbortController();
      process.once("SIGINT", () => controller.abort());
      process.once("SIGTERM", () => controller.abort());
      const grouper = new PoolRequestGrouper();
      await followPoolActivity((e) => {
        const done = grouper.add(e);
        if (!done) return;
        if (verbose) {
          console.log(formatPoolRequestLines(done));
          return;
        }
        const block = filter.push(done);
        if (block) console.log(formatPoolEventLines(block));
      }, controller.signal);
      return 0;
    }
    if (action === "list" && args.length <= 1) {
      console.log(JSON.stringify(pool, null, 2));
      return 0;
    }
    if (action === "verify" && (args.length === 1 || args.length === 2 && first === "--reasoning")) {
      if (pool.members.length === 0) throw new Error("Add pool members before verifying.");
      const providers = await fetchProviderCatalog();
      const signal = new AbortController().signal;
      const receipts = [...pool.receipts];
      const disabledNow = await disabledPoolMembers(providers, pool);
      let failed = 0;
      console.log("Explicit bulk test: up to " + pool.members.length * (first === "--reasoning" ? 5 : 1) + " requests; fresh receipts are skipped.");
      for (const member of pool.members) {
        if (poolView(providers, pool, disabledNow).members.some((item) => item.providerId === member.providerId && item.modelId === member.modelId && item.status === "Ready") && first !== "--reasoning") continue;
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
            headers: poolProviderHeaders(provider, model, `relay-pool-verify-${randomUUID()}`),
            sessionId: `relay-pool-verify-${randomUUID()}`,
            refreshToken: providerRefreshToken(provider.id, provider.authType, provider.authRef)
          }),
          probe: (languageModel, signal2) => probePoolModel(
            languageModel,
            signal2,
            2e4,
            traceProbeFailure(member.providerId + "/" + member.modelId + " probe")
          ),
          probeEffort: first === "--reasoning" && foundProvider && foundModel ? (languageModel, level) => probePoolEffort(
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
          await clearDisabledPoolMember(member, result.receipt.endpointRevision);
          console.log(pc.green("verified") + "  " + member.providerId + " / " + member.modelId);
        } else {
          failed++;
          for (let i = receipts.length - 1; i >= 0; i--) {
            if (receipts[i].member.providerId === member.providerId && receipts[i].member.modelId === member.modelId) receipts.splice(i, 1);
          }
          console.log(pc.yellow("skipped ") + "  " + member.providerId + " / " + member.modelId + "  " + pc.dim(result.reason));
        }
      }
      const checked = validPoolReceipts(receipts);
      if (checked.discarded > 0) {
        console.log(pc.yellow("Discarded " + checked.discarded + " invalid or duplicate receipt(s)."));
      }
      savePreferences({ freePool: parseFreePool({ ...pool, receipts: checked.receipts }) });
      console.log(pc.dim("Saved Test results stay valid until the endpoint changes. Membership was not changed."));
      return failed === pool.members.length ? 1 : 0;
    }
    let next;
    if ((action === "add" || action === "remove") && args.length === 3) {
      const member = { providerId: first, modelId: second };
      next = action === "add" ? addFreePoolMember(pool, member) : removeFreePoolMember(pool, member);
    } else if ((action === "enable" || action === "disable") && args.length === 1) {
      next = parseFreePool({ ...pool, enabled: action === "enable" });
    } else if (action === "move" && args.length === 4 && ["up", "down"].includes(args[3])) {
      const index = pool.members.findIndex((member) => member.providerId === first && member.modelId === second);
      if (index < 0) throw new Error("Model is not in the pool");
      const target = index + (args[3] === "up" ? -1 : 1);
      next = parseFreePool(pool);
      if (target >= 0 && target < next.members.length) [next.members[index], next.members[target]] = [next.members[target], next.members[index]];
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
//# sourceMappingURL=command-O4A2MF2A.js.map