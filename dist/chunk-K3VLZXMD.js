#!/usr/bin/env node
import {
  getAppHome
} from "./chunk-XEH2JMTL.js";

// src/ui-lock.ts
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import pc from "picocolors";
var DEFAULT_SERVER_UI_PORT = 8787;
function lockFile() {
  return join(getAppHome(), "ui.lock");
}
function removeLock() {
  try {
    unlinkSync(lockFile());
  } catch {
  }
}
function readUiLock() {
  try {
    return JSON.parse(readFileSync(lockFile(), "utf8"));
  } catch {
    return null;
  }
}
function writeUiLock(port, mode, background = false) {
  mkdirSync(getAppHome(), { recursive: true });
  writeFileSync(lockFile(), JSON.stringify({ pid: process.pid, port, mode, ...background ? { background: true } : {} }));
}
function removeOwnUiLock() {
  try {
    const { pid } = JSON.parse(readFileSync(lockFile(), "utf8"));
    if (pid === process.pid) unlinkSync(lockFile());
  } catch {
  }
}
async function probeServerHealth(port) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 500);
    const res = await fetch(`http://127.0.0.1:${port}/api/config`, { signal: controller.signal });
    clearTimeout(timer);
    if (res.status === 200) {
      const data = await res.json().catch(() => null);
      if (data && typeof data === "object") return true;
    }
    return false;
  } catch {
    return false;
  }
}
async function checkExistingServer() {
  if (!existsSync(lockFile())) return null;
  try {
    const { pid, port } = JSON.parse(readFileSync(lockFile(), "utf8"));
    if (pid === process.pid) {
      removeLock();
      return null;
    }
    process.kill(pid, 0);
    const isAlive = await probeServerHealth(port ?? DEFAULT_SERVER_UI_PORT);
    if (!isAlive) {
      removeLock();
      return null;
    }
    return `http://127.0.0.1:${port}`;
  } catch {
    removeLock();
    return null;
  }
}
function formatUiAvailableLine(url) {
  return `  ${pc.bold("Server available at")} ${pc.cyan(url)}`;
}

export {
  DEFAULT_SERVER_UI_PORT,
  removeLock,
  readUiLock,
  writeUiLock,
  removeOwnUiLock,
  probeServerHealth,
  checkExistingServer,
  formatUiAvailableLine
};
//# sourceMappingURL=chunk-K3VLZXMD.js.map