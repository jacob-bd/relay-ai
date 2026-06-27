# AGY Full Model Switching Design

Date: 2026-06-24

## Goal

Make `relay-ai agy` support reliable in-session `/model` switching across the user's favorites catalog, targeting the same 20-model favorite limit used elsewhere in Relay AI.

Reliable means the model the user selects in AGY's `/model` picker is the model that receives the next user turn and related cascade work. We should not ship a full catalog that only looks correct in the picker while AGY's cascade silently routes to another favorite.

## Current State

The current committed branch already has a working single-model AGY path and a first attempt at native-slot switching:

- `relay-ai agy --provider=deepseek --model=deepseek-v4-flash --trace -- -p "Reply exactly: ok"` successfully routed through the local Cloud Code gateway.
- The gateway preserves hidden cascade helper models required by AGY executor construction.
- The request adapter normalizes AGY's uppercase JSON Schema `type` enums before provider calls.
- The response adapter handles current AI SDK stream fields.
- The catalog code now maps Relay routes onto native Antigravity catalog slots.

The debug record at `ANTIGRAVITY-DEBUG-SESSION.md` is the source of truth for failed switching attempts.

## What We Must Not Repeat

The previous full-switching attempts failed because all visible Relay catalog entries shared:

```text
model: MODEL_PLACEHOLDER_M20
```

AGY's cascade executor groups by that internal model enum, so multiple Relay entries with the same enum become interchangeable. The UI may show the user's selected favorite, while the request body names a different Relay favorite.

Do not reuse these as the main design:

- Full Relay catalog where every favorite uses `MODEL_PLACEHOLDER_M20`.
- Sticky routing by `requestId`.
- Parsing `USER_SETTINGS_CHANGE` as the source of truth.
- Setting non-primary favorites to `quotaInfo.remainingFraction: 0`.
- Relying on `clientModelConfigs` or `allowedModelConfigs` to constrain the main per-turn cascade model.

These can remain as diagnostic signals only.

## Recommended Approach

Use distinct native AGY catalog slots as the stable switching surface.

Each favorite is assigned to a unique Antigravity-native model slot with a unique internal model enum. The visible picker shows Relay model labels, but the model ID AGY sends back is the native slot ID. Relay's gateway then maps that native slot ID to the correct Relay provider route.

Example:

```text
gemini-3.5-flash-low        -> DeepSeek V4 Flash (Relay)
gemini-3.5-flash-extra-low  -> Kimi K2.7 Code (Relay)
gemini-3.1-pro-low          -> Grok 4.3 (Relay)
```

The Relay catalog IDs such as `relay-ai__xai__grok-4.3` remain internal compatibility aliases, but they are not the primary picker identity for switching.

## Architecture

The current code already contains the first version of this idea in `catalog.ts`:

- `relayNativeSlotIds()` discovers native slots from `agentModelSorts` and then falls back to fixture keys.
- `resolveRelayCatalogSlots()` maps Relay routes to those native slots.
- `buildRelayCatalogSlotEntry()` preserves the slot's native internal enum.

The implementation work should therefore be a hardening refactor, not a second parallel discovery system.

Add one focused AGY slot module under `src/antigravity/`:

- `slot-registry.ts`
  - Defines a curated allowlist of known native AGY slots.
  - Records slot ID, internal enum, intended role, source AGY version, and safety status.
  - Filters the allowlist against the bundled fixture at runtime.
  - Rejects duplicate internal enums.
  - Excludes tab, chat, image, command-only, and cascade-reserved slots from the switch catalog.
  - Provides the small validation helpers currently embedded in `relayNativeSlotIds()`.

Existing modules then depend on this layer:

- `catalog.ts` asks the slot registry for switch slots and maps routes to slots.
- `cloud-code-gateway.ts` uses one route map keyed by native slot ID plus Relay catalog ID.
- `launch-routes.ts` still resolves launch model plus favorites, but the usable route count is bounded by validated switch slots.

## Provider And Auth Identity

Favorites are identified by the pair:

```text
providerId + modelId
```

This matters when the same upstream model exists through different auth paths. In Jacob's local setup, `grok-4.3` can appear from both an OAuth-backed provider such as `xai-oauth` and an API-key-backed provider such as `xai`. Those must be treated as separate routes.

Implementation requirements:

- Keep `catalogId` provider-qualified, for example `relay-ai__xai-oauth__grok-4.3` and `relay-ai__xai__grok-4.3`.
- Carry `authType` and `oauthAccountId` from `LocalProvider` into `AntigravityRoute`.
- Pass `providerId`, `authType`, and `oauthAccountId` into `createLanguageModel()` alongside the route's API key.
- Never dedupe favorites by model name or upstream model ID alone.
- Never let an API-key route reuse an OAuth token, or an OAuth route reuse an API key.
- Make AGY-facing display labels unique when duplicate model names exist so the `/model` dropdown is understandable before the user selects. Example:

```text
Grok 4.3 (Relay - xAI SuperGrok)
Grok 4.3 (Relay - xAI API)
```

Label rules:

- Start with `Model Name (Relay)` for a unique model name.
- When two visible routes share the same model name or upstream model ID, append a concise provider/auth suffix to every route in that duplicate group.
- Prefer the provider display name when it already distinguishes auth, such as `xAI SuperGrok` vs `xAI API`.
- If provider names are still ambiguous, append the auth kind: `OAuth` or `API key`.
- Keep the suffix short enough for AGY's dropdown; avoid opaque IDs unless provider names collide.

The same unique label must be used in:

- `fetchAvailableModels.models[slotId].displayName`
- `clientModelConfigs[].label`
- the automatic `--model <label>` launch argument
- trace logs and warnings

The label logic lives in `src/antigravity/catalog.ts` as `applyUniqueAntigravityRouteLabels(routes)`. `buildAntigravityRoutes()` must call that helper once, before routes are passed to catalog injection, launch args, gateway logging, or warnings. Other modules should consume `route.displayName` and should not rebuild AGY-facing labels independently.

For user-supplied `--model` boot selectors, Relay should match in this order:

1. Exact match against provider model ID, display name, or upstream model ID.
2. Exact match after stripping a visible AGY suffix such as `(Relay)` or `(Relay - xAI SuperGrok)`.
3. Unique prefix match against the same fields.
4. Fail closed with a "did you mean" list when the selector is missing or ambiguous.

This is stricter than the current code, which disambiguates some client config labels but still stores duplicate `route.displayName` values on visible catalog entries.

## Data Flow

1. User launches `relay-ai agy`.
2. Relay resolves the chosen launch model and saved favorites.
3. Relay loads curated AGY switch slots that are present in the current fixture.
4. Relay assigns each route to one slot in favorites order.
5. Relay injects a catalog where AGY sees native slot IDs with Relay display labels.
6. User runs `/model` in AGY and selects a Relay label.
7. AGY sends a generation request with the selected native slot ID.
8. Gateway resolves the slot ID to the matching Relay route and calls the provider.
9. Hidden cascade helper IDs route through an explicit helper policy rather than through arbitrary fixture fallback.

## Full 20-Model Target

Full 20-model switching requires 20 distinct safe AGY switch slots. The checked-in fixture currently exposes fewer obvious agent slots than that. To reach 20, implementation must add a discovery and proof step instead of guessing.

The current fixture inventory is:

- 7 initially usable visible `agentModelSorts` slots.
- 1 visible `agentModelSorts` slot reserved for cascade planning: `gemini-3-flash-agent`.
- 3 cascade-reserved helper slots total.
- 4 tab/chat/internal slots that must not be used for AGY model switching.
- 6 additional model-shaped fixture entries that need proof before use.

The implementation should try, in order:

1. Use visible agent slots from the current `fetchAvailableModels` fixture.
2. Evaluate non-visible but agent-shaped model entries from current captured responses.
3. Promote additional slots only after manual live smoke testing.
4. Avoid binary-level enum injection or automatic binary parsing as launch-time behavior. Binary/string analysis can remain a diagnostic tool, but the product path should use a curated allowlist.

If fewer than 20 safe slots are proven, Relay should not expose unsafe favorites. Jacob wants the full target, but reliability still requires evidence.

The expected launch-day ceiling is 7-13 switchable favorites: 7 from visible non-reserved agent slots plus whichever additional model-shaped entries pass manual live testing.

## Fallback UX

Normal `relay-ai agy` launches should degrade to the proven switchable subset rather than aborting a usable session.

AGY must not automatically consume the global `relay-ai favorites` / legacy `relay-ai models` list. AGY has a smaller and stricter native slot budget than Claude, Codex, Gemini, or the server catalog, so global favorites create noisy launch warnings and imply that unrelated favorites should be switchable in AGY.

AGY uses a dedicated favorites list:

- Config key: `antigravityCliFavoriteModels`
- Manager command: `relay-ai favorites --agy`
- Picker entry: `★ Antigravity CLI Favorites`
- Maximum saved AGY CLI favorites: 6

The seventh validated AGY switch slot is reserved for the selected launch model. This lets users either launch from `★ Antigravity CLI Favorites` or select any normal provider/model as a one-off launch model while still getting up to 6 AGY CLI favorites in the `/model` switch menu.

First-run behavior is informational only. If a user has global favorites but no `antigravityCliFavoriteModels`, print this one-time tip and continue with the selected launch model:

```text
Tip: AGY uses its own favorites list. Run relay-ai favorites --agy to set up switching.
```

Do not auto-seed AGY favorites from global favorites. The user should make that list intentionally because AGY has stricter slot and compatibility rules.

The six-favorite cap is tied to the current seven validated switch slots. Increase it when additional AGY CLI switch slots are manually validated and promoted in the slot registry.

When the user has more favorites than validated slots:

- Assign slots by Relay favorites order, after the explicitly selected launch model.
- Expose only the first N routes that have validated slots.
- Warn at launch with the exact count, for example: `AGY can switch among 7 validated model slots; 8 favorites were not exposed. Reorder with relay-ai favorites --agy.`
- Pause briefly for acknowledgment before launching so the warning is visible in interactive use.
- Continue launching with the switchable subset.
- List skipped favorites in the warning so the user understands what is missing.

Fail closed only when:

- No validated slot exists for the selected launch route.
- The slot registry detects duplicate internal enums.
- The current AGY version/fixture shape is unknown and the user has not opted into experimental switching.
- A future strict/full mode explicitly requires all favorites to be switchable.

## Settings Handling

AGY persists the selected model in:

```text
~/.gemini/antigravity-cli/settings.json
```

Previous testing showed stale settings can override launch intent. Patching the setting to a specific model can also trigger quota checks and crashes. The design keeps the existing safer behavior:

- Remove the stale model field before launch.
- Let `--model <display label>` select the launch model.
- Do not write Relay model choices back into AGY settings.

## Error Handling

Relay should fail early with clear messages when:

- No provider credential is available.
- A favorite is stale or hidden for AGY compatibility.
- Two candidate slots share the same internal enum.
- A candidate slot is tab/chat/internal-only.
- Two AGY-facing route labels remain identical after disambiguation.
- An OAuth route cannot resolve an OAuth access token.
- An API-key route cannot resolve an API key.

When favorites exceed validated slots in normal mode, Relay should warn and expose the validated subset instead of failing launch.

Provider-side errors still flow through the existing gateway stream error path.

## Cascade Helper Routing

The gateway currently maps any unrecognized injected catalog model ID to `routes[0]`. That is too broad for reliable switching because it can hide mistakes and route unsafe fixture IDs through the launch model.

Replace that broad fallback with an explicit helper map:

- Launch/selected native slot IDs route to their assigned Relay route.
- Relay catalog IDs route to their assigned Relay route for compatibility.
- Known helper IDs route according to a named policy:
  - `gemini-2.5-flash` intent/title requests route to the launch route by default.
  - `gemini-2.5-flash` can route to the active route only when an explicit `trackActiveRoute` gateway option is enabled and the gateway has observed at least one user-turn generation request for the current native slot.
  - `gemini-2.5-flash-lite` fallback requests route to the launch route unless a trace proves it follows the active switch.
  - `gemini-3.1-flash-lite` / M50 checkpoint requests must be traced explicitly before treating them as switch-safe.
  - `gemini-3-flash-agent` plan requests should not be used as a user-selectable switch slot until live testing proves it can be both a helper and a selectable slot without conflict.
- Unknown model IDs return a 403 with trace context.

Manual verification must inspect post-switch helper requests. A switch is not reliable if the main user turn changes slot but checkpoints, planner work, or title generation silently stay pinned to the launch model in a way that corrupts state.

`trackActiveRoute` is an internal `GatewayOptions` setting on `startCloudCodeGateway()`, defaulting to `false`. Do not expose a public CLI flag until live traces show active helper routing is correct across normal and switched turns.

## AGY Version Guard

This design is based on AGY CLI 1.0.10 and the currently checked-in `fetchAvailableModels` fixture. Relay should detect incompatible drift before enabling multi-model switching.

At launch:

- Read `agy --version` when available.
- Compare the fixture against the slot registry: required slot IDs must exist and their internal enum values must match.
- If `agy --version` fails or returns unexpected output, continue to fixture shape comparison.
- If the version is unknown but the fixture shape matches the registry, proceed with multi-model switching and print a compatibility warning.
- If the version is unknown and the fixture shape does not match the registry, fall back to single-model mode with a warning.
- If the version is known-incompatible, fall back to single-model mode even if some fixture keys happen to match.

The slot registry should record the AGY version or capture date used to validate each slot.

## Testing Plan

Automated tests:

- Slot registry rejects duplicate enums.
- Slot registry excludes non-agent slots.
- Catalog assignment maps routes to distinct native slot IDs.
- Catalog assignment never falls back to arbitrary fixture keys.
- Catalog assignment exposes only the validated slot count and reports skipped favorites.
- Duplicate model names across providers get unique AGY-facing labels.
- `xai-oauth:grok-4.3` and `xai:grok-4.3` remain separate routes, separate labels, and separate credentials.
- Antigravity routes preserve `authType` and `oauthAccountId` and pass them to `createLanguageModel()`.
- Gateway routes native slot requests to the correct provider route.
- Known cascade helper IDs route only through the explicit helper policy.
- Unknown fixture IDs are rejected instead of falling back to `routes[0]`.
- `trackActiveRoute` defaults off, updates only after a user-turn request for a native slot, and gates active-route helper routing.
- AGY version failure still runs fixture shape comparison.
- Known AGY version plus matching fixture enables multi-model switching.
- Unknown version plus matching fixture enables multi-model switching with a warning.
- Unknown version plus mismatched fixture falls back to single-model mode.
- Settings cleanup removes stale model values without writing new ones.
- Future strict/full-required mode fails closed when fewer than the requested number of safe slots exist.

Manual verification:

- Launch AGY with at least three favorites using distinct proven slots.
- Switch `/model` repeatedly.
- Confirm trace `extracted model` matches the selected native slot each time.
- Confirm provider route calls match the selected Relay favorite.
- Test duplicate Grok favorites from OAuth and API-key providers in one catalog.
- Treat a live smoke test that produces no generation request or a non-Relay route as a verification failure for that slot.
- Confirm post-switch checkpoint, title, and planner requests route according to the helper policy.
- Confirm a multi-turn conversation after switching does not regress to the launch model.
- Run a longer tool-using task after switching.
- Repeat with a large favorites set after enough safe slots are discovered.

## Open Risks

- AGY may not have 20 safe agent slots in its current local registry.
- Some native slots may pass catalog validation but fail executor construction.
- Some slots may be quota-gated by AGY's Google account even though Relay routes the actual provider call.
- Hidden cascade subtasks may continue to use fixed helper IDs and may need active-route binding once switching is proven.
- Future AGY versions may change enum names, fixture schema, or model registry behavior.

## Decision

Proceed with full switching as the target, but make native slot identity the core mechanism and make validation strict. The implementation should prove enough safe slots for full mode rather than masking AGY cascade ambiguity with request-time heuristics.
