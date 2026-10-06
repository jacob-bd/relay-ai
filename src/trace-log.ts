// src/trace-log.ts — debug log paths under ~/.relay-ai/logs/ with secret redaction

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';
import { getLogsPath } from './paths.js';
import { redactCodexTraceValue } from './codex/trace-redaction.js';

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * Wall-clock timestamp in the server's local timezone, formatted
 * `YYYY-MM-DD HH:MM:SS` for human-facing log lines, so terminal and
 * debug-log timestamps match the clock on your wall. Replaces
 * `new Date().toISOString()` (UTC) in every text log line Relay writes.
 * Machine-parsed artifacts use `localIsoTimestamp()` instead, which keeps
 * the local time but stays ISO-8601-parseable.
 */
export function localTimestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Local-time ISO-8601 timestamp with explicit UTC offset
 * (`2026-10-05T14:23:11.204-04:00`). Use for timestamped artifacts that are
 * written to disk and may be parsed (`Date.parse`), compared, or read by
 * tools outside Relay: session locks, registry caches, audit JSONL. Carries
 * the same local wall-clock time as `localTimestamp()` but stays unambiguous
 * across timezones, DST transitions, and non-Node parsers.
 */
export function localIsoTimestamp(date: Date = new Date()): string {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  const local = new Date(date.getTime() + offsetMin * 60_000);
  return `${local.toISOString().slice(0, 23)}${sign}${hh}:${mm}`;
}

export const CLAUDE_DEBUG_LOG = 'claude-debug.log';
export const PROXY_DEBUG_LOG = 'proxy-debug.log';
export const CODEX_PROXY_DEBUG_LOG = 'codex-proxy-debug.log';
export const CODEX_BODY_DUMP_LOG = 'codex-body-dump.jsonl';
export const GEMINI_PROXY_DEBUG_LOG = 'gemini-proxy-debug.log';
export const PROVIDER_DEBUG_LOG = 'provider-debug.log';
export const UI_DEBUG_LOG = 'ui-debug.log';
export const SERVER_DEBUG_LOG = 'server-debug.log';

export function ensureLogsDir(): string {
  const dir = getLogsPath();
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  try {
    chmodSync(dir, DIR_MODE);
  } catch {
    // best-effort
  }
  return dir;
}

export function getClaudeDebugLogPath(): string {
  return join(ensureLogsDir(), CLAUDE_DEBUG_LOG);
}

export function prepareClaudeTraceLog(): string {
  const path = getClaudeDebugLogPath();
  resetTraceLog(path);
  return path;
}

export function getProxyDebugLogPath(): string {
  return join(ensureLogsDir(), PROXY_DEBUG_LOG);
}

export function getCodexProxyDebugLogPath(): string {
  return join(ensureLogsDir(), CODEX_PROXY_DEBUG_LOG);
}

/**
 * Untruncated JSONL dump of full Codex /v1/responses request/response bodies —
 * tools array and every input item, unlike the 500-char-clipped single-line
 * entries in codex-proxy-debug.log. Only written when --trace is on. Exists to
 * diagnose Codex tool-shape mismatches (MCP namespace tools, tool_search,
 * additional_tools, apply_patch) without reproducing against a live app twice.
 */
export function getCodexBodyDumpLogPath(): string {
  return join(ensureLogsDir(), CODEX_BODY_DUMP_LOG);
}

/** Remove prior session's body dump so --trace shows only the latest run. */
export function resetCodexBodyDumpLog(): void {
  resetTraceLog(getCodexBodyDumpLogPath());
}

/** Append one JSON object as a line to the codex body dump log, with secret redaction. */
export function appendCodexBodyDump(entry: Record<string, unknown>): void {
  ensureLogsDir();
  const path = getCodexBodyDumpLogPath();
  const redacted = redactTraceLine(JSON.stringify(redactCodexTraceValue(entry)));
  try {
    writeFileSync(path, `${redacted}\n`, { flag: 'a', mode: FILE_MODE });
    chmodSync(path, FILE_MODE);
  } catch {
    // best-effort
  }
}

export function getGeminiProxyDebugLogPath(): string {
  return join(ensureLogsDir(), GEMINI_PROXY_DEBUG_LOG);
}

export function getProviderDebugLogPath(): string {
  return join(ensureLogsDir(), PROVIDER_DEBUG_LOG);
}

export function getUiDebugLogPath(): string {
  return join(ensureLogsDir(), UI_DEBUG_LOG);
}

export function getServerDebugLogPath(): string {
  return join(ensureLogsDir(), SERVER_DEBUG_LOG);
}

export function getAntigravityDebugLogPath(tracePrefix: string): string {
  const surface = tracePrefix === 'antigravity' ? 'app' : tracePrefix;
  return join(ensureLogsDir(), `antigravity-${surface}-debug.log`);
}

export function prepareProviderTraceLog(): string {
  const path = getProviderDebugLogPath();
  resetTraceLog(path);
  try {
    writeFileSync(path, '', { mode: FILE_MODE });
    chmodSync(path, FILE_MODE);
  } catch {
    // best-effort
  }
  return path;
}

/** Reset log file and return a writer that redacts secrets. */
export function makeTraceLogger(logPath: string): (message: string) => void {
  resetTraceLog(logPath);
  return (message: string) => writeSecureLogLine(logPath, `${localTimestamp()} ${message}`);
}

/** Remove prior session log so --trace shows only the latest run. */
export function resetTraceLog(path: string): void {
  ensureLogsDir();
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // ignore
    }
  }
}

const REDACTION_PATTERNS: Array<(line: string) => string> = [
  // Bearer / Authorization headers
  line => line.replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, 'Bearer [REDACTED]'),
  line => line.replace(/("authorization"\s*:\s*")[^"]+/gi, '$1[REDACTED]'),
  line => line.replace(/(x-api-key"\s*:\s*")[^"]+/gi, '$1[REDACTED]'),
  // Common API key prefixes
  line => line.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]'),
  line => line.replace(/\bsk-ant-[A-Za-z0-9_-]{8,}\b/g, 'sk-ant-[REDACTED]'),
  line => line.replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, 'AIza[REDACTED]'),
  line => line.replace(/\bgsk_[A-Za-z0-9]{20,}\b/g, 'gsk_[REDACTED]'),
];

export function redactTraceLine(line: string): string {
  let out = line;
  for (const apply of REDACTION_PATTERNS) {
    out = apply(out);
  }
  return out;
}

export function redactTraceLog(content: string): string {
  return content.split('\n').map(redactTraceLine).join('\n');
}

export function writeSecureLogLine(path: string, line: string): void {
  ensureLogsDir();
  const redacted = redactTraceLine(line);
  try {
    writeFileSync(path, `${redacted}\n`, { flag: 'a', mode: FILE_MODE });
    chmodSync(path, FILE_MODE);
  } catch {
    // ignore
  }
}

export function printTraceLog(debugLogPath: string): void {
  if (!existsSync(debugLogPath)) return;
  const raw = readFileSync(debugLogPath, 'utf8');
  const log = redactTraceLog(raw);
  const errorLines = log.split('\n').filter(l =>
    l.includes('error') || l.includes('Error') || l.includes('"type":"error"') || l.includes('status') || l.includes('resolveModel failed') || l.includes('resolveModel fallback'),
  );
  console.log('\n' + pc.bold(pc.cyan('── Debug trace ──')));
  if (errorLines.length > 0) {
    errorLines.slice(0, 30).forEach(l => console.log(pc.dim(l)));
  } else {
    console.log(pc.dim('(no errors found in debug log)'));
  }
  console.log(pc.dim(`Full log: ${debugLogPath}`));
}
