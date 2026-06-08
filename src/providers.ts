// src/providers.ts
import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { LocalProvider, LocalProviderModel } from './types.js';
import { deriveBrand } from './models.js';
import { resolveContextWindow } from './context-window.js';

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
    const path = result.trim().split('\n')[0].trim();
    if (path) return path;
  } catch {
    // command failed — try fallback paths
  }
  for (const path of OPENCODE_FALLBACK_PATHS) {
    if (existsSync(path)) return path;
  }
  return null;
}

interface RawModel {
  id: string;
  name?: string;
  family?: string;
  api?: { npm?: string; url?: string };
  cost?: { input: number; output: number };
  limit?: { context?: number; output?: number };
}

interface RawProvider {
  id: string;
  name: string;
  key?: string;
  models?: Record<string, RawModel>;
}

export function resolveEndpoint(
  npm: string,
  apiUrl: string,
): { format: 'anthropic' | 'openai'; baseUrl?: string; completionsUrl?: string } | null {
  switch (npm) {
    case '@ai-sdk/anthropic':
      return {
        format: 'anthropic',
        baseUrl: (apiUrl || 'https://api.anthropic.com').replace(/\/v1\/?$/, ''),
      };
    case '@ai-sdk/openai-compatible':
      if (!apiUrl) return null;
      return {
        format: 'openai',
        completionsUrl: apiUrl.replace(/\/$/, '') + '/chat/completions',
      };
    case '@ai-sdk/openai':
      return {
        format: 'openai',
        completionsUrl: 'https://api.openai.com/v1/chat/completions',
      };
    case '@ai-sdk/google':
      return {
        format: 'openai',
        completionsUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      };
    case '@ai-sdk/groq':
      return {
        format: 'openai',
        completionsUrl: 'https://api.groq.com/openai/v1/chat/completions',
      };
    case '@ai-sdk/mistral':
      return {
        format: 'openai',
        completionsUrl: 'https://api.mistral.ai/v1/chat/completions',
      };
    case '@ai-sdk/xai':
      return {
        format: 'openai',
        completionsUrl: 'https://api.x.ai/v1/chat/completions',
      };
    case '@openrouter/ai-sdk-provider':
      return {
        format: 'openai',
        completionsUrl: (apiUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '') + '/chat/completions',
      };
    default:
      return null;
  }
}

export function normalizeProviders(raw: RawProvider[]): LocalProvider[] {
  const result: LocalProvider[] = [];

  for (const provider of raw) {
    // Skip OAuth/unconfigured providers
    if (!provider.key) continue;

    // Skip cloud backends handled separately
    if (provider.id === 'opencode' || provider.id === 'opencode-go') continue;

    const models: LocalProviderModel[] = [];

    for (const model of Object.values(provider.models ?? {})) {
      const endpoint = resolveEndpoint(model.api?.npm ?? '', model.api?.url ?? '');
      if (endpoint === null) continue;

      models.push({
        id: model.id,
        name: model.name ?? model.id,
        family: model.family ?? '',
        brand: deriveBrand(model.family ?? ''),
        modelFormat: endpoint.format,
        baseUrl: endpoint.baseUrl,
        completionsUrl: endpoint.completionsUrl,
        npm: model.api?.npm,
        apiBaseUrl: model.api?.url,
        cost: model.cost,
        contextWindow: resolveContextWindow(model.id, model.limit?.context),
      });
    }

    if (models.length === 0) continue;

    result.push({
      id: provider.id,
      name: provider.name,
      apiKey: provider.key,
      models,
    });
  }

  return result;
}

export async function fetchLocalProviders(): Promise<LocalProvider[] | null> {
  const binary = findOpencodeBinary();
  if (!binary) return null;

  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn> | null = null;
    let settled = false;
    const TIMEOUT_MS = 10_000;

    const finish = (value: LocalProvider[] | null): void => {
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
      child = spawn(binary, ['serve', '--port', '0'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      finish(null);
      return;
    }

    const portRegex = /opencode server listening on http:\/\/127\.0\.0\.1:(\d+)/;
    let portFound = false;
    let stdoutBuf = '';

    const onData = (chunk: Buffer): void => {
      if (portFound) return;
      stdoutBuf += chunk.toString();
      const match = portRegex.exec(stdoutBuf);
      if (!match) return;
      portFound = true;
      const port = match[1];

      fetch(`http://127.0.0.1:${port}/config/providers`)
        .then((res) => res.json())
        .then((data: unknown) => {
          const raw = (data as { providers?: RawProvider[] }).providers;
          if (!Array.isArray(raw)) { finish(null); return; }
          const providers = normalizeProviders(raw);
          finish(providers);
        })
        .catch(() => {
          finish(null);
        });
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
