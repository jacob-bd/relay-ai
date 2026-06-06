// src/env.ts
import { CONFLICTING_ENV_VARS } from './constants.js';
import type { ConflictInfo } from './types.js';

export function detectConflicts(): ConflictInfo[] {
  return CONFLICTING_ENV_VARS
    .filter(name => process.env[name] !== undefined)
    .map(name => ({ name, value: process.env[name]! }));
}

export function resolveApiKey(): string | null {
  const key = process.env['OPENCODE_API_KEY'];
  // Treat empty string as missing — happens when .zshrc auto-load line runs
  // but the Keychain entry has been deleted (security command returns nothing)
  return key?.trim() || null;
}

export function buildChildEnv(
  baseUrl: string,
  model: string,
  apiKey: string,
  proxyPort?: number,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of CONFLICTING_ENV_VARS) {
    delete env[name];
  }
  env['ANTHROPIC_BASE_URL'] = proxyPort
    ? `http://127.0.0.1:${proxyPort}`
    : baseUrl;
  env['ANTHROPIC_API_KEY'] = apiKey;
  env['ANTHROPIC_MODEL'] = model;
  return env;
}

export async function readFromCredentialStore(): Promise<string | null> {
  try {
    const { Entry } = await import('@napi-rs/keyring');
    return new Entry('opencode-starter', 'opencode-starter').getPassword() ?? null;
  } catch {
    return null;
  }
}

export async function saveToCredentialStore(key: string): Promise<boolean> {
  try {
    const { Entry } = await import('@napi-rs/keyring');
    new Entry('opencode-starter', 'opencode-starter').setPassword(key);
    return true;
  } catch {
    return false;
  }
}

export async function isSecretServiceAvailable(): Promise<boolean> {
  try {
    const { Entry } = await import('@napi-rs/keyring');
    new Entry('opencode-starter-probe', 'probe').getPassword();
    return true;
  } catch {
    return false;
  }
}

