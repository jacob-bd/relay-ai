// src/core/pool-model.ts — the Relay Free Pool as one Core model.
//
// `listRelayModels()` lists "Relay Free Pool" and `createRelayModel('relay-free-pool::relay-free-pool')` returns a
// LanguageModel that tries the pool's members in the user's priority order, with the same eligibility, cooldown,
// disabled-member and failover rules the CLI launchers use (src/pool). Everything is read per call, never cached,
// so a pool edit in `relay-ai ui` takes effect without restarting the host.

import { randomUUID } from 'node:crypto';
import type {
  LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4GenerateResult, LanguageModelV4StreamPart,
} from '@ai-sdk/provider';
import type { LanguageModel } from 'ai';
import { loadPreferences } from '../config.js';
import { resolveProviderOAuthProviderData } from '../env.js';
import { isProviderKind } from '../registry/provider-kind.js';
import { copilotPlanTier, filterCachedCopilotModels } from '../registry/copilot-models.js';
import { poolFreeStatus } from '../free-models.js';
import { materializeRegistry } from '../registry/materialize.js';
import { PoolAttemptError, type PoolEvent, MAX_POOL_ATTEMPTS } from '../pool/attempt.js';
import { currentPoolReceipt, poolEndpointRevision } from '../pool/capabilities.js';
import { poolCatalogEntry } from '../pool/catalog.js';
import { poolRequestFitsWindow } from '../pool/context.js';
import { poolRouteKey } from '../pool/continuation.js';
import { DEFAULT_POOL_LIMITS } from '../pool/codex-runtime.js';
import { dispatchFreePool, type DispatchRoute } from '../pool/dispatch.js';
import { describePoolFailure, poolRouteMember, recordPoolActivity } from '../pool/activity.js';
import { poolErrorDetail } from '../pool/diagnostic.js';
import { retryPoolFailure } from '../pool/errors.js';
import { lazyPoolRoute } from '../pool/lazy-route.js';
import { parseFreePool } from '../pool/membership.js';
import { poolOutputCap } from '../pool/output-limit.js';
import { PoolHealthStore, poolAccountScope, poolEndpointScope } from '../pool/health.js';
import { poolRouteFromStream } from '../pool/sdk-route.js';
import { PoolSessionRoutes } from '../pool/session.js';
import { POOL_MAX_TOOLS } from '../pool/codex-prepare.js';
import { poolRoutingProblem } from '../pool/verify.js';
import type { FreePoolPreferences, LocalProvider, PoolCapabilityReceipt } from '../types.js';
import { loadCoreRegistry } from './catalog.js';
import { RelayCoreError, isRelayCoreError } from './errors.js';
import { isRelayReasoningLevel } from './reasoning.js';
import type { CreateRelayModelOptions, RelayModelDescriptor, RelayReasoningLevel, RelayRouteId } from './types.js';

export const RELAY_POOL_PROVIDER_ID = 'relay-free-pool';
export const RELAY_POOL_MODEL_ID = 'relay-free-pool';
export const RELAY_POOL_ROUTE_ID = `${RELAY_POOL_PROVIDER_ID}::${RELAY_POOL_MODEL_ID}` as RelayRouteId;

/** Provider-metadata namespace that records which member produced a part, so its signatures never reach another. */
const ORIGIN_NAMESPACE = 'relay-pool';
/** Carries the untouched spec stream part through the coordinator (a symbol, so it is not counted or serialized). */
const RAW = Symbol('relay-pool-raw-part');

/** Placeholder only: catalog and eligibility never need the real credential, which the member model resolves itself. */
const NO_CREDENTIAL_NEEDED = () => 'relay-core-pool';

interface PoolState {
  pool: FreePoolPreferences;
  providers: LocalProvider[];
}

/** Pool settings plus the pool members' providers, read fresh and without touching any credential. */
export function loadPoolState(registryPath?: string, copilotData?: ReadonlyMap<string, Record<string, unknown> | undefined>): PoolState | undefined {
  let pool: FreePoolPreferences;
  try {
    pool = parseFreePool(loadPreferences().freePool);
  } catch {
    return undefined;
  }
  if (pool.enabled !== true || pool.members.length === 0) return undefined;
  const ids = new Set(pool.members.map(member => member.providerId));
  const registry = loadCoreRegistry(registryPath);
  const trimmed = {
    ...registry,
    providers: registry.providers.filter(provider => ids.has(provider.id)).map(provider => {
      // Copilot's free models depend on the account's plan, which is stored with its credentials: it is applied
      // only when the caller (a real request) has read it, exactly as the CLI loader does.
      if (!copilotData?.has(provider.id) || !provider.modelsCache) return provider;
      return { ...provider, modelsCache: { ...provider.modelsCache,
        models: filterCachedCopilotModels(provider.modelsCache.models, copilotPlanTier(copilotData.get(provider.id))) } };
    }),
  };
  // Same agent the other SDK-driven surfaces use, so a member's endpoint revision matches its saved Test.
  return { pool, providers: materializeRegistry(trimmed, NO_CREDENTIAL_NEEDED, { agent: 'codex' }) };
}

/** The state a real request judges members by: Copilot's plan is read (only for Copilot members), nothing else. */
export async function loadPoolStateForCall(): Promise<PoolState | undefined> {
  const first = loadPoolState();
  if (!first) return undefined;
  const copilot = first.pool.members.filter(member => isProviderKind(member.providerId, 'github-copilot'));
  if (copilot.length === 0) return first;
  const registry = loadCoreRegistry();
  const data = new Map<string, Record<string, unknown> | undefined>();
  for (const member of copilot) {
    const provider = registry.providers.find(item => item.id === member.providerId);
    if (!provider || data.has(provider.id)) continue;
    try { data.set(provider.id, await resolveProviderOAuthProviderData(provider.authRef)); } catch { data.set(provider.id, undefined); }
  }
  return loadPoolState(undefined, data);
}

interface ServableMember {
  member: { providerId: string; modelId: string };
  provider: LocalProvider;
  model: LocalProvider['models'][number];
  revision: string;
  receipt: PoolCapabilityReceipt;
  /** `provider::model` route id Core builds the member's own model from. */
  routeId: RelayRouteId;
}

export function servableMembers(state: PoolState, now: number, planKnown = true): ServableMember[] {
  const found: ServableMember[] = [];
  for (const member of state.pool.members) {
    const provider = state.providers.find(item => item.id === member.providerId);
    const model = provider?.models.find(item => item.id === member.modelId);
    if (!provider || !model || !model.npm || model.modelFormat === 'cloud-code') continue;
    // Without the plan (a credential-free listing) a Copilot member rests on its saved Test result, which
    // was only possible while the model was verified free; a real request re-checks it with the plan.
    const planPending = !planKnown && isProviderKind(provider.id, 'github-copilot');
    if (!planPending && poolFreeStatus({ model, providerId: provider.id }) !== 'verified_free') continue;
    if (!planPending && poolRoutingProblem(provider, model)) continue;
    const revision = poolEndpointRevision({
      providerId: provider.id, authRef: provider.authRef, npm: model.npm,
      baseURL: model.apiBaseUrl, upstreamModelId: model.upstreamModelId, headers: provider.headers,
    });
    const receipt = currentPoolReceipt(state.pool.receipts, member, revision, now);
    if (!receipt || !receipt.billingSafe || !receipt.targets.includes('core')) continue;
    found.push({ member, provider, model, revision, receipt, routeId: `${provider.id}::${model.id}` });
  }
  return found;
}

/** Levels every servable member verified, in the order the first one lists them. */
function commonEffortLevels(members: readonly ServableMember[]): RelayReasoningLevel[] {
  if (!members.length) return [];
  return members[0]!.receipt.effortLevels
    .filter(level => members.every(item => item.receipt.effortLevels.includes(level)))
    .filter(isRelayReasoningLevel);
}

/**
 * The catalog row for the pool, or undefined when it is not enabled or no member can serve Core.
 * Credential-free and read-only. Cooldowns never hide it, so it does not appear and disappear in a picker.
 */
export function relayPoolDescriptor(now = Date.now(), registryPath?: string): RelayModelDescriptor | undefined {
  const state = loadPoolState(registryPath);
  if (!state) return undefined;
  const members = servableMembers(state, now, false);
  const entry = members.length ? poolCatalogEntry(state.pool, state.pool.receipts, 'core', now) : undefined;
  if (!entry) return undefined;
  const levels = commonEffortLevels(members);
  return {
    routeId: RELAY_POOL_ROUTE_ID,
    providerId: RELAY_POOL_PROVIDER_ID,
    providerName: 'Relay Free Pool',
    providerShortName: 'Free Pool',
    modelId: RELAY_POOL_MODEL_ID,
    upstreamModelId: RELAY_POOL_MODEL_ID,
    displayName: 'Relay Free Pool',
    authType: 'none',
    favorite: false,
    contextWindow: entry.context_window,
    pricing: { input: 0, output: 0 },
    capabilities: {
      tools: 'unknown',
      vision: 'unknown',
      reasoning: levels.length ? 'adjustable' : 'unknown',
      ...(levels.length ? { reasoningLevels: levels } : {}),
    },
  };
}

type Part = LanguageModelV4StreamPart;
type Providers = Record<string, Record<string, unknown>>;

/** Adds the producing member to any provider metadata a part already carries. */
export function tagPart<T extends { providerMetadata?: Providers }>(part: T, key: string): T {
  if (!part.providerMetadata || Object.keys(part.providerMetadata).length === 0) return part;
  return { ...part, providerMetadata: { ...part.providerMetadata, [ORIGIN_NAMESPACE]: { route: key } } };
}

/**
 * A member only receives provider state (signatures, item ids) it produced itself. Anything from another member,
 * or with no recorded origin, is dropped: a foreign signature is rejected by most providers.
 */
export function isolateHistory(prompt: LanguageModelV4CallOptions['prompt'], key: string): LanguageModelV4CallOptions['prompt'] {
  return prompt.map(message => {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) return message;
    return {
      ...message,
      content: message.content.map(part => {
        const options = (part as { providerOptions?: Providers }).providerOptions;
        if (!options) return part;
        const { providerOptions: _drop, ...clean } = part as unknown as { providerOptions?: Providers } & Record<string, unknown>;
        const origin = (options[ORIGIN_NAMESPACE] as { route?: string } | undefined)?.route;
        if (origin !== key) return clean as unknown as typeof part;
        const { [ORIGIN_NAMESPACE]: _tag, ...own } = options;
        return (Object.keys(own).length ? { ...clean, providerOptions: own } : clean) as unknown as typeof part;
      }),
    } as typeof message;
  });
}

const EFFORT_CLAIM_KEYS = new Set([
  'effort', 'reasoningEffort', 'reasoning_effort', 'thinkingLevel', 'thinkingBudget',
  'thinking_budget', 'effortLevel', 'budget_tokens',
]);

/** Drops per-call keys that claim a reasoning level: a member runs only a level its own Test verified. */
function withoutEffortClaims(options: Providers | undefined): Providers | undefined {
  if (!options) return options;
  const strip = (value: unknown, depth: number): unknown => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 3) return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !EFFORT_CLAIM_KEYS.has(key))
      .map(([key, nested]) => [key, strip(nested, depth + 1)]));
  };
  return strip(options, 0) as Providers;
}

function finishReasonOf(part: Part): string | undefined {
  if (part.type !== 'finish') return undefined;
  const reason = (part as { finishReason?: unknown }).finishReason;
  return typeof reason === 'string' ? reason : (reason as { unified?: string } | undefined)?.unified;
}

/** The coordinator's own checks read `text` and a string `finishReason`; the original part rides along untouched. */
function toPoolEvent(part: Part, key: string): PoolEvent {
  const tagged = tagPart(part as Part & { providerMetadata?: Providers }, key);
  const event: PoolEvent = { ...(tagged as unknown as PoolEvent) };
  if (part.type === 'text-delta' || part.type === 'reasoning-delta') event.text = (part as { delta?: string }).delta;
  if (part.type === 'finish') event.finishReason = finishReasonOf(part);
  (event as unknown as Record<symbol, unknown>)[RAW] = tagged;
  return event;
}

function rawPart(event: PoolEvent): Part {
  return (event as unknown as Record<symbol, unknown>)[RAW] as Part;
}

function wrapPoolError(error: unknown): unknown {
  if (isRelayCoreError(error)) return error;
  if (error instanceof PoolAttemptError) {
    // Output already started: the member's own error is the honest one (it was never replayed elsewhere).
    if (error.committed) return error.cause ?? error;
    return new RelayCoreError(
      'PROVIDER_LOAD_FAILED',
      'All free pool members failed' + (error.cause ? ': ' + describePoolFailure(error.cause) : ''),
      { routeId: RELAY_POOL_ROUTE_ID, retryable: true, cause: error.cause ?? error },
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('No eligible free pool members')) {
    return new RelayCoreError('UNSUPPORTED_MODEL', message, { routeId: RELAY_POOL_ROUTE_ID, retryable: true, cause: error });
  }
  return error;
}

/** Conversations stay on the member that last answered them (until it fails), across calls and model instances. */
const sessions = new PoolSessionRoutes();

interface BuildContext {
  options: CreateRelayModelOptions | undefined;
  call: LanguageModelV4CallOptions;
  /** Always set: Go and Zen members require a session header, so a per-call id stands in when the host gave none. */
  sessionId: string;
  health: PoolHealthStore;
  requestId: string;
  now: number;
  onBuilt?: () => void;
}

/** `createRelayModel` is imported lazily: model.ts imports this file for the pool route. */
async function memberModel(routeId: RelayRouteId, context: BuildContext) {
  const { createRelayModel } = await import('./model.js');
  return createRelayModel(routeId, {
    sessionId: context.sessionId,
    ...(context.options?.onDebug ? { onDebug: context.options.onDebug } : {}),
    ...(context.options?.fetchImpl ? { fetchImpl: context.options.fetchImpl } : {}),
    ...(context.options?.reasoning !== undefined ? { reasoning: context.options.reasoning } : {}),
  });
}

function buildRoutes(members: readonly ServableMember[], context: BuildContext, skips: string[]): DispatchRoute[] {
  return members.map(item => {
    const key = poolRouteKey({ account: item.provider.id, endpointRevision: item.revision, model: item.model.id });
    const scopes = [poolEndpointScope(item.provider.id, item.revision, item.model.id)];
    const accountScopes = [poolAccountScope(item.provider.id)];
    const label = item.provider.id + '/' + item.model.id;
    return lazyPoolRoute({
      member: item.member, revision: item.revision, freeStatus: 'verified_free', catalogVerified: true,
      accessVerified: true, billingSafe: true, targets: item.receipt.targets, toolsVerified: item.receipt.tools,
      defaultEffortVerified: true, effortLevels: item.receipt.effortLevels, contextFits: true, contextVerified: true,
    }, async () => {
      const gone = (reason: string) => { skips.push(label + ': ' + reason); return { skip: reason }; };
      const off = await context.health.disabledFor(scopes);
      if (off) return gone('DISABLED: ' + off.note + ' (run Test to re-enable)');
      const until = await context.health.cooldownFor({ id: item.revision, scopes: [...scopes, ...accountScopes] });
      if (until !== undefined && until > context.now) return gone('cooling down after a failure');

      const outputCap = poolOutputCap(item.provider.id, item.model.id, item.receipt.contextWindow);
      const asked = context.call.maxOutputTokens ?? outputCap;
      if (!Number.isSafeInteger(asked) || asked <= 0) return gone('invalid output limit');
      const requestedOutput = Math.min(asked, outputCap);
      const tools = context.call.tools && context.call.tools.length > POOL_MAX_TOOLS
        ? context.call.tools.slice(0, POOL_MAX_TOOLS) : context.call.tools;
      const prompt = isolateHistory(context.call.prompt, key);
      if (!poolRequestFitsWindow({ prompt, tools }, item.receipt.contextWindow, requestedOutput).fits) {
        return gone('request too large for its context window');
      }

      let model: Awaited<ReturnType<typeof memberModel>>;
      try {
        model = await memberModel(item.routeId, context);
      } catch (error) {
        if (isRelayCoreError(error) && (error.code === 'CREDENTIAL_UNAVAILABLE' || error.code === 'OAUTH_REFRESH_FAILED')) {
          return gone('no credential');
        }
        return gone('could not be prepared: ' + (error instanceof Error ? error.message : String(error)));
      }
      if (typeof model === 'string' || typeof (model as LanguageModelV4).doStream !== 'function') {
        return gone('could not be prepared: unsupported model object');
      }
      context.onBuilt?.();
      const member = model as LanguageModelV4;
      return {
        route: poolRouteFromStream({
          member: item.member, revision: item.revision, freeStatus: 'verified_free', catalogVerified: true,
          accessVerified: true, billingSafe: true, targets: item.receipt.targets, toolsVerified: item.receipt.tools,
          defaultEffortVerified: true, effortLevels: item.receipt.effortLevels, contextFits: true, contextVerified: true,
        }, abortSignal => {
          const source = (async () => (await member.doStream({
            ...context.call,
            prompt,
            tools,
            maxOutputTokens: requestedOutput,
            providerOptions: withoutEffortClaims(context.call.providerOptions as Providers | undefined) as never,
            abortSignal,
          })).stream)();
          return (async function* () {
            const reader = (await source).getReader();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) return;
                yield toPoolEvent(value, key);
              }
            } finally {
              await reader.cancel().catch(() => {});
            }
          })();
        }, { store: context.health, scopes, accountScopes }),
      };
    });
  });
}

/** Runs one call through the shared coordinator and yields the members' spec stream parts. */
async function* runPool(options: CreateRelayModelOptions | undefined, call: LanguageModelV4CallOptions): AsyncGenerator<Part> {
  const now = Date.now();
  const state = await loadPoolStateForCall();
  if (!state) {
    throw new RelayCoreError('UNSUPPORTED_MODEL', 'Relay Free Pool is not enabled or has no members — set it up with `relay-ai pool` or relay-ai ui.', { routeId: RELAY_POOL_ROUTE_ID });
  }
  const members = servableMembers(state, now);
  const skips: string[] = [];
  const requestId = randomUUID().slice(0, 8);
  const signal = call.abortSignal ?? new AbortController().signal;
  const started = { at: Date.now() };
  let answering: string | undefined;
  const routes = buildRoutes(members, {
    options, call, requestId, now, health: new PoolHealthStore(),
    // A host-supplied conversation id is kept; otherwise Go/Zen members still get a header for this call.
    sessionId: options?.sessionId ?? randomUUID(),
  }, skips);
  const hasTools = Boolean(call.tools?.length);
  const events = dispatchFreePool(state.pool, routes, {
    target: 'core', tools: hasTools, effort: 'auto', signal,
    ...(options?.sessionId ? { conversationScope: options.sessionId } : {}),
  }, {
    limits: { ...DEFAULT_POOL_LIMITS, attempts: MAX_POOL_ATTEMPTS },
    sessions, retryable: retryPoolFailure,
    onAttempt: id => { answering = id; started.at = Date.now(); },
    onFailure: (id, error) => {
      const member = poolRouteMember(id);
      if (!member) return;
      const reason = describePoolFailure(error);
      const detail = reason.startsWith('simulated') ? undefined : poolErrorDetail(error);
      recordPoolActivity({ target: 'core', event: 'failed', ...member, requestId, reason, ...(detail ? { detail } : {}), ms: Date.now() - started.at });
    },
  });
  let served = false;
  try {
    for await (const event of events) {
      if (event.type === 'finish') served = true;
      yield rawPart(event);
    }
  } catch (error) {
    if (!signal.aborted) {
      for (const line of skips) {
        const [member, ...reason] = line.split(': ');
        const [providerId, ...model] = (member ?? '').split('/');
        recordPoolActivity({ target: 'core', event: 'failed', providerId: providerId ?? 'pool', modelId: model.join('/') || 'none', requestId, reason: 'skipped: ' + reason.join(': ') });
      }
      recordPoolActivity({ target: 'core', event: 'gave-up', providerId: 'pool', modelId: 'none', requestId, ms: Date.now() - started.at });
    }
    throw wrapPoolError(error);
  }
  const answered = answering ? poolRouteMember(answering) : undefined;
  if (served && answered) recordPoolActivity({ target: 'core', event: 'served', ...answered, requestId, ms: Date.now() - started.at });
}

/** Collects a pool stream into one non-streaming result. */
async function generateFromStream(parts: AsyncIterable<Part>): Promise<LanguageModelV4GenerateResult> {
  const text = new Map<string, { text: string; meta?: Providers }>();
  const reasoning = new Map<string, { text: string; meta?: Providers }>();
  const content: LanguageModelV4GenerateResult['content'] = [];
  const order: Array<{ kind: 'text' | 'reasoning'; id: string }> = [];
  let warnings: LanguageModelV4GenerateResult['warnings'] = [];
  let finishReason = undefined as unknown as LanguageModelV4GenerateResult['finishReason'];
  let usage = undefined as unknown as LanguageModelV4GenerateResult['usage'];
  let providerMetadata: Providers | undefined;
  const open = (map: typeof text, kind: 'text' | 'reasoning', id: string, meta?: Providers) => {
    if (!map.has(id)) { map.set(id, { text: '', ...(meta ? { meta } : {}) }); order.push({ kind, id }); }
  };
  for await (const part of parts) {
    const p = part as Part & { id?: string; delta?: string; providerMetadata?: Providers };
    switch (p.type) {
      case 'stream-start': warnings = (p as { warnings: typeof warnings }).warnings; break;
      case 'text-start': open(text, 'text', p.id!, p.providerMetadata); break;
      case 'text-delta': open(text, 'text', p.id!); text.get(p.id!)!.text += p.delta ?? ''; break;
      case 'text-end': if (p.providerMetadata) { open(text, 'text', p.id!); text.get(p.id!)!.meta = p.providerMetadata; } break;
      case 'reasoning-start': open(reasoning, 'reasoning', p.id!, p.providerMetadata); break;
      case 'reasoning-delta': open(reasoning, 'reasoning', p.id!); reasoning.get(p.id!)!.text += p.delta ?? ''; break;
      case 'reasoning-end': if (p.providerMetadata) { open(reasoning, 'reasoning', p.id!); reasoning.get(p.id!)!.meta = p.providerMetadata; } break;
      case 'tool-call': case 'file': case 'source':
        order.push({ kind: 'text', id: '' });
        content.push(p as never);
        break;
      case 'finish':
        finishReason = (p as { finishReason: typeof finishReason }).finishReason;
        usage = (p as { usage: typeof usage }).usage;
        providerMetadata = p.providerMetadata;
        break;
      default: break;
    }
  }
  // Text and reasoning go ahead of tool calls and other parts, which is the order every provider emits.
  const leading: LanguageModelV4GenerateResult['content'] = [];
  for (const entry of order) {
    if (entry.id === '') continue;
    const source = (entry.kind === 'text' ? text : reasoning).get(entry.id)!;
    leading.push({ type: entry.kind, text: source.text, ...(source.meta ? { providerMetadata: source.meta } : {}) } as never);
  }
  return {
    content: [...leading, ...content], finishReason, usage, warnings,
    ...(providerMetadata ? { providerMetadata } : {}),
  } as LanguageModelV4GenerateResult;
}

/** The pool as a LanguageModel. Pool settings are read on every call. */
export function createRelayPoolModel(options?: CreateRelayModelOptions): LanguageModel {
  const state = loadPoolState();
  const members = state ? servableMembers(state, Date.now(), false) : [];
  if (!state || members.length === 0) {
    throw new RelayCoreError('UNSUPPORTED_MODEL', 'Relay Free Pool is not enabled or has no usable members — set it up with `relay-ai pool` or relay-ai ui.', { routeId: RELAY_POOL_ROUTE_ID });
  }
  if (options?.reasoning !== undefined) {
    const levels = commonEffortLevels(members);
    if (!levels.includes(options.reasoning)) {
      throw new RelayCoreError(
        'UNSUPPORTED_REASONING_LEVEL',
        `Relay Free Pool cannot apply reasoning level "${options.reasoning}": every member must have verified it (verified by all: ${levels.join(', ') || 'none'}).`,
        { routeId: RELAY_POOL_ROUTE_ID },
      );
    }
  }
  const model: LanguageModelV4 = {
    specificationVersion: 'v4',
    provider: 'relay',
    modelId: RELAY_POOL_MODEL_ID,
    supportedUrls: {},
    async doStream(call) {
      const iterator = runPool(options, call)[Symbol.asyncIterator]();
      // Pull the first part now so a pool that cannot answer rejects the call instead of returning a dead stream.
      const first = await iterator.next();
      const stream = new ReadableStream<Part>({
        async start(controller) {
          if (!first.done) controller.enqueue(first.value);
          else controller.close();
        },
        async pull(controller) {
          try {
            const next = await iterator.next();
            if (next.done) controller.close();
            else controller.enqueue(next.value);
          } catch (error) {
            controller.error(error);
          }
        },
        async cancel() { await iterator.return?.(undefined); },
      });
      return { stream };
    },
    async doGenerate(call) {
      const result = await generateFromStream({ [Symbol.asyncIterator]: () => runPool(options, call) });
      return result;
    },
  };
  return model;
}
