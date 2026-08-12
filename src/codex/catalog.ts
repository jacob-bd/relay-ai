// model_catalog_json for Codex — schema from codex-rs ModelInfo.
import type { LocalProviderModel } from '../types.js';
import { stripGoogleModelPrefix } from '../registry/google-model-id.js';
import {
  buildCodexReasoningLevels,
  getReasoningCapabilities,
  type ReasoningMetadata,
} from '../provider-factory.js';
import { codexAppModelSlug } from './app-profile.js';

export interface CodexCatalogModel {
  slug: string;
  display_name: string;
  supported_reasoning_levels: unknown[];
  default_reasoning_level: string;
  default_reasoning_summary: string;
  shell_type: string;
  visibility: string;
  supported_in_api: boolean;
  priority: number;
  availability_nux: null;
  upgrade: null;
  base_instructions: string;
  supports_reasoning_summaries: boolean;
  support_verbosity: boolean;
  default_verbosity: null;
  apply_patch_tool_type: null;
  truncation_policy: { mode: string; limit: number };
  supports_parallel_tool_calls: boolean;
  experimental_supported_tools: unknown[];
  context_window?: number;
  max_context_window?: number;
  input_modalities?: string[];
  description?: string;
  /** Collaboration capability advertised by the target Codex runtime. */
  multi_agent_version?: string;
  /** Preserve native catalog fields Relay does not know about. */
  [key: string]: unknown;
}

export interface CodexCatalogFile {
  models: CodexCatalogModel[];
}

const DEFAULT_CONTEXT = 128_000;
/** Codex picker requires at least one effort level to close after model selection. */
const CODEX_NO_REASONING_EFFORT = 'none';

export function codexCatalogReasoningFields(
  npm: string,
  wireId: string,
  metadata?: ReasoningMetadata,
): Pick<CodexCatalogModel, 'supported_reasoning_levels' | 'default_reasoning_level' | 'supports_reasoning_summaries' | 'default_reasoning_summary'> {
  const reasoning = getReasoningCapabilities(npm, wireId, metadata);
  if (reasoning.levels.length > 0) {
    return {
      supported_reasoning_levels: buildCodexReasoningLevels(reasoning),
      default_reasoning_level: reasoning.defaultLevel,
      supports_reasoning_summaries: reasoning.supportsSummaries,
      default_reasoning_summary: reasoning.supportsSummaries ? 'auto' : 'none',
    };
  }
  return {
    supported_reasoning_levels: buildCodexReasoningLevels({
      levels: [CODEX_NO_REASONING_EFFORT],
    }),
    default_reasoning_level: CODEX_NO_REASONING_EFFORT,
    supports_reasoning_summaries: false,
    default_reasoning_summary: 'none',
  };
}

/** Human-readable label for Codex catalog / provider name (registry names are often raw ids). */
export function formatCodexModelLabel(model: LocalProviderModel): string {
  const trimmed = model.name.trim();
  if (trimmed && trimmed !== model.id) return trimmed;

  const id = stripGoogleModelPrefix(model.id);
  const claude = id.match(/^claude-([\w-]+?)-(\d+)-(\d+)(?:-\d{8})?$/);
  if (claude) {
    const tier = claude[1]!.split('-').map(part =>
      part.charAt(0).toUpperCase() + part.slice(1),
    ).join(' ');
    return `Claude ${tier} ${claude[2]}.${claude[3]}`;
  }

  const gpt = id.match(/^gpt-(\d+(?:\.\d+)?)(?:-([\w-]+))?$/i);
  if (gpt) {
    const suffix = gpt[2] ? ` ${gpt[2].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}` : '';
    return `GPT-${gpt[1]}${suffix}`;
  }

  return id;
}

export function catalogEntryFromModel(
  model: LocalProviderModel,
  providerName: string,
  priority: number,
  appCatalog = false,
  slugOverride?: string,
): CodexCatalogModel {
  const slug = slugOverride ?? (
    appCatalog
      ? codexAppModelSlug(model.id)
      : stripGoogleModelPrefix(model.id)
  );
  const context = model.contextWindow ?? DEFAULT_CONTEXT;
  const label = formatCodexModelLabel(model);
  const wireId = model.upstreamModelId ?? model.id;
  const reasoningFields = codexCatalogReasoningFields(model.npm ?? '', wireId, {
    apiBaseUrl: model.apiBaseUrl,
    supportedParameters: model.supportedParameters,
    reasoning: model.reasoning,
    interleavedReasoningField: model.interleavedReasoningField,
  });
  return {
    slug,
    display_name: label,
    ...reasoningFields,
    shell_type: appCatalog ? 'default' : 'shell_command',
    visibility: 'list',
    supported_in_api: true,
    priority,
    availability_nux: null,
    upgrade: null,
    base_instructions: '',
    support_verbosity: false,
    default_verbosity: null,
    apply_patch_tool_type: null,
    truncation_policy: appCatalog
      ? { mode: 'bytes', limit: 10_000 }
      : { mode: 'tokens', limit: context },
    supports_parallel_tool_calls: !appCatalog,
    experimental_supported_tools: [],
    context_window: context,
    max_context_window: context,
    input_modalities: model.modalities ?? ['text', 'image'],
    description: `${label} · ${providerName}`,
  };
}

export function modelToCatalogEntry(model: LocalProviderModel, providerName: string): CodexCatalogModel {
  return catalogEntryFromModel(model, providerName, 0);
}

export function buildCatalogFile(
  models: LocalProviderModel[],
  providerName: string,
): CodexCatalogFile {
  return {
    models: models.map((m, i) => catalogEntryFromModel(m, providerName, i)),
  };
}

/** App catalog: selected model first (priority 0) for Codex picker when upstream supports it. */
export function buildAppCatalogFile(
  models: LocalProviderModel[],
  providerName: string,
  selectedModelId: string,
): CodexCatalogFile {
  const selected = models.find(m => m.id === selectedModelId);
  const rest = models.filter(m => m.id !== selectedModelId);
  const ordered = selected ? [selected, ...rest] : models;
  return {
    models: ordered.map((m, i) => catalogEntryFromModel(m, providerName, i, true)),
  };
}

export function serializeCatalog(catalog: CodexCatalogFile): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}
