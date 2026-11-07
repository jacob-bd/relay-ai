// src/ui-background.ts — keep a Relay UI server running next to tool launches.

import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import pc from 'picocolors';
import { checkExistingServer, formatUiAvailableLine } from './ui-lock.js';

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

export async function announceBackgroundUi(): Promise<void> {
  const url = await ensureBackgroundUi();
  if (url) console.log(`\n  ${pc.dim('Relay UI is running for live changes.')}\n${formatUiAvailableLine(url)}\n`);
}
