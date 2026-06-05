// src/env.ts
import { CONFLICTING_ENV_VARS } from './constants.js';
import type { BackendConfig, ConflictInfo } from './types.js';

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
  backend: BackendConfig,
  model: string,
  apiKey: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of CONFLICTING_ENV_VARS) {
    delete env[name];
  }
  env['ANTHROPIC_BASE_URL'] = backend.baseUrl;
  env['ANTHROPIC_API_KEY'] = apiKey;
  env['ANTHROPIC_MODEL'] = model;
  return env;
}
