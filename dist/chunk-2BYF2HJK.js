#!/usr/bin/env node
import {
  checkExistingServer,
  formatUiAvailableLine
} from "./chunk-3O4SXHER.js";

// src/ui-background.ts
import { spawn } from "child_process";
import { realpathSync } from "fs";
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
async function announceBackgroundUi() {
  announcedUiUrl = await ensureBackgroundUi();
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
  announceBackgroundUi,
  printUiUrlLast
};
//# sourceMappingURL=chunk-2BYF2HJK.js.map