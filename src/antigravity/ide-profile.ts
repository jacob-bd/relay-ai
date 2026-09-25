import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

/** IDE state key holding the last model picked in the agent panel. */
const MODEL_PREFERENCES_KEY = 'antigravityUnifiedStateSync.modelPreferences';

/**
 * Forget the model the IDE last had selected, so it opens on the catalog's
 * default — the model chosen at launch.
 *
 * The IDE remembers that pick by its hidden model enum, but Relay reassigns
 * enums on every launch (native slots and Relay-only entries follow catalog
 * order), so a remembered enum reopens on whichever model holds it now.
 * Only Relay's own isolated profile is touched, and only while the IDE is
 * closed. Best effort: without `node:sqlite` (Node < 22.13) nothing changes.
 */
export function clearSavedModelSelection(profileDir: string): boolean {
  const dbPath = path.join(profileDir, 'User', 'globalStorage', 'state.vscdb');
  if (!fs.existsSync(dbPath)) return false;
  const originalEmitWarning = process.emitWarning;
  try {
    // node:sqlite prints an ExperimentalWarning on load; keep the launch output clean.
    process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
      const text = typeof warning === 'string' ? warning : warning.message;
      if (text.includes('SQLite')) return;
      (originalEmitWarning as (...args: unknown[]) => void).call(process, warning, ...rest);
    }) as typeof process.emitWarning;
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    try {
      return Number(db.prepare('DELETE FROM ItemTable WHERE key = ?').run(MODEL_PREFERENCES_KEY).changes) > 0;
    } finally {
      db.close();
    }
  } catch {
    return false;
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

/**
 * Read the settings.json file from the specified path.
 *
 * @param settingsPath Absolute path to settings.json
 * @returns Parsed JSON settings object, or empty object if not found or malformed
 */
export function readIdeSettings(settingsPath: string): Record<string, any> {
  if (!fs.existsSync(settingsPath)) return {};
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    return JSON.parse(raw) as Record<string, any>;
  } catch {
    return {};
  }
}

/**
 * Write a settings object atomically back to the specified path.
 *
 * @param settingsPath Absolute path to settings.json
 * @param settings Settings object to write
 */
export function writeIdeSettings(settingsPath: string, settings: Record<string, any>): void {
  const tempPath = `${settingsPath}.tmp-${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(settings, null, 2), 'utf8');
  fs.renameSync(tempPath, settingsPath);
}

/**
 * Prepare an isolated, Relay-owned profile directory for the Antigravity IDE.
 *
 * It creates the `User` directory, reads any existing `settings.json`, updates/sets
 * `jetski.cloudCodeUrl` to our randomized gateway URL, and writes it back atomically.
 * It also restricts permissions of the profile directory to 0700 for security.
 *
 * @param profileDir Absolute path to the isolated profile directory
 * @param gatewayUrl The randomized local gateway URL
 * @returns The resolved profile directory path
 */
export function prepareIdeProfile(profileDir: string, gatewayUrl: string): string {
  // 1. Create the directory with 0700 permissions (rwx------)
  fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });

  const userDir = path.join(profileDir, 'User');
  fs.mkdirSync(userDir, { recursive: true });

  const settingsPath = path.join(userDir, 'settings.json');
  const settings = readIdeSettings(settingsPath);

  // 2. Set/update only the jetski.cloudCodeUrl parameter
  settings['jetski.cloudCodeUrl'] = gatewayUrl;
  settings['telemetry.telemetryLevel'] = 'off';
  settings['telemetry.enableTelemetry'] = false;
  settings['telemetry.enableCrashReporter'] = false;

  // 3. Write atomically to prevent corrupting settings on write failures
  writeIdeSettings(settingsPath, settings);

  // 4. Open on the launch model, not whatever now holds the last-picked enum
  clearSavedModelSelection(profileDir);

  return profileDir;
}
