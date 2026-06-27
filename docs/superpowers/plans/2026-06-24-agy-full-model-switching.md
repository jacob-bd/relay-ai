# AGY Full Model Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `relay-ai agy` switch reliably among validated Relay favorites from Antigravity's `/model` dropdown, with no route ambiguity between same-named models, OAuth-backed providers, and API-key-backed providers.

**Architecture:** Keep the current local Cloud Code gateway and catalog injection path. Add one curated native slot registry, refactor `catalog.ts` to consume it, make route labels and auth identity explicit, and replace broad helper fallback routing with named helper policies.

**Tech Stack:** TypeScript ESM, Vitest, `@clack/prompts`, current Vercel AI SDK provider factory, checked-in Antigravity fixtures.

## Global Constraints

- Do not reuse the failed full-catalog `MODEL_PLACEHOLDER_M20` approach documented in `ANTIGRAVITY-DEBUG-SESSION.md`.
- Do not route arbitrary unknown Antigravity fixture IDs to the launch route.
- Do not dedupe favorites by model name or upstream model ID. The unique route key is `providerId + modelId`.
- Do not use global favorites as AGY CLI switch favorites. AGY CLI uses `antigravityCliFavoriteModels`.
- AGY CLI favorites are managed with `relay-ai favorites --agy` and capped at 6.
- The AGY provider picker entry is exactly `★ Antigravity CLI Favorites`.
- Do not let an OAuth route reuse an API-key token, or an API-key route reuse an OAuth token.
- Do not expose `gemini-3-flash-agent` as a user-selectable slot until manual traces prove it can be both helper and switch slot.
- Do not write Relay model choices into `~/.gemini/antigravity-cli/settings.json`; keep the existing stale-model cleanup behavior.
- Every user-visible AGY model label must be unique before launch. This includes the dropdown catalog, client model configs, automatic `--model`, traces, and warnings.
- Normal mode may expose fewer than 20 favorites when fewer safe native slots are validated. Reliability wins over showing an unsafe catalog.
- User-supplied AGY `--model` matching must be exact first, then unique prefix, then fail closed with candidate suggestions.

## Evidence To Preserve

The current fixture has 8 visible `agentModelSorts` entries:

- `gemini-3.5-flash-low` -> `MODEL_PLACEHOLDER_M20`
- `gemini-3-flash-agent` -> `MODEL_PLACEHOLDER_M132` (reserved)
- `gemini-3.5-flash-extra-low` -> `MODEL_PLACEHOLDER_M187`
- `gemini-3.1-pro-low` -> `MODEL_PLACEHOLDER_M36`
- `gemini-pro-agent` -> `MODEL_PLACEHOLDER_M16`
- `claude-sonnet-4-6` -> `MODEL_PLACEHOLDER_M35`
- `claude-opus-4-6-thinking` -> `MODEL_PLACEHOLDER_M26`
- `gpt-oss-120b-medium` -> `MODEL_OPENAI_GPT_OSS_120B_MEDIUM`

Launch-day validated switch capacity is therefore 7 slots: all visible agent slots except `gemini-3-flash-agent`.

Additional model-shaped fixture entries may only be promoted after manual live traces prove executor construction and post-switch routing:

- `gemini-3.1-pro-high`
- `gemini-2.5-pro`
- `gemini-2.5-flash-thinking`
- `gemini-3-flash`
- `gemini-3.1-flash-lite`
- `gemini-3.1-flash-image`

## Implementation Tasks

### 1. Slot Registry

- [ ] Add `tests/antigravity-slot-registry.test.ts` first.
- [ ] Test that the checked-in fixture exposes exactly 7 validated switch slots in this order:

```ts
[
  'gemini-3.5-flash-low',
  'gemini-3.5-flash-extra-low',
  'gemini-3.1-pro-low',
  'gemini-pro-agent',
  'claude-sonnet-4-6',
  'claude-opus-4-6-thinking',
  'gpt-oss-120b-medium',
]
```

- [ ] Test that `gemini-3-flash-agent`, `gemini-2.5-flash`, and `gemini-2.5-flash-lite` are reserved and never returned as switch slots.
- [ ] Test that tab, chat, image, command-only, and unknown fixture entries are excluded from validated switching.
- [ ] Test that duplicate internal enum values among switch slots throw a clear error.
- [ ] Test that fixture shape validation reports missing slot IDs and enum mismatches.
- [ ] Add `src/antigravity/slot-registry.ts`.
- [ ] Export these public types and functions:

```ts
export type AgySlotStatus = 'validated' | 'reserved' | 'candidate' | 'unsafe';
export type AgySlotRole =
  | 'agent-switch'
  | 'cascade-plan'
  | 'cascade-intent'
  | 'cascade-fallback'
  | 'cascade-checkpoint'
  | 'command'
  | 'tab'
  | 'chat'
  | 'image'
  | 'unknown';

export interface AgySlotDefinition {
  slotId: string;
  model: string;
  role: AgySlotRole;
  status: AgySlotStatus;
  validatedWith: string;
  notes?: string;
}

export interface AgySlotValidationResult {
  switchSlots: AgySlotDefinition[];
  reservedSlots: AgySlotDefinition[];
  candidateSlots: AgySlotDefinition[];
  warnings: string[];
}

export function validateAgySlotRegistry(fixture: CatalogFixture): AgySlotValidationResult;
export function getValidatedAgySwitchSlots(fixture: CatalogFixture): AgySlotDefinition[];
export function isReservedAgyHelperSlot(slotId: string): boolean;
```

- [ ] Store the registry as data in that module, not scattered constants in `catalog.ts`.
- [ ] Record the validation source as `AGY CLI 1.0.10 / Antigravity IDE 2.1.1 fixture capture 2026-06-23`.

### 2. Catalog Refactor

- [ ] Update `tests/antigravity-catalog.test.ts` before implementation.
- [ ] Change the large-route cap expectation from 20 to the current validated slot count where AGY switching is involved.
- [ ] Test that catalog assignment never falls back to arbitrary `fixture.models` keys or `route.catalogId` as a selectable slot.
- [ ] Test that `gemini-3-flash-agent` remains present as helper catalog data but is absent from `agentModelSorts`.
- [ ] Test that hidden Relay compatibility aliases still exist for switchable routes only.
- [ ] Replace `relayNativeSlotIds()` in `src/antigravity/catalog.ts` with slot-registry calls.
- [ ] Add a planning helper in `catalog.ts`:

```ts
export interface RelayCatalogSlotPlan {
  slots: RelayCatalogSlot[];
  switchableRoutes: AntigravityRoute[];
  skippedRoutes: AntigravityRoute[];
  validation: AgySlotValidationResult;
}

export function planRelayCatalogSlots(
  catalog: CatalogFixture,
  routes: AntigravityRoute[],
  templateKey: string,
): RelayCatalogSlotPlan;
```

- [ ] Make `resolveRelayCatalogSlots()` return only planned slots, capped to validated slots.
- [ ] Make `injectRelayModels()` use `planRelayCatalogSlots()` once and expose only `switchableRoutes` in `agentModelSorts`.
- [ ] Throw if the selected launch route cannot receive a validated slot.
- [ ] Keep `buildRelayCatalogEntry()` and `buildRelayCatalogSlotEntry()` free of API keys and base URLs.

### 3. Provider/Auth Identity And Dropdown Labels

- [ ] Add tests in `tests/antigravity-catalog.test.ts` and `tests/antigravity-launch-routes.test.ts` for duplicate Grok routes:

```ts
[
  { providerId: 'xai-oauth', providerName: 'xAI SuperGrok', modelId: 'grok-4.3', authType: 'oauth' },
  { providerId: 'xai', providerName: 'xAI API', modelId: 'grok-4.3', authType: 'api' },
]
```

- [ ] Assert the two routes keep separate `catalogId`, `apiKey`, `authType`, and `oauthAccountId`.
- [ ] Assert AGY-facing labels are unique and understandable:

```text
Grok 4.3 (Relay - xAI SuperGrok)
Grok 4.3 (Relay - xAI API)
```

- [ ] Extend `src/favorites-resolver.ts` `ResolvedFavorite` with optional `authType` and `oauthAccountId`.
- [ ] Populate those fields from `LocalProvider` in `resolveFavorite()` and from the AGY-specific resolution code in `src/antigravity/launch-routes.ts`.
- [ ] Extend `src/antigravity/types.ts` `AntigravityRoute` with optional `authType` and `oauthAccountId`.
- [ ] Add a route label helper in `src/antigravity/catalog.ts`:

```ts
export function applyUniqueAntigravityRouteLabels(routes: AntigravityRoute[]): AntigravityRoute[];
```

- [ ] Treat `applyUniqueAntigravityRouteLabels()` as the only AGY-facing label builder. `buildAntigravityRoutes()` calls it once; all launch args, catalog entries, client configs, traces, and warnings consume `route.displayName`.
- [ ] Label rule:
  - Unique model name: `Model Name (Relay)`.
  - Duplicate model name or duplicate upstream model ID: `Model Name (Relay - Provider Name)`.
  - If provider names also collide, append auth kind: `OAuth`, `API key`, or `local`.
  - If labels still collide, append provider ID and throw only if collision remains.
- [ ] Make `buildAntigravityRoutes()` return routes after `applyUniqueAntigravityRouteLabels()`.
- [ ] Use the final `route.displayName` everywhere:
  - `fetchAvailableModels.models[slotId].displayName`
  - `clientModelConfigs[].label`
  - `clientModelSorts[].groups[].modelLabels`
  - `buildAgyLaunchArgs(routes[0].displayName, childArgs)`
  - gateway trace logs
  - launch warnings
- [ ] Remove or simplify the older `routeLabels()` helper so it cannot produce labels that differ from visible catalog entries.
- [ ] Add AGY `--model` matching in `src/antigravity.ts`:
  - Exact match against provider model ID, display name, or upstream model ID.
  - Accept the same values after stripping `(Relay)` or `(Relay - Provider Name)`.
  - Unique-prefix match when exact match fails.
  - Fail closed with candidate suggestions when missing or ambiguous.

### 4. Gateway Route Map And Helper Policy

- [ ] Update `tests/antigravity-gateway.test.ts` before implementation.
- [ ] Change tests that currently expect arbitrary native IDs to route through launch route.
- [ ] Add tests for explicit helper IDs:
  - `gemini-2.5-flash` routes to launch route by default.
  - `gemini-2.5-flash-lite` routes to launch route.
  - `gemini-3-flash-agent` routes to launch route as a helper, not as a switch slot.
  - `gemini-3.1-flash-lite` routes to launch route only under the checkpoint helper policy.
- [ ] Add a test that an unknown model ID returns 403 and does not call `createLanguageModel()`.
- [ ] Add tests for active-route tracking:
  - `trackActiveRoute` defaults to false.
  - With `trackActiveRoute: true`, a user-turn request for a selected native slot updates active route.
  - `gemini-2.5-flash` uses active route only after that observed user-turn request.
  - Helper requests before an observed user-turn request use launch route.
- [ ] Replace the current gateway fallback loop:

```ts
for (const id of Object.keys(injectedCatalog.models)) {
  if (!routeMap.has(id)) routeMap.set(id, routes[0]);
}
```

with explicit route map construction.

- [ ] Add `trackActiveRoute?: boolean` to `GatewayOptions`, default false.
- [ ] Define user-turn tracking as: parsed request ID starts with `agent/` and the request model is one of the selected native switch slots.
- [ ] Keep `trackActiveRoute` internal to `startCloudCodeGateway()` for now. Do not add a public CLI flag until manual traces prove helper routing follows active switched turns correctly.
- [ ] Keep relay catalog IDs routable for compatibility, but do not use them as the primary switch identity.
- [ ] Pass route auth metadata into `createLanguageModel()` in both streaming and unary handlers:

```ts
await createLanguageModel({
  npm: route.npm,
  modelId: route.upstreamModelId,
  apiKey: route.apiKey,
  baseURL: route.baseURL,
  providerId: route.providerId,
  authType: route.authType,
  oauthAccountId: route.oauthAccountId,
});
```

### 5. Version Guard And Single-Model Fallback

- [ ] Add tests for compatibility decisions. Put them in `tests/antigravity-slot-registry.test.ts` unless the helper grows too large.
- [ ] Test sequence:
  - Known compatible version plus matching fixture enables multi-model mode.
  - `agy --version` failure plus matching fixture enables multi-model mode with warning.
  - Unknown version plus matching fixture enables multi-model mode with warning.
  - Unknown version plus mismatched fixture falls back to single-model mode with warning.
  - Known incompatible version falls back to single-model mode even if some fixture keys match.
- [ ] Add `readAntigravityCliVersion(binaryPath?: string)` to `src/antigravity/launch-cli.ts`.
- [ ] Use `execFileSync(binaryPath, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })` and parse the first semver-like token.
- [ ] Add compatibility evaluation to `src/antigravity/slot-registry.ts`:

```ts
export interface AgySwitchCompatibility {
  mode: 'multi-model' | 'single-model';
  validatedSwitchSlotCount: number;
  warnings: string[];
}

export function evaluateAgySwitchCompatibility(opts: {
  version?: string | null;
  versionReadError?: string;
  fixture: CatalogFixture;
}): AgySwitchCompatibility;
```

- [ ] In `src/antigravity.ts`, evaluate compatibility before resolving favorites.
- [ ] When mode is `single-model`, resolve only the selected launch route and skip favorites.
- [ ] When mode is `multi-model`, resolve at most `validatedSwitchSlotCount` routes.
- [ ] Print compatibility warnings before launch.

### 6. Fallback UX For Too Many Favorites

- [ ] Extend `ResolveAntigravityLaunchRoutesResult` in `src/antigravity/launch-routes.ts`:

```ts
capacitySkippedFavorites: FavoriteModel[];
```

- [ ] When the route cap is reached, add remaining non-duplicate favorites to `capacitySkippedFavorites` instead of silently breaking.
- [ ] Keep `droppedFavorites` for stale, hidden, missing-provider, or missing-credential favorites.
- [ ] In `src/antigravity.ts`, when `capacitySkippedFavorites.length > 0`, warn with the exact count:

```text
AGY can switch among 7 validated model slots; 8 favorites were not exposed.
```

- [ ] Include skipped favorites as `providerId:modelId` so Jacob can reorder with `relay-ai favorites --agy`.
- [ ] Pause only in interactive terminal mode. Use a brief `p.confirm()` prompt:

```text
Continue with the validated AGY switch catalog?
```

- [ ] Do not pause in print/noninteractive mode. Treat `-p`, `--prompt`, and `--prompt=...` as noninteractive child args.
- [ ] If the user declines the pause prompt, abort before starting the gateway.

### 6.1. Antigravity CLI Favorites Scope

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `src/cli.ts`
- Modify: `src/antigravity.ts`
- Test: `tests/cli.test.ts`
- Test: `tests/config.test.ts`

- [ ] Add `UserPreferences.antigravityCliFavoriteModels?: FavoriteModel[]`.
- [ ] Add `UserPreferences.antigravityCliFavoritesHintShown?: boolean` for the one-time first-run hint.
- [ ] Persist the new key in `loadPreferences()` and `savePreferences()`.
- [ ] Parse `relay-ai favorites --agy` as the favorites manager with AGY scope.
- [ ] Reuse the existing interactive favorites manager with cap `6` and title `Antigravity CLI Favorites`.
- [ ] Add `★ Antigravity CLI Favorites` as the first AGY provider picker entry.
- [ ] If selected, launch from one of the saved AGY CLI favorites.
- [ ] For all AGY launches, build the switch catalog from the selected launch model plus `antigravityCliFavoriteModels`, not global `favoriteModels`.
- [ ] If global favorites exist but AGY CLI favorites are empty, print this one-time hint and continue: `Tip: AGY uses its own favorites list. Run relay-ai favorites --agy to set up switching.`
- [ ] Keep the cap at 6 while the slot registry has 7 validated switch slots, and increase it when more AGY CLI slots are manually validated.
- [ ] Keep `relay-ai models` as a backward-compatible alias for global favorites.

### 7. Manual Verification

- [ ] Run focused tests:

```bash
npx vitest run tests/antigravity-slot-registry.test.ts
npx vitest run tests/antigravity-catalog.test.ts
npx vitest run tests/antigravity-gateway.test.ts
npx vitest run tests/antigravity-launch-routes.test.ts
npx vitest run tests/antigravity-launch-args.test.ts
```

- [ ] Run full verification:

```bash
npm test
npm run typecheck
npm run build
```

- [ ] Run a single-model smoke test:

```bash
relay-ai agy --provider=deepseek --model=deepseek-v4-flash --trace -- -p "Reply exactly: ok" --print-timeout 15s
```

- [ ] Run a multi-model trace with at least three favorites from different validated slots.
- [ ] In AGY, use `/model` to switch repeatedly and confirm each next user turn logs the selected native slot and correct Relay route.
- [ ] Test duplicate Grok entries from OAuth and API-key providers in one dropdown.
- [ ] Confirm `Grok 4.3 (Relay - xAI SuperGrok)` and `Grok 4.3 (Relay - xAI API)` are visually distinguishable before selection.
- [ ] Confirm checkpoint, title, planner, and fallback helper requests follow the explicit helper policy after switching.
- [ ] Confirm unknown fixture IDs return 403 in trace rather than silently using the launch route.

## Commit Plan

- [ ] Commit 1: slot registry tests and implementation.
- [ ] Commit 2: catalog refactor and route capacity fallback.
- [ ] Commit 3: provider/auth metadata and dropdown label disambiguation.
- [ ] Commit 4: explicit gateway helper routing and active-route tracking.
- [ ] Commit 5: version guard, launch warnings, pause UX, and final build output if `dist/cli.js` changes.
