#!/usr/bin/env node
import {
  checkExistingServer,
  formatUiAvailableLine,
  readUiLock,
  removeLock
} from "./chunk-K3VLZXMD.js";
import {
  getAppHome
} from "./chunk-XEH2JMTL.js";

// src/ui-background.ts
import { spawn } from "child_process";
import { existsSync, mkdirSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
var START_TIMEOUT_MS = 6e3;
var POLL_MS = 150;
function shouldEnsureBackgroundUi(opts = {}) {
  const env = opts.env ?? process.env;
  if (opts.dryRun) return false;
  if (env.RELAY_AI_NO_UI === "1" || env.RELAY_AI_UI_MODE === "server") return false;
  return opts.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
}
function cliEntryPath() {
  const entry = process.argv[1];
  if (!entry) return void 0;
  try {
    return realpathSync(entry);
  } catch {
    return entry;
  }
}
async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = await checkExistingServer();
    if (url) return url;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return null;
}
async function ensureBackgroundUi() {
  try {
    const existing = await checkExistingServer();
    if (existing) return existing;
    const entry = cliEntryPath();
    if (!entry) return null;
    const child = spawn(process.execPath, [entry, "ui", "--background"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: process.env
    });
    child.on("error", () => {
    });
    child.unref();
    return await waitForServer(START_TIMEOUT_MS);
  } catch {
    return null;
  }
}
var announcedUiUrl = null;
function clientsDir() {
  return join(getAppHome(), "ui-clients");
}
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function registerUiClient() {
  try {
    mkdirSync(clientsDir(), { recursive: true });
    writeFileSync(join(clientsDir(), String(process.pid)), "");
  } catch {
  }
}
function releaseBackgroundUi() {
  try {
    try {
      unlinkSync(join(clientsDir(), String(process.pid)));
    } catch {
    }
    const lock = readUiLock();
    if (!lock?.background || typeof lock.pid !== "number" || lock.pid === process.pid) return;
    let othersUsingIt = false;
    if (existsSync(clientsDir())) {
      for (const name of readdirSync(clientsDir())) {
        const pid = Number(name);
        if (!Number.isInteger(pid) || pid === process.pid) continue;
        if (pidAlive(pid)) othersUsingIt = true;
        else {
          try {
            unlinkSync(join(clientsDir(), name));
          } catch {
          }
        }
      }
    }
    if (othersUsingIt) return;
    try {
      process.kill(lock.pid, "SIGTERM");
    } catch {
    }
    removeLock();
  } catch {
  }
}
async function announceBackgroundUi() {
  announcedUiUrl = await ensureBackgroundUi();
  if (!announcedUiUrl) return;
  registerUiClient();
  process.once("exit", releaseBackgroundUi);
}
function printUiUrlLast() {
  if (!announcedUiUrl) return;
  const url = announcedUiUrl;
  announcedUiUrl = null;
  console.log(`
${formatUiAvailableLine(url)}
`);
}

export {
  shouldEnsureBackgroundUi,
  ensureBackgroundUi,
  releaseBackgroundUi,
  announceBackgroundUi,
  printUiUrlLast
};
//# sourceMappingURL=chunk-4BVKM3FX.js.map