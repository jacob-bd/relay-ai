// version.ts — resolve the Codex client version Relay advertises on the
// ChatGPT Codex Responses-Lite transport.
//
// OpenAI gates new models behind a minimum Codex client version sent as the
// `version` header. A hard-coded constant rots on every gate (0.144.1 →
// 0.153.4 → 0.155.1), so resolve it at runtime instead:
//
//   1. RELAY_AI_CODEX_VERSION override (support/debug only, undocumented)
//   2. npm registry latest for @openai/codex (covers machines with no CLI)
//   3. installed `codex --version`
//   4. bundled CODEX_RESPONSES_LITE_VERSION fallback
//
// Results are cached per process (24h TTL). Unit tests run with the bundled
// fallback so no test performs network or binary probes.

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CODEX_RESPONSES_LITE_VERSION } from '../constants.js';
import { getAppPathOverride } from '../config.js';
import { findBinaryOnPath } from '../binary-lookup.js';
import { runCodexCommandSync } from './process.js';

// NOTE: This module must stay import-cycle free: provider-factory.ts imports
// it, so it cannot import codex/launch.ts (which reaches codex-proxy.ts).
// The Codex binary lookup below is intentionally local and minimal.
const isWindows = process.platform === 'win32';

export const CODEX_NPM_LATEST_URL = 'https://registry.npmjs.org/@openai/codex/latest';
export const CODEX_VERSION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const NPM_FETCH_TIMEOUT_MS = 3_000;

let cached: { version: string; fetchedAt: number } | null = null;
let inflight: Promise<string> | null = null;

/** Clear the process cache. Test-only. */
export function resetCodexClientVersionCache(): void {
  cached = null;
  inflight = null;
}

export function parseCodexVersion(input: string): string | null {
  const match = input.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

function versionTuple(version: string): [number, number, number] | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Highest of the parseable candidates; falls back to the first entry. */
export function maxCodexVersion(candidates: Array<string | null | undefined>): string {
  let best: string | null = null;
  let bestTuple: [number, number, number] | null = null;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const tuple = versionTuple(candidate);
    if (!tuple) continue;
    // Lexicographic numeric comparison.
    const greater = !bestTuple
      || (tuple[0] !== bestTuple[0] ? tuple[0] > bestTuple[0]
        : tuple[1] !== bestTuple[1] ? tuple[1] > bestTuple[1]
        : tuple[2] > bestTuple[2]);
    if (greater) {
      best = candidate;
      bestTuple = tuple;
    }
  }
  return best ?? candidates.find((c): c is string => !!c) ?? CODEX_RESPONSES_LITE_VERSION;
}

export async function fetchNpmCodexVersion(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = NPM_FETCH_TIMEOUT_MS,
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(CODEX_NPM_LATEST_URL, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { version?: unknown };
      return typeof body.version === 'string' ? parseCodexVersion(body.version) : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

const CODEX_VERSION_FALLBACK_PATHS = isWindows
  ? [
    join(process.env['APPDATA'] ?? homedir(), 'npm', 'codex.cmd'),
    join(process.env['APPDATA'] ?? homedir(), 'npm', 'codex'),
  ]
  : [
    join(homedir(), '.local', 'bin', 'codex'),
    join(homedir(), '.npm', 'bin', 'codex'),
    '/usr/local/bin/codex',
    '/opt/homebrew/bin/codex',
  ];

function codexBinaryCandidates(): string[] {
  const override = getAppPathOverride('codex');
  if (override) return [override];
  const candidates: string[] = [];
  try {
    const result = execSync(isWindows ? 'where.exe codex' : 'which codex', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    candidates.push(...result.trim().split('\n').map(l => l.trim()).filter(Boolean));
  } catch {
    // fall through to fallback paths
  }
  candidates.push(...CODEX_VERSION_FALLBACK_PATHS);
  return [...new Set(candidates)];
}

export function installedCodexVersion(): string | null {
  for (const binary of codexBinaryCandidates()) {
    try {
      if (!existsSync(binary)) continue;
      const { stdout } = runCodexCommandSync(binary, ['--version'], { timeout: 5_000 });
      const parsed = parseCodexVersion(stdout);
      if (parsed) return parsed;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * Resolve the Codex client version to advertise. Never throws — any failure
 * degrades to the bundled fallback.
 */
export async function resolveCodexClientVersion(opts: {
  forceRefresh?: boolean;
  fetchImpl?: typeof fetch;
} = {}): Promise<string> {
  const override = process.env['RELAY_AI_CODEX_VERSION']?.trim();
  if (override) return parseCodexVersion(override) ?? CODEX_RESPONSES_LITE_VERSION;
  // Deterministic unit tests: no network or binary probes.
  if (process.env['VITEST'] || process.env['VITEST_WORKER_ID']) {
    return cached?.version ?? CODEX_RESPONSES_LITE_VERSION;
  }

  const now = Date.now();
  if (!opts.forceRefresh && cached && now - cached.fetchedAt < CODEX_VERSION_CACHE_TTL_MS) {
    return cached.version;
  }
  if (inflight && !opts.forceRefresh) return inflight;

  inflight = (async () => {
    try {
      const [npm, local] = await Promise.all([
        fetchNpmCodexVersion(opts.fetchImpl),
        Promise.resolve().then(() => installedCodexVersion()),
      ]);
      const best = maxCodexVersion([npm, local, CODEX_RESPONSES_LITE_VERSION]);
      cached = { version: best, fetchedAt: Date.now() };
      return best;
    } catch {
      return cached?.version ?? CODEX_RESPONSES_LITE_VERSION;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
