#!/usr/bin/env node
import {
  PoolHealthStore,
  poolEndpointScope
} from "./chunk-5TOPC5SV.js";
import {
  poolEndpointRevision
} from "./chunk-6ATJUU3L.js";

// src/pool/disabled.ts
import pc from "picocolors";
function disabledMessage(note) {
  return "Disabled after an error: " + note + ". Test it again to re-enable.";
}
function revisionFor(provider, modelId) {
  const model = provider.models.find((item) => item.id === modelId);
  if (!model?.npm) return void 0;
  return poolEndpointRevision({
    providerId: provider.id,
    authRef: provider.authRef,
    npm: model.npm,
    baseURL: model.apiBaseUrl,
    upstreamModelId: model.upstreamModelId,
    headers: provider.headers
  });
}
async function disabledPoolMembers(providers, pool, store = new PoolHealthStore()) {
  const disabled = /* @__PURE__ */ new Map();
  for (const member of pool.members) {
    const provider = providers.find((item) => item.id === member.providerId);
    const revision = provider ? revisionFor(provider, member.modelId) : void 0;
    if (!revision) continue;
    try {
      const found = await store.disabledFor([poolEndpointScope(member.providerId, revision, member.modelId)]);
      if (found) disabled.set(member.providerId + "/" + member.modelId, found);
    } catch {
    }
  }
  return disabled;
}
async function clearDisabledPoolMember(member, endpointRevision, store = new PoolHealthStore()) {
  try {
    await store.clear([poolEndpointScope(member.providerId, endpointRevision, member.modelId)]);
  } catch {
  }
}
async function warnDisabledPoolMembers(providers, pool, store, write = (line) => console.error(line)) {
  const disabled = await disabledPoolMembers(providers, pool, store);
  for (const [name, info] of disabled) {
    write(pc.bold(pc.red("\u26D4 Free pool member disabled: " + name)) + pc.red(" - " + info.note + ". Test it again (relay-ai ui > Free Pool) to re-enable."));
  }
  return disabled.size;
}

// src/http-utils.ts
import * as zlib from "zlib";
function decodeRequestBody(raw, encoding) {
  const enc = (Array.isArray(encoding) ? encoding.join(",") : encoding ?? "").toLowerCase().trim();
  if (!enc || enc === "identity") return raw.toString();
  switch (enc) {
    case "gzip":
    case "x-gzip":
      return zlib.gunzipSync(raw).toString();
    case "deflate":
      return zlib.inflateSync(raw).toString();
    case "br":
      return zlib.brotliDecompressSync(raw).toString();
    case "zstd":
      if (typeof zlib.zstdDecompressSync !== "function") {
        throw new Error("zstd request encoding requires Node >= 22.15");
      }
      return zlib.zstdDecompressSync(raw).toString();
    default:
      return raw.toString();
  }
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalSize = 0;
    req.on("data", (c) => {
      totalSize += c.length;
      if (totalSize > 50 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(decodeRequestBody(Buffer.concat(chunks), req.headers["content-encoding"]));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}
function extractApiKey(req) {
  const xApiKey = req.headers["x-api-key"];
  if (typeof xApiKey === "string") return xApiKey;
  const auth = req.headers["authorization"];
  if (typeof auth === "string") return auth.replace(/^Bearer\s+/i, "").trim();
  return null;
}
function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(json);
}

export {
  readBody,
  extractApiKey,
  sendJson,
  disabledMessage,
  disabledPoolMembers,
  clearDisabledPoolMember,
  warnDisabledPoolMembers
};
//# sourceMappingURL=chunk-672Y5O5Q.js.map