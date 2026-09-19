// opencode-serve.ts — import-only OpenCode binary discovery + ephemeral `opencode serve`

import { execSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { LocalProvider } from './types.js';
import { normalizeProviders, type RawProvider } from './providers.js';

const isWindows = process.platform === 'win32';

const OPENCODE_FALLBACK_PATHS = isWindows
  ? [
      join(process.env['APPDATA'] ?? homedir(), 'npm', 'opencode.cmd'),
      join(process.env['APPDATA'] ?? homedir(), 'npm', 'opencode'),
      join(homedir(), 'AppData', 'Roaming', 'npm', 'opencode.cmd'),
    ]
  : [
      join(homedir(), '.opencode', 'bin', 'opencode'),
      join(homedir(), '.local', 'bin', 'opencode'),
      join(homedir(), '.npm', 'bin', 'opencode'),
      '/usr/local/bin/opencode',
      '/opt/homebrew/bin/opencode',
    ];

export function findOpencodeBinary(): string | null {
  try {
    const result = execSync(isWindows ? 'where.exe opencode' : 'which opencode', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = result.trim().split('\n').map(l => l.trim()).filter(Boolean);
    // On Windows, prefer .cmd wrappers — spawn() can't execute bare scripts without shell:true
    const path = (isWindows ? lines.find(l => l.toLowerCase().endsWith('.cmd')) : null) ?? lines[0];
    if (path) return path;
  } catch {
    // command failed — try fallback paths
  }
  for (const path of OPENCODE_FALLBACK_PATHS) {
    if (existsSync(path)) return path;
  }
  return null;
}

export interface OpencodeServerBanner {
  generation: 'v1' | 'v2';
  url: string;
}

export function parseOpencodeServerBanner(output: string): OpencodeServerBanner | null {
  const v1 = /opencode server listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
  if (v1?.[1]) return { generation: 'v1', url: v1[1] };
  const v2 = /(?:^|\n)\s*server listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
  if (v2?.[1]) return { generation: 'v2', url: v2[1] };
  return null;
}

interface V2ModelCost {
  input?: number;
  output?: number;
  cache?: { read?: number; write?: number };
}

interface V2Model {
  id?: string;
  modelID?: string;
  providerID?: string;
  name?: string;
  family?: string;
  package?: string;
  settings?: Record<string, unknown>;
  cost?: V2ModelCost[];
  status?: string;
  enabled?: boolean;
  limit?: { context?: number; output?: number };
}

interface V2Integration {
  id?: string;
  name?: string;
  connections?: Array<{ type?: string; name?: string }>;
}

interface V2Provider {
  id?: string;
  package?: string;
  settings?: Record<string, unknown>;
}

function v2SdkPackage(packageName: string, baseUrl?: string): string {
  if (packageName.startsWith('aisdk:')) return packageName.slice('aisdk:'.length);
  if (!packageName.startsWith('@opencode/ai/providers/')) return packageName;

  const provider = packageName.slice('@opencode/ai/providers/'.length);
  const packages: Record<string, string> = {
    anthropic: '@ai-sdk/anthropic',
    'anthropic-compatible': '@ai-sdk/anthropic',
    openai: '@ai-sdk/openai',
    'openai-compatible': '@ai-sdk/openai-compatible',
    google: '@ai-sdk/google',
    'google-vertex': '@ai-sdk/google-vertex',
    xai: '@ai-sdk/xai',
    azure: '@ai-sdk/azure',
    'amazon-bedrock': '@ai-sdk/amazon-bedrock',
    openrouter: '@openrouter/ai-sdk-provider',
  };
  return packages[provider] ?? (baseUrl ? '@ai-sdk/openai-compatible' : '');
}

/** Convert OpenCode v2's split model/integration/provider APIs to the v1 import shape. */
export function normalizeV2Providers(
  models: unknown[],
  integrations: unknown[],
  providers: unknown[],
  env: NodeJS.ProcessEnv = process.env,
): RawProvider[] {
  const providerById = new Map<string, V2Provider>();
  for (const value of providers) {
    if (!value || typeof value !== 'object') continue;
    const provider = value as V2Provider;
    if (provider.id) providerById.set(provider.id, provider);
  }

  const v2Models = models.filter((value): value is V2Model => !!value && typeof value === 'object');
  const result: RawProvider[] = [];

  for (const value of integrations) {
    if (!value || typeof value !== 'object') continue;
    const integration = value as V2Integration;
    if (!integration.id || !integration.connections?.length) continue;

    const provider = providerById.get(integration.id);
    const rawModels: NonNullable<RawProvider['models']> = {};
    for (const model of v2Models) {
      if (model.providerID !== integration.id || !model.id) continue;
      if (model.enabled === false || model.status === 'deprecated') continue;

      const settings = { ...(provider?.settings ?? {}), ...(model.settings ?? {}) };
      const baseUrl = typeof settings['baseURL'] === 'string' ? settings['baseURL'] : undefined;
      const packageName = v2SdkPackage(model.package ?? provider?.package ?? '', baseUrl);
      if (!packageName) continue;

      const cost = model.cost?.[0];
      rawModels[model.id] = {
        id: model.id,
        name: model.name,
        family: model.family,
        api: {
          id: model.modelID ?? model.id,
          npm: packageName,
          url: baseUrl,
        },
        cost: cost && typeof cost.input === 'number' && typeof cost.output === 'number'
          ? {
              input: cost.input,
              output: cost.output,
              cache_read: cost.cache?.read,
              cache_write: cost.cache?.write,
            }
          : undefined,
        limit: model.limit,
      };
    }

    if (Object.keys(rawModels).length === 0) continue;
    const envConnection = integration.connections.find(connection => connection.type === 'env' && connection.name);
    result.push({
      id: integration.id,
      name: integration.name ?? integration.id,
      key: envConnection?.name ? env[envConnection.name] : undefined,
      configured: true,
      models: rawModels,
    });
  }

  return result;
}

async function fetchV2Data<T>(url: string, authHeader: string): Promise<T | null> {
  const response = await fetch(url, { headers: { authorization: authHeader } });
  if (!response.ok) return null;
  const body = await response.json() as { data?: T };
  return body.data ?? null;
}

/** Spawn ephemeral `opencode serve` and return either v1 or v2 provider data. Import only. */
export async function fetchRawOpencodeProviders(): Promise<RawProvider[] | null> {
  const binary = findOpencodeBinary();
  if (!binary) return null;

  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn> | null = null;
    let settled = false;
    const TIMEOUT_MS = 15_000;
    const password = randomBytes(24).toString('hex');
    const authHeader = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;

    const finish = (value: RawProvider[] | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child?.kill();
      } catch {
        // ignore
      }
      resolve(value);
    };

    const timer = setTimeout(() => {
      finish(null);
    }, TIMEOUT_MS);

    try {
      // On Windows, .cmd wrappers require cmd.exe /c — shell:true triggers DEP0190 in Node 22+
      child = isWindows
        ? spawn('cmd.exe', ['/c', binary, 'serve', '--port', '0'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, OPENCODE_SERVER_PASSWORD: password },
          })
        : spawn(binary, ['serve', '--port', '0'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, OPENCODE_SERVER_PASSWORD: password },
          });
    } catch {
      finish(null);
      return;
    }

    let portFound = false;
    let stdoutBuf = '';

    const onData = (chunk: Buffer): void => {
      if (portFound) return;
      stdoutBuf += chunk.toString();
      const banner = parseOpencodeServerBanner(stdoutBuf);
      if (!banner) return;
      portFound = true;

      if (banner.generation === 'v1') {
        fetch(`${banner.url}/config/providers`, { headers: { authorization: authHeader } })
          .then((res) => res.json())
          .then((data: unknown) => {
            const raw = (data as { providers?: RawProvider[] }).providers;
            finish(Array.isArray(raw) ? raw : null);
          })
          .catch(() => finish(null));
        return;
      }

      void (async () => {
        try {
          const integrations = await fetchV2Data<unknown[]>(`${banner.url}/api/integration`, authHeader);
          const models = await fetchV2Data<unknown[]>(`${banner.url}/api/model`, authHeader);
          if (!Array.isArray(integrations) || !Array.isArray(models)) {
            finish(null);
            return;
          }

          const connectedIds = integrations
            .filter((value): value is V2Integration => !!value && typeof value === 'object')
            .filter(integration => !!integration.id && !!integration.connections?.length)
            .map(integration => integration.id!);
          const providerValues = await Promise.all(connectedIds.map(id =>
            fetchV2Data<unknown>(`${banner.url}/api/provider/${encodeURIComponent(id)}`, authHeader),
          ));
          finish(normalizeV2Providers(models, integrations, providerValues.filter(value => value !== null)));
        } catch {
          finish(null);
        }
      })();
    };

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    child.on('error', () => {
      finish(null);
    });

    child.on('exit', () => {
      if (!settled) finish(null);
    });
  });
}

/** Spawn ephemeral `opencode serve`, fetch /config/providers, normalize. Import path only. */
export async function fetchLocalProviders(): Promise<LocalProvider[] | null> {
  const raw = await fetchRawOpencodeProviders();
  if (!raw) return null;
  return normalizeProviders(raw);
}
