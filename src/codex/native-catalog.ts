import type { CodexCatalogFile, CodexCatalogModel } from './catalog.js';
import { runCodexCommand } from './process.js';
import { localIsoTimestamp } from '../trace-log.js';

export interface NativeCodexCatalogSnapshot {
  schemaVersion: 1;
  target: 'cli' | 'app';
  binaryPath: string;
  codexVersion: string;
  capturedAt: string;
  source: 'refreshed' | 'bundled';
  models: CodexCatalogModel[];
}

export interface CaptureNativeCodexCatalogOptions {
  target: 'cli' | 'app';
  binaryPath: string;
  codexVersion: string;
  bundled?: boolean;
  run?: (args: string[]) => Promise<string>;
}

function isCatalogModel(value: unknown): value is CodexCatalogModel {
  if (!value || typeof value !== 'object') return false;
  const model = value as Record<string, unknown>;
  return typeof model.slug === 'string'
    && model.slug.length > 0
    && typeof model.visibility === 'string'
    && typeof model.display_name === 'string';
}

export function validateNativeCodexCatalog(value: unknown): CodexCatalogFile {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { models?: unknown }).models)) {
    throw new Error('Invalid native Codex catalog: expected a models array');
  }
  const rawModels = (value as { models: unknown[] }).models;
  if (rawModels.length === 0) throw new Error('Invalid native Codex catalog: no models');
  if (!rawModels.every(isCatalogModel)) throw new Error('Invalid native Codex catalog: invalid model entry');
  // Strip any models injected from a previous Relay session overlay (slugs containing '__').
  // Native OpenAI models never contain double underscores.
  const models = (rawModels as CodexCatalogModel[]).filter(m => !m.slug.includes('__'));
  if (models.length === 0) throw new Error('Invalid native Codex catalog: no native models');
  return { models };
}

export async function captureNativeCodexCatalog(
  options: CaptureNativeCodexCatalogOptions,
): Promise<NativeCodexCatalogSnapshot> {
  const run = options.run ?? (async (args: string[]) => {
    const result = await runCodexCommand(options.binaryPath, args, { maxBuffer: 16 * 1024 * 1024 });
    return result.stdout;
  });
  const stdout = await run(options.bundled ? ['debug', 'models', '--bundled'] : ['debug', 'models']);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error('Native Codex catalog was not valid JSON');
  }
  const catalog = validateNativeCodexCatalog(parsed);
  return {
    schemaVersion: 1,
    target: options.target,
    binaryPath: options.binaryPath,
    codexVersion: options.codexVersion,
    capturedAt: localIsoTimestamp(),
    source: options.bundled ? 'bundled' : 'refreshed',
    models: catalog.models,
  };
}
