// opencode-auth.ts — read OpenCode ~/.local/share/opencode/auth.json for one-time OAuth import

import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface OpencodeOAuthCredential {
  type: 'oauth';
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
  enterpriseUrl?: string;
  providerData?: Record<string, unknown>;
}

export interface OpencodeWellKnownCredential {
  type: 'wellknown';
  key: string;
  token: string;
}

export type OpencodeAuthEntry = OpencodeOAuthCredential | OpencodeWellKnownCredential | string;

export interface ReadOpencodeAuthResult {
  path: string;
  entries: Record<string, OpencodeAuthEntry>;
  permissionWarning?: string;
}

export function resolveOpencodeAuthPath(env: NodeJS.ProcessEnv = process.env): string {
  const dataHome = env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share');
  if (process.platform === 'win32') {
    return join(env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'), 'opencode', 'auth.json');
  }
  return join(dataHome, 'opencode', 'auth.json');
}

function decodeAuthEntry(value: unknown): OpencodeAuthEntry | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record['type'] === 'oauth'
    && typeof record['access'] === 'string'
    && typeof record['refresh'] === 'string'
    && typeof record['expires'] === 'number') {
    return {
      type: 'oauth',
      access: record['access'],
      refresh: record['refresh'],
      expires: record['expires'],
      accountId: typeof record['accountId'] === 'string' ? record['accountId'] : undefined,
      enterpriseUrl: typeof record['enterpriseUrl'] === 'string' ? record['enterpriseUrl'] : undefined,
    };
  }
  if (record['type'] === 'wellknown'
    && typeof record['key'] === 'string'
    && typeof record['token'] === 'string') {
    return { type: 'wellknown', key: record['key'], token: record['token'] };
  }
  return null;
}

/** Warn when auth.json is group/world readable (OpenCode uses 0600). */
export function authFilePermissionWarning(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  if (process.platform === 'win32') return undefined;
  try {
    const mode = statSync(path).mode & 0o777;
    if (mode & 0o077) {
      return `OpenCode auth file ${path} is readable by others (mode ${mode.toString(8)}). Consider chmod 600.`;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function readOpencodeAuthFile(env: NodeJS.ProcessEnv = process.env): ReadOpencodeAuthResult | null {
  const path = resolveOpencodeAuthPath(env);
  if (!existsSync(path)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { path, entries: {}, permissionWarning: authFilePermissionWarning(path) };
  }

  const entries: Record<string, OpencodeAuthEntry> = {};
  if (parsed && typeof parsed === 'object') {
    for (const [providerId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = decodeAuthEntry(value);
      if (entry) entries[providerId] = entry;
    }
  }

  return {
    path,
    entries,
    permissionWarning: authFilePermissionWarning(path),
  };
}

export function isOpencodeOAuth(entry: OpencodeAuthEntry | undefined): entry is OpencodeOAuthCredential {
  return !!entry && typeof entry === 'object' && entry.type === 'oauth';
}

export function oauthCredentialToKeychainJson(cred: OpencodeOAuthCredential): string {
  return JSON.stringify(cred);
}
