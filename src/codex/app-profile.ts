// Codex App config.toml content — keep the built-in OpenAI provider so existing threads remain visible.
import type { CodexRoute } from './routing.js';

/** Legacy provider id used by relay-ai <= 0.2.6. Retained for cleanup and recovery. */
export const CODEX_APP_PROVIDER_ID = 'relay-ai-launch-codex-app';

/**
 * @deprecated No longer written to config.toml. The actual model slug from the
 * selected route is written instead so the Codex App's catalog picker can
 * match it. Kept for backward compatibility with existing test references.
 */
export const CODEX_APP_DISPLAY_MODEL = 'gpt-5.5';
export const PREVIEW_PROXY_PORT = 54321;
/**
 * Fraction of the context window at which Codex is told to auto-compact
 * (`model_auto_compact_token_limit`). Kept high on purpose: a single large tool
 * result (e.g. a chrome-devtools browser snapshot can be ~1 MB / ~300K tokens)
 * must not trip auto-compaction after only a couple of turns. The reference
 * codex-ollama-proxy uses a flat 900K on a 1M window (~0.9) for the same reason;
 * we keep it a ratio so it scales to each model's real window. An earlier 0.55
 * fired compaction almost immediately once MCP tool defs + a browser snapshot
 * were in context (relay-ai/relay-ai#21 follow-up).
 */
export const CODEX_APP_AUTO_COMPACT_RATIO = 0.9;

export function codexAppModelSlug(rawModelId: string): string {
  return rawModelId.startsWith('models/') ? rawModelId.slice('models/'.length) : rawModelId;
}

export function parseCodexAppModelSlug(modelKey: string): string {
  // Backward compatibility for catalogs written by relay-ai <= 0.2.6.
  const prefix = `${CODEX_APP_PROVIDER_ID}/`;
  return modelKey.startsWith(prefix) ? modelKey.slice(prefix.length) : modelKey;
}

export interface CodexAppConfigSpec {
  route: CodexRoute;
  proxyPort: number;
  catalogPath: string;
}

export function buildCodexAppRootConfig(spec: CodexAppConfigSpec): {
  model: string;
  model_provider: string;
  openai_base_url: string;
  model_catalog_json: string;
  model_context_window?: number;
  model_auto_compact_token_limit?: number;
} {
  const ctxWindow = spec.route.contextWindow;
  return {
    model: codexAppModelSlug(spec.route.modelId),
    model_provider: 'openai',
    openai_base_url: `http://127.0.0.1:${spec.proxyPort}/v1`,
    model_catalog_json: spec.catalogPath,
    ...(ctxWindow && ctxWindow > 0 ? {
      model_context_window: ctxWindow,
      model_auto_compact_token_limit: Math.floor(ctxWindow * CODEX_APP_AUTO_COMPACT_RATIO),
    } : {}),
  };
}
