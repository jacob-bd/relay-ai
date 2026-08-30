import { readFileSync } from 'node:fs';
import type { CodexCatalogFile } from './catalog.js';
import { readCodexConfigText, validateAppConfigText } from './app-config.js';
import type { CodexAppConfigSpec } from './app-profile.js';

type FetchLike = typeof fetch;

function proxyRoot(spec: CodexAppConfigSpec): string {
  const base = spec.proxyBaseUrl ?? `http://127.0.0.1:${spec.proxyPort}/v1`;
  if (!base.endsWith('/v1')) throw new Error('Codex App proxy base URL must end in /v1');
  return base.slice(0, -3);
}

async function checkedJson(url: string, fetchImpl: FetchLike): Promise<unknown> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Relay readiness check failed: GET ${url} returned HTTP ${response.status}`);
  return response.json();
}

/** Verify every dependency Codex Desktop will read before the app is launched. */
export async function verifyCodexAppReadiness(
  spec: CodexAppConfigSpec,
  options: { configPath?: string; fetchImpl?: FetchLike } = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const root = proxyRoot(spec);

  const health = await checkedJson(`${root}/health`, fetchImpl) as { ok?: unknown };
  if (health.ok !== true) throw new Error('Relay proxy health check did not report ready');

  const catalog = JSON.parse(readFileSync(spec.catalogPath, 'utf8')) as Partial<CodexCatalogFile>;
  if (!Array.isArray(catalog.models) || catalog.models.length === 0) {
    throw new Error('Relay Codex model catalog is empty or invalid');
  }
  const catalogIds = catalog.models.map(model => model?.slug).filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (catalogIds.length !== catalog.models.length) throw new Error('Relay Codex model catalog contains an invalid model slug');
  if (!catalogIds.includes(spec.route.modelId)) {
    throw new Error(`Relay Codex model catalog is missing selected model ${spec.route.modelId}`);
  }

  const advertised = await checkedJson(`${root}/v1/models`, fetchImpl) as { data?: Array<{ id?: unknown }> };
  const advertisedIds = new Set((advertised.data ?? []).map(model => model.id).filter((id): id is string => typeof id === 'string'));
  for (const id of catalogIds) {
    if (!advertisedIds.has(id)) throw new Error(`Relay proxy does not advertise catalog model ${id}`);
  }

  validateAppConfigText(readCodexConfigText(options.configPath), spec);
}
