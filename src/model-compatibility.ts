// src/model-compatibility.ts — curated blacklist + models.dev capability filtering

import { isProviderKind, providerKind } from './registry/provider-kind.js';
import blacklistData from './data/model-incompatible.json';
import {
  findModelsDevModel,
  loadModelsDevCache,
  shouldHideByModelsDevCapabilities,
} from './registry/models-dev.js';

export type CompatibilityAgent = 'claude' | 'codex' | 'codex-app' | 'server' | 'gemini' | 'antigravity';

export interface CompatibilityContext {
  providerId: string;
  modelId: string;
  agent: CompatibilityAgent;
}

export interface IncompatibleModelEntry {
  provider: string;
  modelId: string;
  category: string;
  reason: string;
  agents?: CompatibilityAgent[];
  sources?: string[];
  verifiedAt?: string;
}

interface IncompatibleModelFile {
  schema_version?: string;
  entries?: IncompatibleModelEntry[];
}

const BLACKLIST_ENTRIES = (blacklistData as IncompatibleModelFile).entries ?? [];

// Cloud Code's fetchAvailableModels blob also contains tab-complete, chat, and
// image-generation slots. Those are not agent models — drop them. Everything
// else from the live catalog is shown; there is no Relay allowlist.
const ANTIGRAVITY_HELPER_SLOT = /^(tab_|chat_|models\/)|image/i;

export function isAntigravityCloudCodeHelperSlot(modelId: string): boolean {
  return ANTIGRAVITY_HELPER_SLOT.test(modelId);
}

/**
 * OpenCode restricts its zero-cost Zen free-tier models (`*-free`,
 * `big-pickle`) to the official OpenCode client — any third-party call gets
 * `403 FreeTierError: "OpenCode's free tier can only be used from within
 * OpenCode"` (maintainer statement, 2026-09-18:
 * https://github.com/anomalyco/opencode/issues/49621#issuecomment-5723383322).
 * Hidden rather than blacklisted per id because the free lineup rotates.
 *
 * Zen only. OpenCode Go serves the same `*-free` ids to third-party clients
 * (verified live 2026-10-19: Go free models return 200 with an
 * `x-opencode-session` header, which Relay sends; the same ids on Zen return
 * the 403). Hiding them on Go removed working free models from every picker.
 */
const ZEN_FREE_TIER_PROVIDERS = new Set(['zen']);

export function isZenFreeTierModel(providerId: string, modelId: string): boolean {
  if (!ZEN_FREE_TIER_PROVIDERS.has(providerKind(providerId))) return false;
  const id = modelId.trim().toLowerCase();
  return id === 'big-pickle' || id.endsWith('-free');
}

function matchesAgent(entryAgents: CompatibilityAgent[] | undefined, agent: CompatibilityAgent): boolean {
  if (!entryAgents || entryAgents.length === 0) return true;
  return entryAgents.includes(agent);
}

function matchesProvider(entryProvider: string, providerId: string): boolean {
  return entryProvider === providerId || entryProvider === '*';
}

export function findBlacklistEntry(ctx: CompatibilityContext): IncompatibleModelEntry | null {
  for (const entry of BLACKLIST_ENTRIES) {
    if (entry.modelId !== ctx.modelId) continue;
    if (!matchesProvider(entry.provider, ctx.providerId)) continue;
    if (!matchesAgent(entry.agents, ctx.agent)) continue;
    return entry;
  }
  return null;
}

export function hideReason(ctx: CompatibilityContext): string | null {
  if (isProviderKind(ctx.providerId, 'antigravity') && isAntigravityCloudCodeHelperSlot(ctx.modelId)) {
    return '[antigravity-oauth] Cloud Code helper/internal slot';
  }

  if (isZenFreeTierModel(ctx.providerId, ctx.modelId)) {
    return '[zen-free-tier] restricted to the OpenCode client (403 outside)';
  }

  const blacklist = findBlacklistEntry(ctx);
  if (blacklist) return `[blacklist:${blacklist.category}] ${blacklist.reason}`;

  const modelsDev = findModelsDevModel(ctx.providerId, ctx.modelId, loadModelsDevCache());
  if (modelsDev && shouldHideByModelsDevCapabilities(modelsDev)) {
    return '[models.dev] incompatible capabilities for coding agents';
  }

  return null;
}

export function shouldHideModel(ctx: CompatibilityContext): boolean {
  return hideReason(ctx) !== null;
}
