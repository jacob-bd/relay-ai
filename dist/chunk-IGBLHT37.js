#!/usr/bin/env node
import {
  VERSION,
  isProviderKind
} from "./chunk-IKGOSD5H.js";

// src/opencode-session.ts
import { randomUUID } from "crypto";
var OPENCODE_SESSION_HEADER = "x-opencode-session";
var MAX_OPENCODE_SESSION_LENGTH = 256;
var RELAY_USER_AGENT = `relay-ai/${VERSION}`;
var NATIVE_CONVERSATION_HEADERS = [
  "x-claude-code-session-id",
  "session_id",
  "session-id",
  "x-session-id",
  "thread_id",
  "thread-id",
  "x-thread-id",
  "conversation_id",
  "conversation-id",
  "x-conversation-id"
];
function sanitizeSessionId(value) {
  if (typeof value !== "string") return void 0;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_OPENCODE_SESSION_LENGTH) return void 0;
  if (/[\u0000-\u001f\u007f\r\n]/.test(normalized)) return void 0;
  return normalized;
}
function headerValue(headers, name) {
  if (!headers) return void 0;
  if (headers instanceof Headers) {
    return sanitizeSessionId(headers.get(name));
  }
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowerName) continue;
    const first = Array.isArray(value) ? value[0] : value;
    return sanitizeSessionId(first);
  }
  return void 0;
}
function metadataSessionId(body) {
  if (!body || typeof body !== "object") return void 0;
  const record = body;
  const metadata = record.metadata;
  if (metadata && typeof metadata === "object") {
    const metadataRecord = metadata;
    const direct = sanitizeSessionId(metadataRecord.session_id ?? metadataRecord.sessionId);
    if (direct) return direct;
    const userId = metadataRecord.user_id;
    if (typeof userId === "string") {
      try {
        const parsed = JSON.parse(userId);
        const parsedId = sanitizeSessionId(parsed.session_id ?? parsed.sessionId);
        if (parsedId) return parsedId;
      } catch {
      }
    }
  }
  const clientMetadata = record.client_metadata;
  if (clientMetadata && typeof clientMetadata === "object") {
    const client = clientMetadata;
    const id = sanitizeSessionId(client.session_id ?? client.sessionId ?? client.thread_id ?? client.threadId);
    if (id) return id;
  }
  return sanitizeSessionId(record.session_id ?? record.sessionId ?? record.thread_id ?? record.threadId);
}
function extractConversationId(headers, body) {
  const explicit = headerValue(headers, OPENCODE_SESSION_HEADER);
  if (explicit) return explicit;
  for (const name of NATIVE_CONVERSATION_HEADERS) {
    const native = headerValue(headers, name);
    if (native) return native;
  }
  return metadataSessionId(body);
}
function isOpenCodeGoEndpoint(providerId, endpoint) {
  const id = providerId?.trim().toLowerCase();
  if (id !== void 0 && (isProviderKind(id, "go") || id === "opencode-go")) return true;
  if (!endpoint) return false;
  try {
    const url = new URL(endpoint);
    if (url.hostname.toLowerCase() !== "opencode.ai") return false;
    return url.pathname.split("/").some((segment) => segment.toLowerCase() === "go");
  } catch {
    return false;
  }
}
function mergeHeaders(base, overrides) {
  const result = {};
  for (const [key, value] of Object.entries(base ?? {})) {
    if (typeof value === "string") result[key] = value;
  }
  for (const [key, value] of Object.entries(overrides ?? {})) {
    for (const existing of Object.keys(result)) {
      if (existing.toLowerCase() === key.toLowerCase()) delete result[existing];
    }
    result[key] = value;
  }
  return result;
}
function openCodeGoHeaders(providerId, endpoint, sessionId, baseHeaders, options) {
  if (!isOpenCodeGoEndpoint(providerId, endpoint)) return void 0;
  let normalizedSessionId = sanitizeSessionId(sessionId);
  if (!normalizedSessionId && (options?.generateFallbackSession ?? true)) {
    normalizedSessionId = `relay-${randomUUID()}`;
  }
  return mergeHeaders(baseHeaders, {
    "User-Agent": RELAY_USER_AGENT,
    ...normalizedSessionId ? { [OPENCODE_SESSION_HEADER]: normalizedSessionId } : {}
  });
}

export {
  OPENCODE_SESSION_HEADER,
  extractConversationId,
  mergeHeaders,
  openCodeGoHeaders
};
//# sourceMappingURL=chunk-IGBLHT37.js.map