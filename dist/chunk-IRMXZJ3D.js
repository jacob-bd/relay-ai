#!/usr/bin/env node

// src/codex/upstream-error.ts
var TRACE_FIELD_LIMIT = 4e3;
var MAX_ERROR_MESSAGE_CHARS = 2e3;
function clipTraceField(value) {
  return value.length <= TRACE_FIELD_LIMIT ? value : `${value.slice(0, TRACE_FIELD_LIMIT)}\u2026`;
}
function safeUpstreamErrorFields(err, includeCause) {
  if (!err || typeof err !== "object") {
    return { message: clipTraceField(String(err)) };
  }
  const rec = err;
  const result = {};
  if (rec.name) result.name = rec.name;
  if (rec.message) result.message = clipTraceField(rec.message);
  if (rec.statusCode !== void 0) result.statusCode = rec.statusCode;
  if (rec.responseBody) result.responseBody = clipTraceField(rec.responseBody);
  if (rec.data?.error) {
    result.data = {
      error: {
        ...rec.data.error.type ? { type: rec.data.error.type } : {},
        ...rec.data.error.message ? { message: clipTraceField(rec.data.error.message) } : {}
      }
    };
  }
  if (rec.lastError) {
    result.lastError = {
      ...rec.lastError.message ? { message: clipTraceField(rec.lastError.message) } : {},
      ...rec.lastError.statusCode !== void 0 ? { statusCode: rec.lastError.statusCode } : {}
    };
  }
  if (rec.errors?.length) {
    result.errors = rec.errors.map((item) => ({
      ...item.message ? { message: clipTraceField(item.message) } : {},
      ...item.statusCode !== void 0 ? { statusCode: item.statusCode } : {}
    }));
  }
  if (includeCause && rec.cause !== void 0) {
    result.cause = safeUpstreamErrorFields(rec.cause, false);
  }
  return result;
}
function formatUpstreamErrorTrace(err) {
  return JSON.stringify(safeUpstreamErrorFields(err, true));
}
function joinProviderMessage(message) {
  return message.split("\n").map((line) => line.trim()).filter(Boolean).join(" ");
}
function formatUpstreamError(err) {
  if (!err || typeof err !== "object") return "Upstream model request failed.";
  const rec = err;
  if (rec.data?.error?.message) {
    const short = joinProviderMessage(rec.data.error.message);
    return rec.statusCode ? `${short} (HTTP ${rec.statusCode})` : short;
  }
  if (rec.responseBody) {
    try {
      const parsed = JSON.parse(rec.responseBody);
      const providerMessage = parsed.error?.message ?? (typeof parsed.detail === "string" ? parsed.detail : void 0);
      if (providerMessage) {
        const short = joinProviderMessage(providerMessage);
        return rec.statusCode ? `${short} (HTTP ${rec.statusCode})` : short;
      }
    } catch {
    }
  }
  const last = rec.lastError;
  if (last?.message) {
    const code = last.statusCode;
    const short = sanitizeMessage(last.message);
    return code ? `${short} (HTTP ${code})` : short;
  }
  const fromList = rec.errors?.[rec.errors.length - 1];
  if (fromList?.message) {
    const short = sanitizeMessage(fromList.message);
    return fromList.statusCode ? `${short} (HTTP ${fromList.statusCode})` : short;
  }
  if (rec.message) {
    const short = sanitizeMessage(rec.message);
    if (short && !short.includes("file://") && !short.includes("APICallError") && short.length < MAX_ERROR_MESSAGE_CHARS) {
      return rec.statusCode ? `${short} (HTTP ${rec.statusCode})` : short;
    }
  }
  return "Upstream model request failed.";
}
function upstreamHttpStatus(err, message) {
  if (err && typeof err === "object" && "statusCode" in err) {
    const code = err.statusCode;
    if (code === 400 || code === 401 || code === 403 || code === 404 || code === 429) return code;
  }
  if (message.includes("HTTP 429") || message.includes("429")) return 429;
  if (message.includes("HTTP 400")) return 400;
  return 500;
}
function anthropicErrorType(status) {
  switch (status) {
    case 400:
      return "invalid_request_error";
    case 401:
      return "authentication_error";
    case 403:
      return "permission_error";
    case 404:
      return "not_found_error";
    case 429:
      return "rate_limit_error";
    default:
      return "api_error";
  }
}
function jsonErrorMessage(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return void 0;
  try {
    const parsed = JSON.parse(trimmed);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    const msg = first?.error?.message ?? first?.message;
    if (typeof msg === "string" && msg.trim()) return joinProviderMessage(msg);
  } catch {
    const match = trimmed.match(/"message"\s*:\s*"((?:[^"\\]|\\.)+)"/);
    if (match?.[1]) return joinProviderMessage(match[1].replace(/\\"/g, '"'));
  }
  return void 0;
}
function sanitizeMessage(message) {
  const fromJson = jsonErrorMessage(message);
  if (fromJson) return fromJson;
  const line = message.split("\n")[0]?.trim() ?? message;
  if (line.startsWith("RetryError") || line.includes("AI_RetryError")) {
    return "Upstream model request failed after retries.";
  }
  return line;
}

export {
  formatUpstreamErrorTrace,
  formatUpstreamError,
  upstreamHttpStatus,
  anthropicErrorType
};
//# sourceMappingURL=chunk-IRMXZJ3D.js.map