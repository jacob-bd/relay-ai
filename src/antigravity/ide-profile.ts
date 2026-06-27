import fs from 'node:fs';
import path from 'node:path';

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

  return profileDir;
}
