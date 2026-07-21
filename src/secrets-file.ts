// src/secrets-file.ts — file-backed credential store when OS keyring is unavailable.
// Prefer keyring; this is the RELAY_AI_HOME fallback (Docker / headless).

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { getAppHome, getSecretsPath } from './paths.js';

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export interface SecretsFile {
  version: 1;
  accounts: Record<string, string>;
}

function emptySecrets(): SecretsFile {
  return { version: 1, accounts: {} };
}

export function readSecretsFile(env: NodeJS.ProcessEnv = process.env): SecretsFile {
  const path = getSecretsPath(env);
  if (!existsSync(path)) return emptySecrets();
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<SecretsFile>;
    if (raw?.version !== 1 || !raw.accounts || typeof raw.accounts !== 'object') {
      return emptySecrets();
    }
    const accounts: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.accounts)) {
      if (typeof v === 'string' && v.length > 0) accounts[k] = v;
    }
    return { version: 1, accounts };
  } catch {
    return emptySecrets();
  }
}

function writeSecretsFile(data: SecretsFile, env: NodeJS.ProcessEnv = process.env): void {
  const home = getAppHome(env);
  mkdirSync(home, { recursive: true, mode: DIR_MODE });
  try {
    chmodSync(home, DIR_MODE);
  } catch {
    // best-effort
  }
  const path = getSecretsPath(env);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: FILE_MODE });
  try {
    chmodSync(path, FILE_MODE);
  } catch {
    // best-effort (mode on create is ignored if the file already existed)
  }
}

export function readFileAccount(account: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const value = readSecretsFile(env).accounts[account];
  return value?.length ? value : null;
}

export function writeFileAccount(
  account: string,
  value: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!account || !value) return false;
  try {
    const data = readSecretsFile(env);
    data.accounts[account] = value;
    writeSecretsFile(data, env);
    return true;
  } catch {
    return false;
  }
}

export function deleteFileAccount(account: string, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    const data = readSecretsFile(env);
    if (!(account in data.accounts)) return true;
    delete data.accounts[account];
    writeSecretsFile(data, env);
    return true;
  } catch {
    return false;
  }
}
