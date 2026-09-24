#!/usr/bin/env node
// Regenerate src/data/models-dev-cache.json from models.dev (maintainer script).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_URL = 'https://models.dev/api.json';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'models-dev-cache.json');

/**
 * Hand-mirror of isUsableModelsDevPayload (src/registry/models-dev.ts): this
 * maintainer script runs against raw source, not the compiled bundle. A degraded
 * fetch (empty/error/no real rows) must never overwrite the committed snapshot.
 */
function isUsablePayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  let usable = 0;
  for (const [key, provider] of Object.entries(data)) {
    if (key.startsWith('_')) continue;
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) continue;
    const models = provider.models;
    if (!models || typeof models !== 'object' || Array.isArray(models)) continue;
    const hasRealRow = Object.values(models).some(
      row => row !== null && typeof row === 'object' && !Array.isArray(row),
    );
    if (hasRealRow && ++usable >= 2) return true;
  }
  return false;
}

const response = await fetch(API_URL, { headers: { Accept: 'application/json' } });
if (!response.ok) {
  console.error(`fetch failed: HTTP ${response.status}`);
  process.exit(1);
}

const data = await response.json();
if (!isUsablePayload(data)) {
  console.error('refusing to write: models.dev payload is empty or malformed (committed snapshot left intact)');
  process.exit(1);
}

const providerCount = Object.keys(data).filter(k => !k.startsWith('_')).length;
const out = {
  _relay_meta: {
    schema_version: '1',
    fetched_at: new Date().toISOString(),
    source: API_URL,
    provider_count: providerCount,
  },
  ...data,
};

writeFileSync(OUT, `${JSON.stringify(out)}\n`);
console.log(`Wrote ${OUT} (${providerCount} providers)`);
