import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export function getClaudeDesktopHome(): string {
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Claude-3p');
  }
  if (process.platform === 'linux') {
    // Electron's userData on Linux is $XDG_CONFIG_HOME (or ~/.config) + productName.
    // Claude Desktop's Third-Party (3P) inference config lives at that path + "-3p".
    return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'Claude-3p');
  }
  return join(homedir(), 'Library', 'Application Support', 'Claude-3p');
}

export function getConfigLibraryPath(): string {
  return join(getClaudeDesktopHome(), 'configLibrary');
}

export function getMetaJsonPath(): string {
  return join(getConfigLibraryPath(), '_meta.json');
}

export function getClaudeDesktopConfigJsonPath(): string {
  return join(getClaudeDesktopHome(), 'claude_desktop_config.json');
}

/**
 * Claude Desktop refuses third-party mode when its 3P `claude_desktop_config.json`
 * pins `deploymentMode: "1p"` — the applied gateway config in `configLibrary/` is
 * then read but ignored (verified by decompiling Claude Desktop 1.52386.3: the 3P
 * gate reads this key from `userData-3p/claude_desktop_config.json` and short-circuits
 * to first-party when it is `"1p"`). The app writes that pin itself whenever the user
 * signs back into claude.ai, so a working relay session can silently stop routing:
 * the app launches, never contacts the proxy, and no model from the catalog appears.
 * Relay sets it to `"3p"` for the session and restores the prior value on cleanup.
 */
export type DeploymentMode = '3p' | '1p';

function readDesktopConfigJson(): Record<string, unknown> {
  const path = getClaudeDesktopConfigJsonPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function writeDesktopConfigJson(config: Record<string, unknown>): void {
  const path = getClaudeDesktopConfigJsonPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function readDeploymentMode(): DeploymentMode | null {
  const mode = readDesktopConfigJson()['deploymentMode'];
  return mode === '3p' || mode === '1p' ? mode : null;
}

/**
 * Force third-party mode and return the previous value so it can be restored
 * (`null` = the key was absent, which the app treats as "not pinned" and allows
 * 3P). Returns `undefined` when nothing had to change.
 */
export function applyDeploymentMode3p(): { previous: DeploymentMode | null } | undefined {
  const config = readDesktopConfigJson();
  const previous = readDeploymentMode();
  if (previous === '3p') return undefined;
  config['deploymentMode'] = '3p';
  writeDesktopConfigJson(config);
  return { previous };
}

/** Put `deploymentMode` back, preserving any other key the app wrote meanwhile. */
export function restoreDeploymentMode(previous: DeploymentMode | null): void {
  const config = readDesktopConfigJson();
  if (previous === null) delete config['deploymentMode'];
  else config['deploymentMode'] = previous;
  writeDesktopConfigJson(config);
}

export interface MetaJson {
  appliedId: string;
  entries: { id: string; name: string }[];
}

export function readMetaJson(): MetaJson | null {
  const metaPath = getMetaJsonPath();
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, 'utf8')) as MetaJson;
  } catch {
    return null;
  }
}

export function writeMetaJson(meta: MetaJson): void {
  const metaPath = getMetaJsonPath();
  mkdirSync(dirname(metaPath), { recursive: true });
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
}

export function buildRelayAiConfig(proxyPort: number) {
  return {
    inferenceProvider: 'gateway',
    inferenceGatewayBaseUrl: `http://127.0.0.1:${proxyPort}/anthropic`,
    inferenceGatewayApiKey: 'dummy',
    inferenceGatewayAuthScheme: 'bearer',
    coworkEgressAllowedHosts: ['*'],
  };
}

export function writeRelayAiConfig(proxyPort: number): string {
  const uuid = randomUUID();
  const configPath = join(getConfigLibraryPath(), `${uuid}.json`);
  const config = buildRelayAiConfig(proxyPort);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  // We must update _meta.json so Claude Desktop knows which config is active.
  const meta = readMetaJson() || { appliedId: '', entries: [] };
  meta.appliedId = uuid;
  if (!meta.entries.some((e: any) => e.id === uuid)) {
    meta.entries.push({ id: uuid, name: 'Relay AI Gateway' });
  }
  writeMetaJson(meta);

  return uuid;
}
