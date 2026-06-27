# Antigravity Debug Session - 2026-06-22/23

Last updated: 2026-06-23 10:54 EDT

## Result

Resolved for the reported path:

```bash
relay-ai agy --provider=deepseek --model=deepseek-v4-flash --trace -- \
  -p "Reply exactly: ok" --print-timeout 15s
```

Observed output:

```text
ok
```

Successful relay trace:

```text
/tmp/relay-ai-agy-trace-1782226467744.log
```

Key successful trace lines:

```text
extracted model: relay-ai__deepseek__deepseek-v4-flash
text-delta: "ok"
finish: stop
```

Antigravity CLI 1.0.10 now constructs its executor, sends generation requests
through the local Cloud Code gateway, receives DeepSeek output, and prints it.

## Original failure

The reported command launched Antigravity but every prompt ended with:

```text
Agent execution terminated due to error.
```

The Antigravity log showed:

```text
failed to construct executor: unknown model key MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE: model not found
```

No generation request reached relay at that stage.

## Confirmed root causes

### 1. Required hidden Google model definitions were removed

Relay's privacy-filtered catalog retained only visible relay entries. Antigravity
also requires hidden server-supplied definitions for its cascade executor:

```text
gemini-2.5-flash-lite -> MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE
gemini-2.5-flash      -> MODEL_GOOGLE_GEMINI_2_5_FLASH
gemini-3-flash-agent
gemini-3.5-flash-low
```

An authenticated pass-through capture of Google's current responses proved that
Flash Lite is present in the server catalog. The binary was not inherently
missing support for it; relay had removed data required by the binary.

Capture files:

```text
/tmp/agy-google-response-001-_v1internal_loadCodeAssist.decoded.json
/tmp/agy-google-response-005-_v1internal_fetchAvailableModels.decoded.json
/tmp/agy-google-response-007-_v1internal_listExperiments.decoded.json
```

The catalog also supplies `CASCADE_USE_EXPERIMENT_CHECKPOINTER` metadata.
Without valid nonzero token limits, executor construction advanced but failed
later validation.

### 2. Antigravity emits uppercase JSON Schema type enums

Antigravity tool declarations use protobuf-style values:

```text
OBJECT, STRING, ARRAY, INTEGER, NUMBER, BOOLEAN, NULL
```

The Vercel AI SDK and upstream providers require standard lowercase JSON Schema
types. Before normalization, providers rejected tools with errors such as:

```text
tool parameter root must be an object type
parameters.type must be "object", got OBJECT
properties type 'STRING' is invalid
```

The request adapter now recursively normalizes only recognized `type` fields,
including type arrays, while preserving enum values and descriptions.

### 3. Multiple relay favorites collided on one internal model enum

Antigravity maps catalog entries through a finite internal model enum. All relay
entries used the same compatible placeholder, so a selected DeepSeek label could
resolve to arbitrary favorite routes.

An `agy` launch now advertises only the explicitly selected route. Hidden
cascade helper IDs are mapped to that same route.

### 4. Relay used outdated AI SDK stream field names

Current AI SDK `fullStream` events use:

```text
text-delta.text
tool-input-start.id
tool-input-delta.id
```

The gateway read:

```text
textDelta
toolCallId
```

Real provider text was therefore replaced with empty strings, and incremental
tool arguments could be lost. This caused Antigravity to repeatedly report:

```text
PlannerResponse without ModifiedResponse encountered
```

The gateway now supports the current fields with backward-compatible fallbacks.

### 5. The default launch model argument used the wrong identifier

Antigravity 1.0.10 accepts the injected display label:

```text
deepseek-v4-flash (Relay)
```

It does not accept the opaque relay catalog ID as a CLI model name. Relay now
passes the route display label unless the user explicitly supplied `--model`.

## Changes made

- Retained hidden cascade anchor models in the injected catalog.
- Added current model enum/provider/token/checkpointer metadata.
- Routed all hidden cascade generation IDs to the selected relay route.
- Normalized uppercase JSON Schema types recursively.
- Updated streaming text and incremental tool-call field handling.
- Propagated provider stream errors instead of returning empty successful SSE.
- Changed `agy` to a deterministic single-selected-model catalog.
- Changed the automatic `--model` value to the Antigravity display label.
- Removed the temporary custom-model settings overlay.
- Removed OAuth expiry-file manipulation.
- Kept trace output in `/tmp/relay-ai-agy-trace-*.log`.

Primary files:

```text
src/antigravity.ts
src/antigravity/catalog.ts
src/antigravity/cloud-code-gateway.ts
src/antigravity/request-adapter.ts
src/antigravity/response-adapter.ts
tests/antigravity-*.test.ts
```

## Disproved or discarded hypotheses

- Authentication race as the primary root cause: keyring authentication
  completed, but the executor still crashed until catalog data was restored.
- Inventing `loadCodeAssist.cascadeModelConfigData`: the field is not part of
  that response protobuf and was ignored.
- JSON custom-model settings overlays: Antigravity did not consume the tested
  shapes, and the temporary implementation was removed.
- Mutating `~/.gemini/oauth_creds.json`: unnecessary and removed.
- `gemini-api:<URL>` as a workaround: model-manager validation rejected it in
  the tested Antigravity 1.0.10 paths.

## Verification

Final automated verification:

```text
npm test          82 files passed, 703 tests passed
npm run typecheck passed
npm run build     passed
```

Gateway regressions cover:

- provider stream error propagation
- current `text-delta.text`
- current incremental tool input IDs
- hidden Flash agent/low route aliases

The end-to-end DeepSeek print-mode smoke test passed.

---

## Multi-model catalog / model-switching attempt — 2026-06-23

This section documents a full day of work trying to make `relay-ai agy` support
in-session model switching via `/model`. Everything was reverted. Read this
before attempting again.

### What we were trying to do

- Show all saved favorites in the agy `/model` picker so the user can switch
  mid-session (analogous to Claude Code's gateway-discovery switching).
- Route each request to whichever model the user selected, even across cascade
  sub-tasks (checkpoints, title-gen, plan steps).

### The fundamental constraint that makes this hard

**All relay catalog entries share `model: MODEL_PLACEHOLDER_M20`.**

This is the only safe placeholder enum available in agy 1.0.10's bundled
offline model registry. M16 (FLASH_LITE) is absent from the registry and causes
an immediate executor crash. M21 (GEMINI_2_5_FLASH) is the plan model slot
and cannot be used for agent inference models.

Because the cascade executor picks inference models by their M20 enum value,
**every relay model in the catalog is treated as interchangeable**. If N relay
models are in the catalog, the cascade rotates through all N — a different model
for every turn, regardless of what the user selected via `/model`.

### Approach 1 — Full multi-model catalog (naïve)

Expose all favorites in `fetchAvailableModels.models` and `agentModelSorts`.

**Result:** Works for the `/model` picker UI. Fails for routing. Cascade rotates
through all M20 models on every agent turn and every cascade sub-task. The model
shown in the status bar and the model that actually runs inference are different
on every turn.

Trace signature:
```
extracted model: relay-ai__xai-oauth__grok-4.3   ← turn 1
extracted model: relay-ai__go__kimi-k2.7-code     ← turn 4
extracted model: relay-ai__nvidia__minimaxai/minimax-m3 ← turn 6
```

### Approach 2 — Single catalog entry + sticky routing via `requestId`

Keep only `routes[0]` in the catalog (prevents rotation). The gateway tracks
`currentUserRoute`, updated when a request has `requestId: "agent/..."` prefix.
Cascade sub-tasks (`checkpoint/...`, bare UUIDs) are redirected to
`currentUserRoute`.

**Problem:** The `agent/` prefix detects user-initiated turns, not the model the
user actually switched to. The cascade still picks random M20 models for the
agent turn itself — even the initial user turn. Sticky routing then locks to
whichever model the cascade chose, not what the user picked.

Trace showing the failure:
```
extracted model: relay-ai__google__gemini-3.1-flash-lite  ← cascade picked this
model-switch: (nothing)                                    ← requestId updated currentUserRoute to gemini-3.1-flash-lite
```

The user selected grok-4.3 but the cascade chose gemini-3.1-flash-lite for turn 1,
so sticky routing locked to gemini-3.1-flash-lite for the whole session.

### Approach 3 — Single catalog entry + `USER_SETTINGS_CHANGE` parsing

agy injects `USER_SETTINGS_CHANGE: "...to North Mini Code Free (Relay)..."` into
every user-initiated turn body. Cascade checkpoints and title-gen never contain
this tag. The gateway reads the tag to detect `/model` switches and updates
`currentUserRoute` to the named route.

**Why it seemed promising:** This correctly identifies what the user chose vs
what the cascade chose. Worked in limited testing.

**Why it failed in practice:** The `USER_SETTINGS_CHANGE` reflects what agy
internally considers the active model — which is what the CASCADE assigned to
that turn via M20 rotation, not what the user chose in the UI. After multiple
`/model` switches, agy's internal state desynchronises from what the user
intends, and the USER_SETTINGS_CHANGE starts reporting cascade-selected models
(e.g., `minimaxai/minimax-m3`) instead of user-selected models (e.g., North
Mini Code Free).

### Approach 4 — `quotaInfo.remainingFraction: 0` on non-primary routes

Expose all routes in the catalog (so they appear in the `/model` picker) but set
`quotaInfo: { remainingFraction: 0 }` on all routes except `routes[0]`. The
intent was to make the cascade skip them for automatic selection while still
showing them in the UI.

**Result:** agy interpreted the aggregate quota (17 models at 0%, 1 model at
100%) as "AI: Out of credits" and immediately terminated the trajectory before
any generate request. The cascade checked quota at initialization, not per
inference call, so the session crashed at startup.

Note: this status message is from agy's own internal quota check, NOT from the
relay models or OpenCode zen credits.

### Approach 5 — `clientModelConfigs` / `allowedModelConfigs` single-entry

Limit `buildCascadeModelConfig` and `buildListModelConfigsResponse` to only
advertise `routes[0]`. The intent was to constrain the cascade's model pool via
the explicit config.

**Result:** The cascade ignores these configs for per-turn agent model selection.
It uses the full `models{}` dict from `fetchAvailableModels` to build its M20
pool. `clientModelConfigs` appears to only influence sub-task routing (plan
model assignment), not the main inference model per turn.

### Root cause: `settings.json` interference

agy persists the last-selected model to `~/.gemini/antigravity-cli/settings.json`.
When a session crashes (e.g., after a user declines tool calls and immediately
switches models), the crashed model name is written to settings. The next
session starts with that stale model overriding the relay-ai `--model` flag.

Symptoms:
- User selects grok-4.3 from relay-ai picker
- settings.json still has "GLM-5.2 (Relay)" from a previous crash
- agy initialises with GLM-5.2 (not grok-4.3)
- `USER_SETTINGS_CHANGE` reports GLM-5.2 throughout the session

An attempt to patch settings.json before launch caused an immediate trajectory
crash on the next run:
- If the patched model (e.g., "MiMo V2.5 Free (Relay)") is out of quota on its
  zen provider, the cascade detects this and terminates at initialization.
- The `--model` flag sets the display but does NOT override the cascade's quota
  check against the settings model.

The patched settings.json approach was reverted. The field is now deleted
entirely (`delete s.model`) before launch so agy uses the `--model` flag cleanly.

### "Agent execution terminated due to error" crash taxonomy

Not all crashes are the same. Key pattern to distinguish them:

| Pattern | Cause |
|---|---|
| 0 `streamGenerateContent` in trace, "AI: Out of credits" in status bar | **Google AI Pro account quota exhausted** — unrelated to relay. Wait for reset. |
| 0 `streamGenerateContent` in trace, no error in status bar | Cascade executor crash at init — usually stale settings.json model with 0 quota |
| N `streamGenerateContent` in trace, then crash | Provider API error (e.g., Nvidia minimax-m3 returning 500 on large payloads) |
| Crash after user declines ALL tool calls and immediately switches `/model` | agy cascade cannot recover from declined-tool state + model switch |

### Internal server error on large payloads

Nvidia's `minimaxai/minimax-m3` and `minimaxai/minimax-m2.7` consistently return
500 on requests over ~90KB. This is triggered by MCP tool responses (e.g.,
NotebookLM returning full notebook lists) getting appended to the conversation
history. Provider-side limit, not a gateway bug.

### What "AI: Out of credits" actually means

This is agy's own message about the **Google AI Pro account** that owns the agy
installation — NOT the zen/OpenCode credits for the relay model. When this
appears, agy validates against Google's backend before making any inference call.
The relay gateway never receives a generate request. The zen/OpenCode provider
may have full quota while this message shows.

### If you want to try model switching again

The only known path that could work:

1. Assign each relay model a **different safe M-number** in the catalog. This
   requires knowing which placeholders are in agy 1.0.10's bundled offline
   registry beyond M20 and M21. You would need a full registry dump (e.g., by
   reverse-engineering the agy binary or finding agy's offline model JSON).

2. If multiple safe M-numbers are available, each relay model gets its own
   unique enum → cascade can route deterministically → model switching becomes
   possible without rotation.

3. Alternatively, wait for agy to expose a `requestedModelId` override in its
   generate request body that the gateway can intercept independently of the
   internal M20 routing.

Do NOT re-attempt any of the Approaches 1–5 above without first solving the
M20 enum collision. They all fail for the same root reason.

---

## Remaining caveats

- `agy` intentionally exposes one selected relay model per process. Favorites
  cannot safely share the same Antigravity internal enum in one catalog.
- Interactive TUI behavior should receive a final manual prompt test, although
  print mode exercises the same executor, catalog, gateway, request adapter, and
  response adapter.
- Other providers may expose provider-specific limitations, but the generic
  uppercase-schema and current-stream-shape failures are fixed centrally.
- The worktree was already heavily dirty. Do not reset or revert unrelated
  Antigravity changes.

---

## Antigravity IDE — Chat panel investigation (2026-06-23)

**Status:** Not yet working. Chat panel crashes on load. The agy CLI works; the IDE does not.

### Error

Chat panel shows: `Cannot read properties of undefined (reading 'options')`

Underlying LS error (captured via CDP console.error interception):
```
ConnectError: [unknown] failed to resolve cascade config:
neither PlanModel nor RequestedModel specified. You must specify a valid model.
```

The cascade executor error propagates to the model picker React component,
which crashes at `groups[0].options` when the model groups array is empty.

### Approaches tried

| # | Approach | Result |
|---|----------|--------|
| 1 | Injected `cascadeModelConfigData` with various field combos (`planModelName`, `planModel`, `requestedModel`, `modelOrAlias`) | Crashed — the real Google API does NOT return this field in `loadCodeAssist` |
| 2 | Removed `cascadeModelConfigData` entirely | Still crashed — cascade resolver still can't resolve config |
| 3 | Added `clientModelSorts` + `modelLabels` to cascade config | Still crashed |
| 4 | Tried `MODEL_PLACEHOLDER_M20`, `M21` for cascade model | Still crashed |
| 5 | Used isolated profile (`--user-data-dir`) | Crashed — blank profile missing cached auth/state |
| 6 | Injected gateway URL into normal profile (no `--user-data-dir`) | Crashed — same cascade resolver error |
| 7 | Served raw fixture (no model injection at all) | Still crashed — stale fixtures are the problem |

### Key discovery: real API response capture

Set up a transparent HTTP proxy (`/tmp/capture-proxy2.js`) that forwarded LS
requests to `https://daily-cloudcode-pa.googleapis.com` and saved responses.

Captured responses at `/tmp/ag-capture-v1internal_*.bin` (gzip-compressed JSON).

**Critical findings:**

1. **`loadCodeAssist`** — Google does NOT return `cascadeModelConfigData`. Just tier info.

2. **`fetchAvailableModels`** — Model enum values have CHANGED since our fixture was captured:

   | Catalog key | Our fixture | Real API now |
   |-------------|-------------|--------------|
   | `gemini-3.5-flash-low` | `MODEL_PLACEHOLDER_M21` | `MODEL_PLACEHOLDER_M20` |
   | `gemini-3-flash-agent` | `MODEL_PLACEHOLDER_M16` | `MODEL_PLACEHOLDER_M132` |

   Real API also has `vertexModelId` field, more model entries (19 total), and
   different `modelExperiments` checkpointer configs. The `defaultAgentModelId`
   is `gemini-3.5-flash-low` (M20).

3. **`listExperiments`** — Real API returns `experimentIds` (integer array), NOT
   the `experiments` map we serve. Our format is wrong.

4. **`onboardUser`** — Real API returns operations-style response with `@type`,
   `cloudaicompanionProject`, and `status` fields.

5. **`fetchUserInfo`** — `{"userSettings": {}, "regionCode": "CA"}` — matches ours.

### Separate profile vs inject-and-restore

The isolated profile approach (`~/.relay-ai/antigravity/profile`) was questioned:

- Creates hidden storage growth users don't know about
- Missing all cached auth state, model registry data, onboarding state
- Normal IDE profile at `~/Library/Application Support/Antigravity IDE/` works fine

Alternative: inject `jetski.cloudCodeUrl` into the normal profile's `settings.json`,
launch the IDE, restore the original value on exit. Same pattern as Claude Code's
env-var approach but for a settings file.

Both approaches were tested — both show the same cascade resolver error,
confirming the issue is in the gateway responses, not the profile approach.

### Diagnostic tools

- **CDP** via `--remote-debugging-port=9500`: injected `console.error` capture
  with `Page.addScriptToEvaluateOnNewDocument`, reloaded with `Page.reload`
- **Transparent HTTP proxy**: `capture-proxy2.js` forwarding to Google, saved
  gzip responses
- **LS binary strings analysis**: found protobuf field names, model enum registry,
  cascade config accessor paths (e.g., `CascadePlannerConfig.GetPlanModel`,
  `DefaultOverrideModelConfig.model_or_alias`)
- **LS log**: `~/.relay-ai/antigravity/profile/logs/*/window1/exthost/google.antigravity/Antigravity IDE.log`
- **Gateway trace**: `--trace` flag, logs at `/tmp/relay-ai-ide-trace-*.log`
- **agm CLI**: connected via CDP port 9500 for model list queries (note: agm may
  be outdated for IDE v2.1.1)

### Next steps to resolve

1. **Update ALL fixtures** from the captured real API responses — the stale
   model enums (M21→M20, M16→M132) are likely the root cause
2. **Fix `listExperiments` response format** — use `experimentIds` integer array
   instead of `experiments` map
3. **Fix `onboardUser` response** — match operations-style format
4. **Consider hybrid proxy** — forward config endpoints to Google's real API
   (with auth passthrough), intercept only `fetchAvailableModels` (inject relay
   models) and `streamGenerateContent` (route to providers). This avoids stale
   fixture problems entirely.
5. Decide on isolated profile vs inject-and-restore approach
