import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getLogsPath } from '../paths.js';

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
export const CODEX_ROUTE_AUDIT_LOG = 'codex-route-audit.jsonl';

export type CodexRouteAuditTransport = 'http' | 'ws';
export type CodexRouteAuditDispatch = 'native' | 'relay' | 'relay-subagent' | 'unknown';
export type CodexRouteAuditPhase = 'dispatch' | 'complete';

export interface CodexRouteAuditEvent {
  transport: CodexRouteAuditTransport;
  requestedModel: string;
  dispatch: CodexRouteAuditDispatch;
  phase: CodexRouteAuditPhase;
  provider?: string;
  routeModel?: string;
  upstreamModel?: string;
  outcome?: 'ok' | 'error';
  status?: number | string;
}

function safeIdentifier(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.replace(/[\u0000-\u001f\u007f]/g, '_').slice(0, 300);
}

export function sanitizeCodexRouteAuditEvent(event: CodexRouteAuditEvent): Record<string, unknown> {
  return {
    ts: new Date().toISOString(),
    transport: event.transport,
    requestedModel: safeIdentifier(event.requestedModel),
    dispatch: event.dispatch,
    phase: event.phase,
    ...(event.provider ? { provider: safeIdentifier(event.provider) } : {}),
    ...(event.routeModel ? { routeModel: safeIdentifier(event.routeModel) } : {}),
    ...(event.upstreamModel ? { upstreamModel: safeIdentifier(event.upstreamModel) } : {}),
    ...(event.outcome ? { outcome: event.outcome } : {}),
    ...(event.status !== undefined ? { status: typeof event.status === 'string' ? safeIdentifier(event.status) : event.status } : {}),
  };
}

export function getCodexRouteAuditLogPath(): string {
  const dir = getLogsPath();
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  try { chmodSync(dir, DIR_MODE); } catch { /* best-effort */ }
  return join(dir, CODEX_ROUTE_AUDIT_LOG);
}

export function prepareCodexRouteAuditLog(path = getCodexRouteAuditLogPath()): string {
  writeFileSync(path, '', { mode: FILE_MODE });
  chmodSync(path, FILE_MODE);
  return path;
}

export function appendCodexRouteAudit(path: string, event: CodexRouteAuditEvent): void {
  try {
    writeFileSync(path, `${JSON.stringify(sanitizeCodexRouteAuditEvent(event))}\n`, { flag: 'a', mode: FILE_MODE });
    chmodSync(path, FILE_MODE);
  } catch {
    // Route auditing is evidence-only and must not interrupt a live request.
  }
}
