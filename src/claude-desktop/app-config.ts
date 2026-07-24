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
