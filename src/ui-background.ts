// src/ui-background.ts — keep a Relay UI server running next to tool launches.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import pc from 'picocolors';
import { join } from 'node:path';
import { getAppHome } from './paths.js';
import { checkExistingServer, formatUiAvailableLine, readUiLock, removeLock } from './ui-lock.js';

const START_TIMEOUT_MS = 6_000;
const POLL_MS = 150;

export interface BackgroundUiEnv {
  env?: NodeJS.ProcessEnv;
  interactive?: boolean;
}

/** Tool launches get a UI only in an interactive terminal, and `RELAY_AI_NO_UI=1` opts out. */
export function shouldEnsureBackgroundUi(opts: { dryRun?: boolean } & BackgroundUiEnv = {}): boolean {
  const env = opts.env ?? process.env;
  if (opts.dryRun) return false;
  if (env.RELAY_AI_NO_UI === '1' || env.RELAY_AI_UI_MODE === 'server') return false;
  return opts.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function cliEntryPath(): string | undefined {
  const entry = process.argv[1];
  if (!entry) return undefined;
  try {
    return realpathSync(entry);
  } catch {
    return entry;
  }
}

async function waitForServer(timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = await checkExistingServer();
    if (url) return url;
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
  return null;
}

/**
 * Reuse the running Relay UI, or start a detached one that outlives the tool. Never opens a browser
 * and never throws: a UI that fails to start must not block the launch.
 */
export async function ensureBackgroundUi(): Promise<string | null> {
  try {
    const existing = await checkExistingServer();
    if (existing) return existing;
    const entry = cliEntryPath();
    if (!entry) return null;
    const child = spawn(process.execPath, [entry, 'ui', '--background'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: process.env,
    });
    child.on('error', () => {});
    child.unref();
    return await waitForServer(START_TIMEOUT_MS);
  } catch {
    return null;
  }
}

let announcedUiUrl: string | null = null;

function clientsDir(): string {
  return join(getAppHome(), 'ui-clients');
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Record this tool launch as a user of the background UI. Never throws. */
function registerUiClient(): void {
  try {
    mkdirSync(clientsDir(), { recursive: true });
    writeFileSync(join(clientsDir(), String(process.pid)), '');
  } catch {}
}

/**
 * Called when a tool launch ends (CLI tool, desktop app or IDE launcher alike). Removes this launch from the
 * UI's users and, if the UI was started by a tool launch and no other live launch still uses it, stops it.
 * A UI started with `relay-ai ui` is never stopped here. Synchronous so it can run from `process.on('exit')`.
 */
export function releaseBackgroundUi(): void {
  try {
    try { unlinkSync(join(clientsDir(), String(process.pid))); } catch {}
    const lock = readUiLock();
    if (!lock?.background || typeof lock.pid !== 'number' || lock.pid === process.pid) return;
    let othersUsingIt = false;
    if (existsSync(clientsDir())) {
      for (const name of readdirSync(clientsDir())) {
        const pid = Number(name);
        if (!Number.isInteger(pid) || pid === process.pid) continue;
        if (pidAlive(pid)) othersUsingIt = true;
        else { try { unlinkSync(join(clientsDir(), name)); } catch {} }
      }
    }
    if (othersUsingIt) return;
    try { process.kill(lock.pid, 'SIGTERM'); } catch {}
    removeLock();
  } catch {}
}

/** Make sure a UI is running and remember its URL; it is printed later by `printUiUrlLast`. */
export async function announceBackgroundUi(): Promise<void> {
  announcedUiUrl = await ensureBackgroundUi();
  if (!announcedUiUrl) return;
  registerUiClient();
  process.once('exit', releaseBackgroundUi);
}

/**
 * Print the UI address as the last thing the launcher shows (call right before the tool takes over
 * or the launcher starts waiting), so it is not buried in setup output. Prints at most once per run.
 */
export function printUiUrlLast(): void {
  if (!announcedUiUrl) return;
  const url = announcedUiUrl;
  announcedUiUrl = null;
  console.log(`\n${formatUiAvailableLine(url)}\n`);
}
