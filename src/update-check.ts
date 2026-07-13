import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { VERSION } from './constants.js';
import { getAppHome } from './paths.js';

export const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_CHECK_TIMEOUT_MS = 2_000;
export const UPDATE_COMMAND = 'npm install -g @jacobbd/relay-ai@latest';

const REGISTRY_URL = 'https://registry.npmjs.org/@jacobbd%2Frelay-ai/latest';
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

interface ParsedVersion {
  core: [number, number, number];
  prerelease: string[];
}

interface UpdateCache {
  latestVersion: string;
  checkedAt: number;
}

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
}

interface UpdateCheckOptions {
  fetchImpl?: typeof fetch;
  now?: number;
  timeoutMs?: number;
}

function parseVersion(version: string): ParsedVersion | null {
  const match = SEMVER_PATTERN.exec(version);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split('.') ?? [],
  };
}

function comparePrerelease(current: string[], latest: string[]): number {
  if (current.length === 0 || latest.length === 0) {
    if (current.length === latest.length) return 0;
    return current.length === 0 ? -1 : 1;
  }

  const length = Math.max(current.length, latest.length);
  for (let i = 0; i < length; i++) {
    const currentPart = current[i];
    const latestPart = latest[i];
    if (currentPart === undefined) return 1;
    if (latestPart === undefined) return -1;
    if (currentPart === latestPart) continue;

    const currentNumber = /^\d+$/.test(currentPart) ? Number(currentPart) : null;
    const latestNumber = /^\d+$/.test(latestPart) ? Number(latestPart) : null;
    if (currentNumber !== null && latestNumber !== null) return latestNumber > currentNumber ? 1 : -1;
    if (currentNumber !== null) return 1;
    if (latestNumber !== null) return -1;
    return latestPart > currentPart ? 1 : -1;
  }
  return 0;
}

export function isNewerVersion(currentVersion: string, latestVersion: string): boolean {
  const current = parseVersion(currentVersion);
  const latest = parseVersion(latestVersion);
  if (!current || !latest) return false;

  for (let i = 0; i < current.core.length; i++) {
    if (current.core[i] === latest.core[i]) continue;
    return latest.core[i]! > current.core[i]!;
  }
  return comparePrerelease(current.prerelease, latest.prerelease) > 0;
}

function cachePath(): string {
  return join(getAppHome(), 'update-check.json');
}

function readFreshCache(now: number): UpdateCache | null {
  try {
    const parsed = JSON.parse(readFileSync(cachePath(), 'utf8')) as Partial<UpdateCache>;
    if (typeof parsed.latestVersion !== 'string' || !parseVersion(parsed.latestVersion)) return null;
    if (typeof parsed.checkedAt !== 'number' || !Number.isFinite(parsed.checkedAt)) return null;
    const age = now - parsed.checkedAt;
    if (age < 0 || age >= UPDATE_CHECK_TTL_MS) return null;
    return { latestVersion: parsed.latestVersion, checkedAt: parsed.checkedAt };
  } catch {
    return null;
  }
}

function writeCache(cache: UpdateCache): void {
  const directory = getAppHome();
  const path = cachePath();
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(temporaryPath, `${JSON.stringify(cache)}\n`, { mode: 0o600 });
    renameSync(temporaryPath, path);
    try { chmodSync(path, 0o600); } catch {}
  } catch {
    try { unlinkSync(temporaryPath); } catch {}
  }
}

function statusFor(latestVersion: string | null): UpdateStatus {
  return {
    currentVersion: VERSION,
    latestVersion,
    updateAvailable: latestVersion !== null && isNewerVersion(VERSION, latestVersion),
  };
}

export async function checkForUpdates(options: UpdateCheckOptions = {}): Promise<UpdateStatus> {
  const now = options.now ?? Date.now();
  const cached = readFreshCache(now);
  if (cached) return statusFor(cached.latestVersion);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? UPDATE_CHECK_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)(REGISTRY_URL, {
      headers: { Accept: 'application/json', 'User-Agent': `relay-ai/${VERSION}` },
      signal: controller.signal,
    });
    if (!response.ok) return statusFor(null);
    const body = await response.json() as { version?: unknown };
    if (typeof body.version !== 'string' || !parseVersion(body.version)) return statusFor(null);
    writeCache({ latestVersion: body.version, checkedAt: now });
    return statusFor(body.version);
  } catch {
    return statusFor(null);
  } finally {
    clearTimeout(timer);
  }
}

export function formatUpdateNotification(currentVersion: string, latestVersion: string): string {
  return `🔔 Update available: ${currentVersion} → ${latestVersion}. Run ${UPDATE_COMMAND} to update.`;
}
