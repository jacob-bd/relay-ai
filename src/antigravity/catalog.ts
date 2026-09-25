import { MAX_MODEL_CATALOG } from '../constants.js';
import type { ResolvedFavorite } from '../favorites-resolver.js';
import type { AntigravityRoute, CatalogFixture, CatalogModelEntry } from './types.js';
import type { LocalProviderModel } from '../types.js';
import {
  getValidatedAgySwitchSlots,
  validateAgySlotRegistry,
  type AgySlotValidationResult,
} from './slot-registry.js';
import { getReasoningCapabilities, type ReasoningMetadata } from '../provider-factory.js';
import { EFFORT_RANK } from '../registry/models-dev.js';

/** Current Antigravity IDE flash-agent enum from fetchAvailableModels. */
export const RELAY_CASCADE_PLAN_MODEL = 'MODEL_PLACEHOLDER_M132';

/** Current Antigravity IDE default agent enum from fetchAvailableModels. */
export const RELAY_AGENT_PLACEHOLDER = 'MODEL_PLACEHOLDER_M20';

/** Current checkpointer model enum from captured modelExperiments. */
const RELAY_CASCADE_CHECKPOINT_MODEL = 'MODEL_PLACEHOLDER_M50';

/** Current 2.5 Flash intent-model enum from fetchAvailableModels. */
const RELAY_CASCADE_INTENT_MODEL = 'MODEL_GOOGLE_GEMINI_2_5_FLASH';

/** Fixture key for the hidden default agent anchor. */
export const RELAY_CASCADE_ANCHOR_ID = 'gemini-3.5-flash-low';

/** Fixture key for the hidden flash-agent anchor. */
export const RELAY_CASCADE_PLAN_ANCHOR_ID = 'gemini-3-flash-agent';
export const RELAY_CASCADE_FALLBACK_ID = 'gemini-2.5-flash-lite';
export const RELAY_CASCADE_INTENT_MODEL_ID = 'gemini-2.5-flash';

export interface RelayCatalogSlot {
  /** The model ID Antigravity sees and sends back to the gateway. */
  slotId: string;
  /** The Relay route that slot should execute against. */
  route: AntigravityRoute;
  /** Unused native model enum for a Relay-only entry past the native slots. */
  extraModelEnum?: string;
}

/**
 * Catalog keys Relay adds all start with this. Slot planning runs again on the
 * already-injected catalog (gateway routing, listModelConfigs), so it must ignore
 * Relay's own entries or the second pass would pick different IDs and enums.
 */
const RELAY_KEY_PREFIX = 'relay-';

function nativeEntries(catalog: CatalogFixture): Array<[string, CatalogModelEntry]> {
  return Object.entries(catalog.models).filter(([key]) => !key.startsWith(RELAY_KEY_PREFIX));
}

/** First unused MODEL_PLACEHOLDER_M<n> enums, well above the ones Google ships. */
function unusedModelEnums(catalog: CatalogFixture, count: number): string[] {
  const used = new Set(nativeEntries(catalog).map(([, entry]) => entry.model));
  const out: string[] = [];
  for (let n = 400; out.length < count && n < 650; n += 1) {
    const candidate = `MODEL_PLACEHOLDER_M${n}`;
    if (!used.has(candidate)) out.push(candidate);
  }
  return out;
}

/**
 * Picker ID for a Relay-only entry. The IDE hides entries whose ID contains
 * underscores (verified on Antigravity IDE 2.5.5), so catalog IDs are reduced to
 * lowercase letters, digits and hyphens.
 */
function overflowSlotId(catalogId: string, taken: Set<string>): string {
  const base = catalogId.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

export interface RelayCatalogSlotPlan {
  slots: RelayCatalogSlot[];
  switchableRoutes: AntigravityRoute[];
  skippedRoutes: AntigravityRoute[];
  validation: AgySlotValidationResult;
}

function withCascadeCheckpointer(
  entry: CatalogModelEntry,
  maxTokenLimit = 128000,
): CatalogModelEntry {
  const tokenThreshold = Math.min(50000, Math.floor(maxTokenLimit * 0.75));
  const existingModelExperiments = entry.modelExperiments as
    | { experiments?: Record<string, unknown>; [key: string]: unknown }
    | undefined;

  entry.modelExperiments = {
    ...existingModelExperiments,
    experiments: {
      ...(existingModelExperiments?.experiments ?? {}),
      CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
        stringValue: JSON.stringify({
          strategy: 'CHECKPOINT_STRATEGY_SAME_MODEL',
          max_token_limit: String(maxTokenLimit),
          token_threshold: String(tokenThreshold),
          max_overhead_ratio: '0.15',
          moving_window_size: '1',
          enabled: true,
          max_output_tokens: '16384',
          checkpoint_model: RELAY_CASCADE_CHECKPOINT_MODEL,
          use_last_planner_model: true,
          is_sync: true,
          max_user_requests: 10,
          include_last_user_message: true,
          include_conversation_log: false,
          include_running_task_snapshots: true,
          include_subagent_snapshots: true,
          include_artifact_snapshots: true,
          retry_config: {
            max_retries: 0,
            initial_sleep_duration_ms: 1000,
            exponential_multiplier: 2,
            include_error_feedback: false,
          },
        }),
      },
    },
  };
  return entry;
}

/**
 * agy refuses to construct an executor unless a model leaves this much room for input:
 * `context window - max output tokens >= ANTIGRAVITY_REQUIRED_INPUT_TOKENS`.
 */
export const ANTIGRAVITY_REQUIRED_INPUT_TOKENS = 128000;

/** Smallest output budget worth launching with; also sets the usable context floor. */
const ANTIGRAVITY_MIN_OUTPUT_TOKENS = 8192;

/** Context window a model needs before agy will start with it. */
export const ANTIGRAVITY_MIN_CONTEXT_WINDOW =
  ANTIGRAVITY_REQUIRED_INPUT_TOKENS + ANTIGRAVITY_MIN_OUTPUT_TOKENS;

function applyRouteContextBounds(
  entry: CatalogModelEntry,
  route: AntigravityRoute,
): CatalogModelEntry {
  const maxTokenLimit = route.contextWindow ?? 128000;
  // Reserve the input room agy demands and give what is left to output, so models between
  // the floor and ~193K launch instead of tripping agy's executor precondition.
  const maxOutputTokens = Math.min(
    entry.maxOutputTokens ?? 65536,
    Math.max(
      ANTIGRAVITY_MIN_OUTPUT_TOKENS,
      maxTokenLimit - ANTIGRAVITY_REQUIRED_INPUT_TOKENS,
    ),
  );
  const checkpointTokenLimit = Math.min(
    128000,
    Math.max(1, maxTokenLimit - maxOutputTokens),
  );

  entry.maxTokens = maxTokenLimit;
  entry.maxOutputTokens = maxOutputTokens;
  return withCascadeCheckpointer(entry, checkpointTokenLimit);
}

const RELAY_CASCADE_FALLBACK_ENTRY: CatalogModelEntry = withCascadeCheckpointer({
  displayName: 'Gemini 3.1 Flash Lite',
  model: 'MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE',
  apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
  modelProvider: 'MODEL_PROVIDER_GOOGLE',
  tokenizerType: 'LLAMA_WITH_SPECIAL',
  maxTokens: 1048576,
  maxOutputTokens: 65535,
  quotaInfo: { remainingFraction: 1 },
});

const RELAY_CASCADE_INTENT_MODEL_ENTRY: CatalogModelEntry = withCascadeCheckpointer({
  ...RELAY_CASCADE_FALLBACK_ENTRY,
  model: RELAY_CASCADE_INTENT_MODEL,
});

export function planRelayCatalogSlots(
  catalog: CatalogFixture,
  routes: AntigravityRoute[],
  templateKey: string,
): RelayCatalogSlotPlan {
  const validation = validateAgySlotRegistry(catalog);
  const switchSlots = getValidatedAgySwitchSlots(catalog);
  const templateSlot = switchSlots.find(slot => slot.slotId === templateKey);
  const orderedSlots = templateSlot
    ? [templateSlot, ...switchSlots.filter(slot => slot.slotId !== templateKey)]
    : switchSlots;

  if (routes.length > 0 && orderedSlots.length === 0) {
    throw new Error('No validated AGY switch slots are available for the selected launch route');
  }

  // Validated native slots first; every route past them becomes a Relay-only
  // entry with its own hyphen-only ID and an unused model enum.
  const nativeRoutes = routes.slice(0, orderedSlots.length);
  const overflowRoutes = routes.slice(orderedSlots.length);
  const slots: RelayCatalogSlot[] = nativeRoutes.map((route, index) => ({
    slotId: orderedSlots[index]!.slotId,
    route,
  }));
  const enums = unusedModelEnums(catalog, overflowRoutes.length);
  const taken = new Set(nativeEntries(catalog).map(([key]) => key));
  overflowRoutes.slice(0, enums.length).forEach((route, index) => {
    slots.push({ slotId: overflowSlotId(route.catalogId, taken), route, extraModelEnum: enums[index]! });
  });
  const switchableRoutes = slots.map(slot => slot.route);
  const skippedRoutes = overflowRoutes.slice(enums.length);

  return {
    slots,
    switchableRoutes,
    skippedRoutes,
    validation,
  };
}

export function resolveRelayCatalogSlots(
  catalog: CatalogFixture,
  routes: AntigravityRoute[],
  templateKey: string,
): RelayCatalogSlot[] {
  return planRelayCatalogSlots(catalog, routes, templateKey).slots;
}

/**
 * Build a relay catalog entry by cloning a real model template.
 */
export function buildRelayCatalogEntry(
  route: AntigravityRoute,
  template: CatalogModelEntry,
): CatalogModelEntry {
  const entry: CatalogModelEntry = structuredClone(template);

  entry.displayName = route.displayName;
  entry.model = template.model ?? RELAY_AGENT_PLACEHOLDER;
  entry.requestedModelId = route.catalogId;
  entry.modelVersion = route.catalogId;
  entry.modelVersionId = route.catalogId;
  entry.quotaInfo = { remainingFraction: 1, resetTime: '2026-06-23T02:00:57Z' };
  return applyRouteContextBounds(entry, route);
}

function buildRelayCatalogSlotEntry(
  route: AntigravityRoute,
  template: CatalogModelEntry,
): CatalogModelEntry {
  const entry: CatalogModelEntry = structuredClone(template);

  entry.displayName = route.displayName;
  entry.quotaInfo = { remainingFraction: 1, resetTime: '2026-06-23T02:00:57Z' };
  delete entry.requestedModelId;
  delete entry.modelVersion;
  delete entry.modelVersionId;
  delete entry.isInternal;
  return applyRouteContextBounds(entry, route);
}

/**
 * Inject Relay AI routes into a captured Cloud Code catalog fixture.
 */
export function injectRelayModels(
  fixture: CatalogFixture,
  routes: AntigravityRoute[],
  templateKey: string,
): CatalogFixture {
  const result: CatalogFixture = structuredClone(fixture);

  const template = fixture.models[templateKey];
  if (!template) {
    throw new Error(`Template model "${templateKey}" not found in catalog fixture`);
  }

  const seen = new Set<string>();
  for (const route of routes) {
    if (seen.has(route.catalogId)) {
      throw new Error(`Catalog ID collision: ${route.catalogId}`);
    }
    if (fixture.models[route.catalogId]) {
      throw new Error(`Catalog ID collision with native model: ${route.catalogId}`);
    }
    seen.add(route.catalogId);
  }

  if (routes.length > 0) {
    // Relay picker catalog + hidden cascade anchors. Visible picker entries use
    // native Antigravity IDs; the gateway maps those slots back to Relay routes.
    result.models[RELAY_CASCADE_ANCHOR_ID] ??= structuredClone(template);
    result.models[RELAY_CASCADE_FALLBACK_ID] ??= structuredClone(RELAY_CASCADE_FALLBACK_ENTRY);
    result.models[RELAY_CASCADE_INTENT_MODEL_ID] ??= structuredClone(RELAY_CASCADE_INTENT_MODEL_ENTRY);
    if (!result.models[RELAY_CASCADE_PLAN_ANCHOR_ID]) {
      const planAnchor = withCascadeCheckpointer(structuredClone(template));
      planAnchor.model = RELAY_CASCADE_PLAN_MODEL;
      result.models[RELAY_CASCADE_PLAN_ANCHOR_ID] = planAnchor;
    }

    const slotPlan = planRelayCatalogSlots(result, routes, templateKey);
    const slots = slotPlan.slots;
    for (const { slotId, route, extraModelEnum } of slots) {
      if (extraModelEnum) {
        const entry = buildRelayCatalogEntry(route, template);
        entry.model = extraModelEnum;
        result.models[slotId] = entry;
        continue;
      }
      const slotTemplate = result.models[slotId] ?? template;
      if (result.models[slotId]) {
        result.models[slotId] = buildRelayCatalogSlotEntry(route, slotTemplate);
      }
      result.models[route.catalogId] = buildRelayCatalogEntry(route, slotTemplate);
    }

    result.defaultAgentModelId = slots[0]?.slotId ?? RELAY_CASCADE_ANCHOR_ID;
    result.agentModelSorts = [
      {
        displayName: 'Recommended',
        groups: [{
          modelIds: slots.map(slot => slot.slotId),
        }],
      },
    ];
    for (const entry of Object.values(result.models)) {
      const mimeTypes = entry.supportedMimeTypes;
      if (!mimeTypes || typeof mimeTypes !== 'object' || Array.isArray(mimeTypes)) continue;
      entry.supportedMimeTypes = Object.fromEntries(
        Object.entries(mimeTypes).filter(([mime]) => !mime.toLowerCase().includes('audio/')),
      );
    }
    result.audioTranscriptionModelIds = [];
    return result;
  }

  if (!result.agentModelSorts?.[0]?.groups?.[0]) {
    result.agentModelSorts = [
      {
        displayName: 'Recommended',
        groups: [{ modelIds: [] }],
      },
    ];
  }

  return result;
}

/**
 * Build AntigravityRoute instances from resolved favorite models.
 *
 * Maps resolved model properties (`npm`, `upstreamModelId`, `apiKey`, `baseURL`)
 * to their opaque gateway route definitions, capping the total at `MAX_MODEL_CATALOG`.
 */
export function buildAntigravityRoutes(
  resolvedFavorites: ResolvedFavorite[],
  maxRoutes = MAX_MODEL_CATALOG,
): AntigravityRoute[] {
  const routes: AntigravityRoute[] = [];
  const seen = new Set<string>();

  for (const fav of resolvedFavorites) {
    if (routes.length >= maxRoutes) break;

    const favModel = fav.model;
    const modelId = favModel.id;
    const safeModelSlug = modelId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const catalogId = `relay-ai__${fav.providerId}__${safeModelSlug}`;

    if (seen.has(catalogId)) continue;
    seen.add(catalogId);

    // Extract Vercel AI SDK npm package and upstream parameters
    // Handle both LocalProviderModel and ServerModelInfo shapes
    const npm = (favModel as any).npm || '@ai-sdk/openai-compatible';
    const upstreamModelId = (favModel as any).upstreamModelId || modelId;
    const baseURL = (favModel as any).apiBaseUrl || (favModel as any).completionsUrl || undefined;
    const contextWindow = (favModel as any).contextWindow;
    const modelFormat = (favModel as any).modelFormat;

    routes.push({
      catalogId,
      providerId: fav.providerId,
      providerName: fav.providerName,
      modelId,
      upstreamModelId,
      displayName: `${favModel.name} (Relay)`,
      ...(modelFormat ? { modelFormat } : {}),
      npm,
      apiKey: fav.apiKey,
      ...(fav.authType ? { authType: fav.authType } : {}),
      ...(fav.oauthAccountId ? { oauthAccountId: fav.oauthAccountId } : {}),
      ...(fav.providerData ? { providerData: fav.providerData } : {}),
      ...(fav.headers ? { headers: fav.headers } : {}),
      ...(fav.refreshToken ? { refreshToken: fav.refreshToken } : {}),
      baseURL,
      contextWindow,
    });
    const route = routes.pop()!;
    routes.push(...effortVariants(route, favModel, routes.length === 0));
  }

  return applyUniqueAntigravityRouteLabels(routes.slice(0, maxRoutes));
}

/** Levels shown for a non-launch model: medium and the two above it, topped up from below. */
export function favoriteEffortLevels(levels: readonly string[], defaultLevel: string): string[] {
  let start = levels.indexOf('medium');
  if (start < 0) start = Math.max(0, levels.indexOf(defaultLevel));
  let from = start;
  let to = Math.min(levels.length, start + 3);
  while (to - from < 3 && from > 0) from -= 1;
  return levels.slice(from, to);
}

function effortLabel(level: string): string {
  return level === 'xhigh' ? 'XHigh' : level.charAt(0).toUpperCase() + level.slice(1);
}

/**
 * Antigravity has no effort control, so a model is listed once per effort level:
 * every level for the launch model, three for favorites. Models without
 * adjustable effort keep a single entry.
 */
function effortVariants(route: AntigravityRoute, model: unknown, isLaunchModel: boolean): AntigravityRoute[] {
  // Cloud Code routes are forwarded to Google as-is; Relay's effort options never apply.
  if (route.modelFormat === 'cloud-code') return [route];
  const m = model as Partial<Pick<LocalProviderModel,
    'supportedParameters' | 'reasoning' | 'interleavedReasoningField' | 'reasoningEffortLevels' | 'reasoningEffortConflict'>>;
  const metadata: ReasoningMetadata = {
    providerId: route.providerId,
    upstreamModelId: route.upstreamModelId,
    ...(route.baseURL ? { apiBaseUrl: route.baseURL } : {}),
    ...(m.supportedParameters ? { supportedParameters: m.supportedParameters } : {}),
    ...(m.reasoning !== undefined ? { reasoning: m.reasoning } : {}),
    ...(m.interleavedReasoningField ? { interleavedReasoningField: m.interleavedReasoningField } : {}),
    ...(m.reasoningEffortLevels ? { reasoningEffortLevels: m.reasoningEffortLevels } : {}),
    ...(m.reasoningEffortConflict ? { reasoningEffortConflict: true } : {}),
  };
  const caps = getReasoningCapabilities(route.npm, route.upstreamModelId, metadata);
  if (caps.mode !== 'controllable' || caps.levels.length < 2) return [route];
  const rank = (level: string) => {
    const index = EFFORT_RANK.indexOf(level);
    return index < 0 ? EFFORT_RANK.length : index;
  };
  const ordered = [...caps.levels].sort((a, b) => rank(a) - rank(b));
  const levels = isLaunchModel ? ordered : favoriteEffortLevels(ordered, caps.defaultLevel);
  const baseName = routeBaseModelName(route);
  return levels.map(level => ({
    ...route,
    catalogId: `${route.catalogId}__effort_${level}`,
    displayName: `${baseName} ${effortLabel(level)} (Relay)`,
    reasoningEffort: level,
    reasoningMetadata: metadata,
  }));
}

function routeBaseModelName(route: AntigravityRoute): string {
  const relayMatch = route.displayName.match(/^(.*) \(Relay(?: - .*)?\)$/);
  return relayMatch?.[1] ?? route.displayName;
}

function authKindLabel(route: AntigravityRoute): string {
  if (route.authType === 'oauth') return 'OAuth';
  if (route.authType === 'api') return 'API key';
  if (route.authType === 'none') return 'local';
  return 'provider';
}

function duplicateCounts(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function assertUniqueRouteDisplayNames(routes: AntigravityRoute[]): void {
  const counts = duplicateCounts(routes.map(route => route.displayName));
  const duplicate = [...counts.entries()].find(([, count]) => count > 1);
  if (duplicate) {
    throw new Error(`Duplicate AGY model label after disambiguation: ${duplicate[0]}`);
  }
}

export function applyUniqueAntigravityRouteLabels(routes: AntigravityRoute[]): AntigravityRoute[] {
  const baseNames = routes.map(routeBaseModelName);
  const baseNameCounts = duplicateCounts(baseNames);
  const upstreamKey = (route: AntigravityRoute) => `${route.upstreamModelId}|${route.reasoningEffort ?? ''}`;
  const upstreamCounts = duplicateCounts(routes.map(upstreamKey));
  // One count per distinct provider: effort variants of one provider must not look like two.
  const providerNameCounts = duplicateCounts(
    [...new Set(routes.map(route => `${route.providerId}\u0000${route.providerName}`))]
      .map(key => key.split('\u0000')[1]!),
  );

  const labeled = routes.map((route, index) => {
    const baseName = baseNames[index]!;
    const needsSuffix =
      (baseNameCounts.get(baseName) ?? 0) > 1
      || (upstreamCounts.get(upstreamKey(route)) ?? 0) > 1;

    if (!needsSuffix) {
      return { ...route, displayName: `${baseName} (Relay)` };
    }

    const providerName = route.providerName || route.providerId;
    const providerSuffix = (providerNameCounts.get(providerName) ?? 0) > 1
      ? `${providerName} ${authKindLabel(route)}`
      : providerName;
    return {
      ...route,
      displayName: `${baseName} (Relay - ${providerSuffix})`,
    };
  });

  const firstPassCounts = duplicateCounts(labeled.map(route => route.displayName));
  const withProviderIds = labeled.map(route => {
    if ((firstPassCounts.get(route.displayName) ?? 0) <= 1) return route;
    return {
      ...route,
      displayName: route.displayName.replace(/\)$/, ` - ${route.providerId})`),
    };
  });

  assertUniqueRouteDisplayNames(withProviderIds);
  return withProviderIds;
}

function routeLabels(routes: AntigravityRoute[]): Map<string, string> {
  assertUniqueRouteDisplayNames(routes);

  const labels = new Map<string, string>();
  for (const route of routes) {
    labels.set(route.catalogId, route.displayName);
  }
  return labels;
}

function buildClientModelConfigData(
  routes: AntigravityRoute[],
  catalog?: CatalogFixture,
  templateKey = RELAY_CASCADE_ANCHOR_ID,
  precomputedSlots?: { slotId: string; route: AntigravityRoute }[],
): Record<string, unknown> {
  const catalogRoutes = routes.slice(0, MAX_MODEL_CATALOG);
  const slots = precomputedSlots ?? (catalog
    ? resolveRelayCatalogSlots(catalog, catalogRoutes, templateKey)
    : catalogRoutes.map(route => ({ slotId: route.catalogId, route })));
  const labels = routeLabels(catalogRoutes);
  const clientModelConfigs = slots.map(({ slotId, route }) => {
    const entry = catalog?.models[slotId] ?? catalog?.models[route.catalogId] ?? catalog?.models[RELAY_CASCADE_ANCHOR_ID];
    const label = labels.get(route.catalogId) ?? route.displayName;
    return {
      label,
      modelOrAlias: {
        alias: slotId,
        choice: { case: 'alias', value: slotId },
      },
      disabled: false,
      supportedMimeTypes: entry?.supportedMimeTypes ?? {},
      quotaInfo: entry?.quotaInfo ?? { remainingFraction: 1 },
      tagTitle: entry?.tagTitle,
      tagDescription: entry?.tagDescription,
      supportsThoughtCirculation: entry?.supportsThoughtCirculation ?? false,
    };
  });

  return {
    clientModelConfigs,
    clientModelSorts: [
      {
        name: 'Recommended',
        groups: [
          {
            groupName: '',
            modelLabels: clientModelConfigs.map(config => config.label),
          },
        ],
      },
    ],
    defaultOverrideModelConfig: clientModelConfigs[0] ?? {},
  };
}

/**
 * Build a minimal listModelConfigs response for agy's cascade executor.
 * agy requires PlanModel or RequestedModel — this supplies requestedModelId per route.
 */
export function buildListModelConfigsResponse(
  routes: AntigravityRoute[],
  catalog?: CatalogFixture,
  templateKey = RELAY_CASCADE_ANCHOR_ID,
): Record<string, unknown> {
  const catalogRoutes = routes.slice(0, MAX_MODEL_CATALOG);
  const slots = catalog
    ? resolveRelayCatalogSlots(catalog, catalogRoutes, templateKey)
    : catalogRoutes.map(route => ({ slotId: route.catalogId, route }));
  const config = slots.map(({ slotId }) => ({
    requestedModelId: slotId,
    planModel: RELAY_CASCADE_PLAN_MODEL,
    requestedModel: catalog?.models[slotId]?.model ?? RELAY_AGENT_PLACEHOLDER,
  }));

  return {
    ...buildClientModelConfigData(routes, catalog, templateKey, slots),
    allowedModelConfigs: config,
    defaultAgentModelConfig: config[0] ?? {},
  };
}

const CURRENT_EXPERIMENT_IDS = [
  105979552, 105979574, 106015351, 105979579, 105867471, 105979530, 105995634,
  106121401, 106100625, 104638466, 101868197, 104817729, 105695344, 106064591,
  104913215, 106324349, 106309078, 105821930, 104922093, 103012598, 106143956,
  105856899, 106312323, 106064030, 105746183, 105757908, 104892493, 105822886,
  105785683, 105721273, 105897325, 105658071, 106240758, 105943702, 106106760,
  106283618, 105620019, 106038160, 106309520, 106281951, 106264532, 106222835,
  106094629, 105887313, 105849474, 106032303, 106228452, 106113900, 106121607,
  105979531, 105979553, 106015328, 105867469, 105979517, 106121399, 106100654,
  104638459, 101551624, 104673683, 105695346, 106064590, 104913210, 105821928,
  104922082, 103012592, 106064028, 105746181, 104892490, 105822881, 105721268,
  105895316, 105658068, 106240748, 105943694, 106283614, 105620012, 106038153,
  105887311, 106032301, 106113877, 106121604,
] as const;

/** Current Antigravity IDE listExperiments response shape. */
export function buildListExperimentsResponse(): Record<string, unknown> {
  return {
    experimentIds: [...CURRENT_EXPERIMENT_IDS],
  };
}
