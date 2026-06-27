# Antigravity CLI and IDE Support: Findings and Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` for every implementation task. Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to execute this plan task-by-task.

**Status:** Prototype validated; repository implementation has not started.

**Branch:** `codex/antigravity-support`

**Worktree:** `/Users/jbendavi/dev_projects/relay-ai-antigravity`

**Baseline commit:** `204c091` (`fix: surface rate limit errors in Codex App conversation and clean up terminal spam`)

**Baseline verification:** 73 test files and 593 tests passed on June 22, 2026.

**Goal:** Add robust Relay AI support for both the Antigravity CLI (`agy`) and Antigravity IDE, including native model discovery, native inline model switching, and conversation-context preservation across models.

**Recommended architecture:** Run a local Cloud Code-compatible gateway. Pass Google-owned traffic through unchanged, inject Relay AI models into Antigravity's native model catalog, and route generation requests for injected model IDs through Relay AI's existing provider registry and Vercel AI SDK translation layer. Launch Antigravity with its Cloud Code endpoint pointed at the local gateway.

**Proposed commands:**

- `relay-ai agy` — Antigravity CLI
- `relay-ai antigravity` — Antigravity IDE

The command names are proposed, not yet approved. They should remain easy to change until CLI tests are written.

**Hard privacy requirement:** Relay-managed Antigravity sessions must use a signed-out, isolated profile and must not send Cloud Code requests, Google OAuth credentials, or conversation content to Google. Relay mode must fail closed if it cannot establish that isolation. Google models will therefore not be available inside privacy-isolated Relay sessions.

---

## 1. Why This Document Exists

This document preserves all experimental evidence and implementation decisions so a later session can continue without repeating reverse engineering.

The key result is that Antigravity does **not** require the Gemini CLI model-switching workaround. Antigravity has a native model catalog and native picker. Relay AI can add models to that catalog and receive the selected model ID on each generation request.

The IDE has one extra configuration requirement: setting only the `CLOUD_CODE_URL` environment variable is insufficient for stable routing because the IDE's main process can subsequently reset the language server endpoint. The IDE's `jetski.cloudCodeUrl` setting must point to the local gateway as well.

---

## 2. Test Environment

Tests were performed on:

- macOS on Apple Silicon
- Antigravity CLI binary: `agy`
- `agy` version observed: `1.0.10`
- Antigravity IDE:
  - Application: `/Applications/Antigravity IDE.app`
  - Bundle identifier: `com.google.antigravity-ide`
  - Product version observed: `1.107.0`
  - Product application name: `antigravity-ide`
  - Product data folder name: `.antigravity-ide`
- Antigravity IDE language server:
  - `/Applications/Antigravity IDE.app/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm`

The IDE tests used:

- A copied profile under `/tmp/agy-ide-cloned-user-data`
- A temporary extensions directory under `/tmp/agy-ide-test-extensions`
- A local prototype gateway on `127.0.0.1:18768`
- Electron remote debugging on port `9333` for test automation

The normal Antigravity profile was not modified by the final tests.

The copied profile was necessary because a completely blank profile had no Google authentication state and could not fetch the catalog. The clone allowed authenticated requests while isolating all test writes from the normal profile.

This was acceptable only for feasibility testing. It does **not** satisfy the production privacy requirement added afterward. A signed-out, Relay-only IDE session remains a mandatory pre-implementation feasibility gate.

---

## 3. Confirmed Protocol and Runtime Findings

### 3.1 Both Antigravity surfaces support `CLOUD_CODE_URL`

String inspection of the CLI and IDE language-server binaries found:

```text
CLOUD_CODE_URL
Overriding CloudCodeServerURL via CLOUD_CODE_URL environment variable
```

Runtime logs confirmed the IDE language server read the value:

```text
Overriding CloudCodeServerURL via CLOUD_CODE_URL environment variable:
"http://127.0.0.1:18768"
```

The Gemini-related environment variables used elsewhere do not control Antigravity. `CLOUD_CODE_URL` is the relevant hook.

### 3.2 Antigravity fetches its native model catalog from Cloud Code

The relevant request is:

```http
POST /v1internal:fetchAvailableModels
```

The response is compressed JSON, usually gzip-compressed. Relevant fields observed:

```text
models
agentModelSorts[0].groups[*].modelIds
```

`models` is a keyed object containing model metadata.

`agentModelSorts[0].groups[*].modelIds` controls which entries appear in the native picker and their order.

Observed model metadata includes:

- `displayName`
- `model`
- `modelVersion`
- `maxTokens`
- `apiProvider`
- `modelProvider`
- `quotaInfo`

The prototype cloned an existing compatible model entry and changed the display name and route identity.

### 3.3 Generation uses the selected catalog ID

The relevant request is:

```http
POST /v1internal:streamGenerateContent?alt=sse
```

The outer request contains:

```json
{
  "project": "...",
  "requestId": "...",
  "request": {
    "contents": []
  },
  "model": "selected-catalog-model-id",
  "userAgent": "...",
  "requestType": "...",
  "enabledCreditTypes": []
}
```

The selected native model is carried in the top-level `model` field.

Conversation history is carried in `request.contents`.

The generated response is Server-Sent Events. The prototype returned events shaped like:

```json
{
  "response": {
    "candidates": [
      {
        "content": {
          "role": "model",
          "parts": [
            {
              "text": "FIRST_MODEL_OK"
            }
          ]
        }
      }
    ],
    "usageMetadata": {
      "promptTokenCount": 1,
      "candidatesTokenCount": 1,
      "totalTokenCount": 2
    },
    "modelVersion": "relay-native-test",
    "responseId": "relay-native-prototype"
  },
  "traceId": "relay-native-trace",
  "metadata": {}
}
```

A final event included `finishReason: "STOP"`.

### 3.4 Native model switching works in `agy`

Two synthetic catalog entries were added:

- `relay-native-test` / “Relay Native Test”
- `relay-native-second` / “Relay Native Second”

Both appeared in:

- `agy models`
- The native `/model` picker

The CLI switched between these entries without using a custom Relay AI command and without modifying an Antigravity settings file.

This is materially better than the Gemini CLI workaround. Do not reuse Gemini's command-interception design unless future Antigravity versions remove this native route.

### 3.5 CLI context survives model switching

The first synthetic model received a user message containing the marker `ORBIT` and returned:

```text
FIRST_MODEL_OK
```

After selecting the second synthetic model, its request contained:

- The earlier user message containing `ORBIT`
- The first model response `FIRST_MODEL_OK`

The prototype logged:

```text
ROUTED relay-native-second request
(history=3, userContext=true, modelContext=true)
```

It returned:

```text
CONTEXT_PRESERVED
```

Therefore Antigravity owns and preserves the conversation history while the selected model ID changes.

### 3.6 The IDE has two Cloud Code endpoint controllers

The IDE starts the language server with a Cloud Code endpoint argument:

```text
--cloud_code_endpoint <URL>
```

Its main process also calls the language-server RPC:

```text
SetCloudCodeURL
```

Inspection of the bundled IDE JavaScript showed the endpoint is resolved from:

```text
jetski.cloudCodeUrl
```

The relevant logic effectively behaves as:

```text
jetski.cloudCodeUrl override
    or Google internal/dev endpoint
    or cloudcode-pa.googleapis.com
    or daily-cloudcode-pa.googleapis.com
```

Setting only `CLOUD_CODE_URL` initially routed catalog requests through the local gateway, but later generation requests went directly to:

```text
https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse
```

After adding this setting to the isolated profile:

```json
{
  "jetski.cloudCodeUrl": "http://127.0.0.1:18768"
}
```

the IDE launched the language server with:

```text
--cloud_code_endpoint http://127.0.0.1:18768
```

and subsequent language-server logs showed all relevant operations using the local gateway.

Conclusion:

- CLI launch requires `CLOUD_CODE_URL`.
- IDE launch requires both:
  - `CLOUD_CODE_URL`
  - `jetski.cloudCodeUrl` in the profile used for the Relay AI session

### 3.7 The IDE accepts additive catalog entries

Once both IDE endpoint controls were correctly configured, additive synthetic entries appeared alongside Google's native models:

```text
Relay Native Test
Relay Native Second
Gemini 3.5 Flash (Medium)
Gemini 3.5 Flash (High)
Gemini 3.5 Flash (Low)
Gemini 3.1 Pro (Low)
Gemini 3.1 Pro (High)
Claude Sonnet 4.6 (Thinking)
Claude Opus 4.6 (Thinking)
GPT-OSS 120B (Medium)
```

This means the final implementation should inject Relay AI models rather than replace Google's entries.

An earlier experiment appeared to show the IDE filtering additive entries. That result was invalid because the IDE main process had reset the endpoint and was fetching an unmodified catalog directly from Google.

### 3.8 IDE context survives model switching

The IDE native picker successfully switched between two relay-backed entries.

The first relay route saw the `ORBIT` marker and returned:

```text
FIRST_MODEL_OK
```

After switching models, the second route received history containing both markers. A validated run logged:

```text
ROUTED gemini-3-flash-agent request
(history=17, userContext=true, modelContext=true)
```

and returned:

```text
CONTEXT_PRESERVED
```

The UI displayed:

```text
FIRST_MODEL_OK
...
What was preserved from the first relay model?
...
CONTEXT_PRESERVED
```

Although that run temporarily mapped the routes onto two native slots while diagnosing picker behavior, the later endpoint-corrected test proved additive entries also appear and dispatch their own model IDs. Combined, these tests establish:

- Additive relay entries are accepted.
- Native switching changes the routed model.
- Antigravity preserves prior user and model turns.

The repository test suite should reproduce these facts directly without relying on UI automation.

### 3.9 Proxy response headers must be normalized

The temporary proxy initially copied Google's response headers and also assigned a new `Content-Length`.

This produced both:

```http
Content-Length: ...
Transfer-Encoding: chunked
```

The IDE main process rejected the response:

```text
Parse Error: Content-Length can't be present with Transfer-Encoding
```

The fix was:

```js
responseHeaders['content-length'] = String(output.length);
delete responseHeaders['transfer-encoding'];
delete responseHeaders.etag;
```

This must have a regression test before production implementation.

### 3.10 The prototype upstream was Google Daily Cloud Code

The experimental transparent reverse proxy forwarded to:

```text
daily-cloudcode-pa.googleapis.com
```

The production gateway should not permanently hardcode this host.

It should either:

1. Resolve the correct upstream using the same account/tier behavior Antigravity expects, or
2. Use a configurable upstream selected by the launcher and validated with a safe default.

The local gateway must never recursively forward to its own `CLOUD_CODE_URL`.

---

## 4. Proven Architecture

```text
relay-ai agy / relay-ai antigravity
                  |
                  | CLOUD_CODE_URL=http://127.0.0.1:<port>
                  | IDE profile: jetski.cloudCodeUrl=same URL
                  v
         Antigravity Cloud Code gateway
                  |
                  | Injected Relay model
                  v
          Relay AI provider route
                  |
                  v
       existing provider factory /
       Vercel AI SDK adapter
```

Gateway behavior:

| Request | Behavior |
|---|---|
| `loadCodeAssist` | Return the minimum local response required for a signed-out Relay session; never forward to Google |
| `fetchAvailableModels` | Return a local Relay-only catalog; never forward to Google |
| `streamGenerateContent` with Relay model | Translate and dispatch through Relay AI |
| Google model generation | Reject locally |
| Unknown Cloud Code endpoint | Reject locally unless an explicit, reviewed local implementation exists |

This design is stricter than the feasibility prototype. The prototype transparently forwarded Google traffic to learn the protocol. Production privacy mode must not do that.

The minimum local Cloud Code surface must be discovered with a signed-out test profile. Relay AI should implement only the endpoints required to make Relay-backed chat function and reject everything else.

---

## 5. Catalog Design

### Recommended initial scope

Expose:

- The selected launch model
- Resolvable favorites
- Google's original catalog entries

This matches Relay AI's existing favorites model and avoids injecting an unbounded registry into Antigravity.

### Route identity

Use an opaque, collision-resistant catalog ID that can be decoded or looked up locally:

```text
relay-ai__<provider-id>__<encoded-model-id>
```

Do not send provider API keys or upstream URLs in the model ID.

The gateway must keep an in-memory map:

```ts
interface AntigravityRoute {
  catalogId: string;
  providerId: string;
  providerName: string;
  modelId: string;
  upstreamModelId: string;
  displayName: string;
  npm: string;
  apiKey: string;
  baseURL?: string;
  contextWindow?: number;
}
```

### Metadata template

For the authenticated feasibility prototype, a known-compatible entry was cloned from Google's live response.

Production privacy mode cannot fetch that template from Google. It must use a minimal, versioned local catalog fixture derived from the tested schema. The fixture must contain no user, account, project, quota, or Google-issued identifier. Compatibility tests must verify the current installed Antigravity version accepts it before launch.

Override only fields required for Relay AI identity and presentation:

- Catalog object key
- `displayName`
- `modelVersion`
- Context/output metadata when safely supported
- Quota information so Google quota UI is not incorrectly applied

Preserve unknown fields from the template.

### Compatibility validation

If the live catalog lacks:

- `models`
- A usable template
- `agentModelSorts`
- A group containing `modelIds`

then:

- Log a clear compatibility error.
- Leave Google's catalog unmodified.
- Do not crash or corrupt the response.
- Refuse a Relay model launch rather than silently routing the wrong model.

---

## 6. Generation Translation

Antigravity sends Gemini/Cloud Code-shaped requests, while Relay AI already knows how to invoke registry providers through the Vercel AI SDK.

The new adapter should:

1. Read `request.contents`.
2. Convert Gemini content parts to SDK messages.
3. Preserve text, images, tool calls, and tool responses.
4. Convert Cloud Code tool declarations and tool configuration.
5. Invoke the `LanguageModel` produced by `createLanguageModel`.
6. Convert the SDK full stream into Cloud Code SSE events.
7. Preserve usage and finish reasons where available.
8. Keep the Antigravity-selected catalog ID separate from the provider's upstream model ID.

Reuse parsing and streaming logic from:

- `src/gemini-proxy.ts`
- `src/gemini-parts.ts`
- `src/provider-factory.ts`

Do not duplicate the full Gemini CLI proxy. Extract narrowly reusable conversion helpers when behavior is truly identical.

The Antigravity adapter must be tested independently because Cloud Code wraps Gemini requests and responses differently from the public Gemini API.

---

## 7. IDE Profile Safety

The final implementation must not edit the user's normal Antigravity profile in place.

Recommended design:

1. Create a new Relay AI-managed Antigravity profile from an empty directory.
2. Never copy cookies, OAuth state, account databases, machine identity, workspace state, or authentication material from the normal profile.
3. Add `jetski.cloudCodeUrl` to the managed profile.
4. Launch the IDE with:

```text
--user-data-dir=<relay-managed-profile>
--extensions-dir=<relay-managed-extensions-or-existing-safe-dir>
```

5. Stop the gateway when the launched IDE exits, unless the app is intentionally detached and a session lifecycle manager owns cleanup.

Suggested profile location:

```text
~/.relay-ai/antigravity/profile
```

Requirements:

- Never write `jetski.cloudCodeUrl` to the normal Antigravity settings file.
- Keep the managed profile signed out.
- Do not import settings through Google account sync.
- Write JSON atomically.
- Back up the managed settings before rewriting them.
- Detect a stale local gateway URL and update it on every launch.
- Provide a restore/reset command or `--restore` behavior consistent with Codex App support.
- Apply restrictive filesystem permissions where supported.
- Refuse launch if account or OAuth state is detected in the managed profile.

Do not use temporary backup/edit/restore of the normal profile. Do not seed the managed profile from the normal profile. If Antigravity cannot operate with a signed-out profile and a fully local Cloud Code implementation, the privacy requirement is not met and Relay-managed IDE support must remain disabled.

---

## 8. CLI Launch Behavior

`relay-ai agy` should:

1. Locate `agy`.
2. Resolve the provider catalog.
3. Resolve explicit `--provider` and `--model`, or run the normal picker.
4. Resolve launch model plus favorites.
5. Build Antigravity routes.
6. Start the Cloud Code gateway on `127.0.0.1` and a random available port.
7. Set `CLOUD_CODE_URL` only in the child environment.
8. Launch `agy` with passthrough arguments.
9. Shut down the gateway when `agy` exits.

It must not:

- Change the parent shell environment.
- Write Antigravity's normal settings.
- Intercept `/model`.
- Implement a fake model-switch command.

---

## 9. IDE Launch Behavior

`relay-ai antigravity` should:

1. Validate supported operating systems.
2. Locate Antigravity IDE.
3. Resolve launch model plus favorites.
4. Build routes and start the shared Cloud Code gateway.
5. Prepare the Relay AI-managed Antigravity profile.
6. Set both endpoint controls:
   - Child environment `CLOUD_CODE_URL`
   - Managed setting `jetski.cloudCodeUrl`
7. Launch or restart the managed Antigravity IDE instance.
8. Preserve Google's models in the picker.
9. Keep the gateway alive for the IDE session.
10. Cleanly restore only Relay AI-owned temporary state on shutdown.

The normal Antigravity instance and the Relay AI-managed instance must not share a profile lock.

---

## 10. Proposed File Structure

New focused files:

```text
src/antigravity.ts
src/antigravity/types.ts
src/antigravity/catalog.ts
src/antigravity/cloud-code-proxy.ts
src/antigravity/request-adapter.ts
src/antigravity/response-adapter.ts
src/antigravity/launch-cli.ts
src/antigravity/launch-ide.ts
src/antigravity/ide-profile.ts
```

Tests:

```text
tests/antigravity-catalog.test.ts
tests/antigravity-cloud-code-proxy.test.ts
tests/antigravity-request-adapter.test.ts
tests/antigravity-response-adapter.test.ts
tests/antigravity-launch-cli.test.ts
tests/antigravity-launch-ide.test.ts
tests/antigravity-ide-profile.test.ts
```

Likely existing files to modify:

```text
src/types.ts
src/cli.ts
src/config.ts
src/model-compatibility.ts
src/launch-target.ts
src/ai-doc.ts
README.md
package.json
tests/cli.test.ts
tests/config.test.ts
tests/model-compatibility.test.ts
tests/launch-target.test.ts
```

Keep Antigravity protocol code out of `src/gemini-proxy.ts`. Share only stable conversion primitives.

---

## 11. TDD Implementation Plan

### Task 1: Add command parsing and agent types

**Files:**

- Modify: `src/types.ts`
- Modify: `src/cli.ts`
- Modify: `src/config.ts`
- Modify: `src/launch-target.ts`
- Test: `tests/cli.test.ts`
- Test: `tests/config.test.ts`
- Test: `tests/launch-target.test.ts`

**Deliverable:** Relay AI recognizes the proposed `agy` and `antigravity` commands without launching anything.

- [ ] Write failing parser tests for both commands.
- [ ] Run the focused tests and confirm they fail because the commands are unknown.
- [ ] Add the smallest command/type changes.
- [ ] Run focused tests and confirm they pass.
- [ ] Commit: `feat: register Antigravity commands`

### Task 2: Define route and catalog transformation types

**Files:**

- Create: `src/antigravity/types.ts`
- Create: `src/antigravity/catalog.ts`
- Test: `tests/antigravity-catalog.test.ts`

**Deliverable:** Pure catalog injection with no network or process side effects.

Required tests:

- [ ] Build a Relay-only catalog containing one route.
- [ ] Inject multiple routes in deterministic order.
- [ ] Serialize only the locally versioned compatibility fields.
- [ ] Reject catalog-ID collisions.
- [ ] Skip duplicate routes.
- [ ] Reject an unsupported local catalog schema version.
- [ ] Verify provider keys and URLs do not appear in serialized output.
- [ ] Commit: `feat: add Antigravity catalog injection`

### Task 3: Implement Cloud Code body and header utilities

**Files:**

- Create: `src/antigravity/cloud-code-proxy.ts`
- Test: `tests/antigravity-cloud-code-proxy.test.ts`

**Deliverable:** A transparent local reverse proxy that can safely transform compressed JSON responses.

Required tests:

- [ ] Decode and re-encode identity, gzip, deflate, and Brotli bodies.
- [ ] Preserve unmodified endpoint status and body.
- [ ] Replace `Content-Length` after modification.
- [ ] Remove `Transfer-Encoding` when assigning `Content-Length`.
- [ ] Remove stale `ETag` after modification.
- [ ] Bind only to `127.0.0.1`.
- [ ] Use a random port by default.
- [ ] Close all sockets during shutdown.
- [ ] Return a controlled 502 response on upstream failure.
- [ ] Commit: `feat: add Antigravity Cloud Code gateway`

Regression fixture:

```text
Content-Length can't be present with Transfer-Encoding
```

The test must fail before the normalization implementation is added.

### Task 4: Route catalog and generation endpoints

**Files:**

- Modify: `src/antigravity/cloud-code-proxy.ts`
- Modify: `src/antigravity/catalog.ts`
- Test: `tests/antigravity-cloud-code-proxy.test.ts`

**Deliverable:** The gateway serves the minimum local Cloud Code surface and cannot forward traffic to Google.

Required tests:

- [ ] `loadCodeAssist` returns a local signed-out-compatible response.
- [ ] `fetchAvailableModels` returns only Relay routes.
- [ ] Relay generation requests reach only the selected Relay provider.
- [ ] Google generation requests are rejected locally.
- [ ] Unknown endpoints are rejected locally.
- [ ] No gateway code path opens a connection to a Google hostname.
- [ ] Requests containing Google OAuth headers or cookies are rejected and redacted from logs.
- [ ] Query strings such as `?alt=sse` are preserved.
- [ ] An unsupported Antigravity protocol shape fails closed with a compatibility warning.
- [ ] Commit: `feat: route Antigravity Cloud Code requests`

### Task 5: Convert Cloud Code requests to SDK messages

**Files:**

- Create: `src/antigravity/request-adapter.ts`
- Reuse or extract from: `src/gemini-parts.ts`
- Test: `tests/antigravity-request-adapter.test.ts`

**Deliverable:** Pure conversion from a Cloud Code generation envelope to Relay AI SDK input.

Required fixtures:

- [ ] Single user text turn.
- [ ] Multi-turn user/model history.
- [ ] System instructions.
- [ ] Image/file parts supported by existing Gemini conversion.
- [ ] Function declarations.
- [ ] Tool calls.
- [ ] Tool responses.
- [ ] Thought signatures where present.
- [ ] Unknown parts produce an explicit compatibility error.
- [ ] Selected catalog ID resolves to the correct provider/upstream model.
- [ ] Commit: `feat: translate Antigravity requests`

### Task 6: Convert SDK streams to Cloud Code SSE

**Files:**

- Create: `src/antigravity/response-adapter.ts`
- Test: `tests/antigravity-response-adapter.test.ts`

**Deliverable:** SDK output renders correctly in Antigravity.

Required tests:

- [ ] Text deltas.
- [ ] Reasoning/thinking deltas when supported.
- [ ] Tool call start and completion.
- [ ] Usage metadata.
- [ ] Normal stop.
- [ ] Length stop.
- [ ] Provider error before streaming.
- [ ] Provider error after streaming begins.
- [ ] Valid SSE framing and final event.
- [ ] Model version uses the Relay catalog ID, not an unrelated Google ID.
- [ ] Commit: `feat: stream Relay responses to Antigravity`

### Task 7: Connect routes to the existing provider factory

**Files:**

- Modify: `src/antigravity/cloud-code-proxy.ts`
- Use: `src/provider-factory.ts`
- Test: `tests/antigravity-cloud-code-proxy.test.ts`

**Deliverable:** Relay catalog selections invoke the existing provider registry and SDK adapter.

Required tests:

- [ ] `npm`, API key, base URL, and upstream model ID reach `createLanguageModel`.
- [ ] Catalog aliases never become upstream provider model IDs.
- [ ] Provider failures become usable Antigravity errors.
- [ ] Two model routes can alternate within one gateway.
- [ ] A second route receives all history supplied by Antigravity.
- [ ] Commit: `feat: connect Antigravity routes to providers`

### Task 8: Build favorites-backed Antigravity routes

**Files:**

- Create or extend: `src/antigravity/catalog.ts`
- Reuse: `src/favorites-resolver.ts`
- Modify: `src/model-compatibility.ts`
- Test: `tests/antigravity-catalog.test.ts`
- Test: `tests/model-compatibility.test.ts`

**Deliverable:** Launch model and favorites become safe Antigravity catalog routes.

Required tests:

- [ ] Launch model is always first.
- [ ] Favorites are deduplicated.
- [ ] Stale favorites are skipped.
- [ ] Unroutable models are skipped with trace output.
- [ ] Route count respects the existing catalog cap unless a separate justified cap is introduced.
- [ ] Google/Anthropic/OpenAI-compatible provider examples resolve correctly.
- [ ] Commit: `feat: build Antigravity favorites catalog`

### Task 9: Implement `agy` discovery and launch

**Files:**

- Create: `src/antigravity/launch-cli.ts`
- Create: `src/antigravity.ts`
- Modify: `src/cli.ts`
- Test: `tests/antigravity-launch-cli.test.ts`
- Test: `tests/cli.test.ts`

**Deliverable:** `relay-ai agy` starts the gateway and launches the CLI.

Required tests:

- [ ] Find `agy` on `PATH`.
- [ ] Give a clear installation error when missing.
- [ ] Child receives `CLOUD_CODE_URL`.
- [ ] Parent environment remains unchanged.
- [ ] Antigravity passthrough arguments are preserved.
- [ ] Relay-managed flags are removed before child launch.
- [ ] Gateway closes after child exit.
- [ ] `--help`, `--version`, and `--trace` behavior is documented and tested.
- [ ] Commit: `feat: launch Antigravity CLI`

### Task 10: Prove signed-out operation and implement safe IDE profile management

**Files:**

- Create: `src/antigravity/ide-profile.ts`
- Test: `tests/antigravity-ide-profile.test.ts`

**Deliverable:** A fresh, signed-out Relay AI-managed profile can use Relay models without copying or transmitting Google identity state. This is a release gate.

Required tests:

- [ ] Create the managed profile from an empty directory.
- [ ] Confirm no normal-profile files are copied.
- [ ] Set `jetski.cloudCodeUrl` to the current gateway.
- [ ] Update stale gateway ports.
- [ ] Write atomically.
- [ ] Detect and reject OAuth tokens, Google cookies, signed-in account state, or copied machine identity.
- [ ] Confirm the gateway receives catalog and generation requests from the signed-out profile.
- [ ] Confirm no request reaches a Google hostname during the acceptance test.
- [ ] Confirm Relay model A and model B can switch while preserving context.
- [ ] Disable IDE launch with an explicit privacy error if signed-out operation fails.
- [ ] Handle malformed settings with backup and clear error behavior.
- [ ] Apply restrictive permissions where supported.
- [ ] Commit: `feat: manage isolated Antigravity profile`

### Task 11: Implement IDE discovery and launch

**Files:**

- Create: `src/antigravity/launch-ide.ts`
- Modify: `src/antigravity.ts`
- Modify: `src/cli.ts`
- Test: `tests/antigravity-launch-ide.test.ts`
- Test: `tests/cli.test.ts`

**Deliverable:** `relay-ai antigravity` launches an isolated IDE session through the gateway.

Required tests:

- [ ] Locate the macOS app bundle.
- [ ] Add Windows/Linux discovery only when verified; otherwise fail with an explicit platform message.
- [ ] Pass `--user-data-dir`.
- [ ] Pass a safe extensions directory.
- [ ] Set `CLOUD_CODE_URL`.
- [ ] Ensure managed settings contain `jetski.cloudCodeUrl`.
- [ ] Handle an already-running managed instance.
- [ ] Keep the gateway alive for the IDE lifecycle.
- [ ] Do not terminate or mutate the user's normal Antigravity instance.
- [ ] Refuse to launch if the managed profile is signed in.
- [ ] Commit: `feat: launch Antigravity IDE`

### Task 12: Add protocol compatibility diagnostics

**Files:**

- Modify: `src/antigravity/catalog.ts`
- Modify: `src/antigravity/cloud-code-proxy.ts`
- Modify: `src/antigravity.ts`
- Test: relevant Antigravity test files

**Deliverable:** Antigravity updates fail safely and produce actionable diagnostics.

Required tests:

- [ ] Detect incompatible catalog shape.
- [ ] Detect an unknown generation envelope.
- [ ] Include Antigravity version when discoverable.
- [ ] Include endpoint and trace ID without logging auth tokens.
- [ ] `--trace` records route decisions and compatibility failures.
- [ ] Logs redact authorization headers, API keys, and profile secrets.
- [ ] Commit: `feat: add Antigravity compatibility diagnostics`

### Task 13: Documentation and full verification

**Files:**

- Modify: `README.md`
- Modify: `src/ai-doc.ts`
- Create: `docs/ANTIGRAVITY.md`
- Modify: `package.json` only if scripts or packaged files require it

**Deliverable:** User-facing setup, commands, limitations, and recovery instructions.

Documentation must cover:

- [ ] Difference between `agy` and Antigravity IDE commands.
- [ ] Native model switching.
- [ ] Favorites behavior.
- [ ] Managed IDE profile.
- [ ] Google models are intentionally unavailable in privacy-isolated Relay mode.
- [ ] Relay mode uses a signed-out profile and does not forward Cloud Code traffic to Google.
- [ ] Relay AI cannot guarantee network anonymity for unrelated application traffic without OS-level network controls.
- [ ] How to reset the managed profile.
- [ ] How to diagnose a Cloud Code protocol change.
- [ ] Current platform support.

Final verification:

```bash
npm run typecheck
npm test
npm run build
relay-ai agy --help
relay-ai antigravity --help
```

Manual CLI acceptance:

1. Launch with two favorite Relay models.
2. Confirm both appear in native `/model`.
3. Send a marker through model A.
4. Switch to model B.
5. Confirm model B receives the marker and model A response.

Manual IDE acceptance:

1. Launch through the Relay AI-managed profile.
2. Confirm the profile is signed out.
3. Confirm no Google models appear and two Relay favorites do appear.
4. Send a marker through model A.
5. Switch to model B using the native picker.
6. Confirm model B receives the marker and model A response.
7. Confirm the normal profile settings were not changed.
8. Capture network activity and confirm no request from the managed session reaches a Google hostname.

Commit: `docs: document Antigravity support`

---

## 12. Security Requirements

- Bind the gateway to `127.0.0.1`, never all interfaces.
- Prefer a random port.
- Launch with a fresh, signed-out Relay-managed profile.
- Never copy Google OAuth tokens, cookies, account state, machine identity, or synced profile data.
- Reject inbound Google OAuth tokens and cookies rather than forwarding them.
- Never log Relay provider API keys.
- Strip or redact `Authorization`, cookies, and credential-bearing headers in traces.
- Do not embed credentials in catalog IDs.
- Do not expose route configuration through an unauthenticated diagnostics endpoint.
- Keep managed-profile permissions restrictive.
- Pass provider API keys only to the corresponding Relay provider.
- Reject unknown catalog IDs locally.
- Production privacy mode must contain no Google upstream forwarding code path.

Consider adding a per-session secret header if Antigravity allows custom headers. If it does not, local loopback binding plus opaque random port is the minimum boundary.

### Privacy guarantee boundary

Relay AI can guarantee that its own gateway does not forward identity, prompts, or Cloud Code traffic to Google when tests and implementation are fail-closed.

Relay AI cannot honestly guarantee that Google cannot correlate the device or IP merely because the user is signed out. The Antigravity executable may independently contact Google for updates, telemetry, crash reporting, fonts, authentication checks, or other services outside the Cloud Code gateway.

If the product requirement is **no network connection from the Relay-managed Antigravity process to any Google-owned host**, implementation must add and verify an OS-level containment mechanism. Possible mechanisms include a dedicated network namespace, application firewall rules, or an explicit outbound proxy allowlist. Availability differs by operating system and may prevent Antigravity from starting.

Do not market this feature as anonymous, untraceable, ban-proof, or impossible for Google to correlate. Describe it accurately as:

```text
Signed-out Relay profile with Google Cloud Code forwarding disabled
```

---

## 13. Known Risks and Mitigations

### Undocumented Google protocol

Risk: Google can change the Cloud Code schema.

Mitigation:

- Transform minimally.
- Preserve unknown fields.
- Use live entries as templates.
- Validate shapes.
- Fail safely.
- Add trace diagnostics.
- Maintain captured redacted fixtures.

### IDE endpoint resets

Risk: Environment-only routing silently stops intercepting generation.

Mitigation:

- Always configure both `CLOUD_CODE_URL` and `jetski.cloudCodeUrl`.
- Test the IDE launch arguments and managed settings together.

### Response header incompatibility

Risk: Node clients reject duplicate framing headers.

Mitigation:

- Explicit response-header normalization.
- Regression test for `Content-Length` plus `Transfer-Encoding`.

### Authentication in isolated IDE profiles

Risk: Antigravity may refuse agent functionality while signed out.

Mitigation:

- Implement the minimum local `loadCodeAssist` and catalog responses.
- Test with a genuinely empty profile and no Google identity state.
- Treat successful signed-out model switching as a release gate.
- If it cannot be made to work without sign-in, do not ship Relay-managed IDE support under this requirement.

### Provider feature mismatch

Risk: Some registry models do not support tools, images, or reasoning features Antigravity requests.

Mitigation:

- Reuse `model-compatibility.ts`.
- Filter clearly incompatible models.
- Convert unsupported request parts into explicit errors.
- Do not silently drop tool calls or multimodal content.

### Gateway lifecycle for desktop IDE

Risk: The launcher exits while the IDE still needs the gateway, or an orphan gateway remains.

Mitigation:

- Treat the managed IDE process/session as the gateway owner.
- Add signal handling and child-exit cleanup.
- Consider a small session-state file for stale-process recovery.

---

## 14. Decisions Still Requiring Confirmation

These do not invalidate the prototype:

1. Final command names:
   - Recommended: `relay-ai agy`
   - Recommended: `relay-ai antigravity`
2. Initial platform scope for IDE:
   - Recommended: ship macOS first because it is tested.
   - Add Windows/Linux only after binary/profile discovery is tested.
3. Catalog scope:
   - Recommended: launch model plus favorites.
   - Alternative: all compatible registry models, which risks a very large picker.
4. Managed profile location:
   - Recommended: beneath `RELAY_AI_HOME`.

Do not assume answers during implementation if Jacob has not approved them.

---

## 15. Resume Checklist

At the start of the next session:

1. Open this document.
2. Confirm worktree:

```bash
cd /Users/jbendavi/dev_projects/relay-ai-antigravity
git status --short --branch
```

3. Confirm branch is `codex/antigravity-support`.
4. Confirm `main` has not advanced; rebase before implementation if needed.
5. Run:

```bash
npm test
```

6. Confirm command names and catalog scope with Jacob if still unresolved.
7. Before normal implementation, run the signed-out feasibility gate:
   - Empty temporary profile
   - No copied account or OAuth state
   - Fully local `loadCodeAssist`
   - Fully local Relay-only catalog
   - Google-host network monitoring
   - Native model switch and context test
8. If the signed-out gate fails, stop and report that the privacy requirement blocks release.
9. If it passes, begin Task 1 with failing tests.
10. Never implement before the failing test.

Temporary prototype scripts were under `/tmp`, especially:

```text
/tmp/agy-native-model-proxy.mjs
/tmp/agy-cdp.mjs
```

They are experimental evidence, not production code, and may disappear after reboot. The required behavior is fully captured in this document.

---

## 16. Final Confidence Statement

High confidence:

- Both surfaces can be pointed at a local Cloud Code gateway.
- Both surfaces can display Relay-injected models in their native picker.
- The selected model is observable in generation requests.
- Native switching preserves conversation context.
- No Gemini CLI-style command hack is required.
- The IDE can be supported without modifying the installed application.

Not yet proven:

- Antigravity IDE agent functionality works from a genuinely signed-out profile using only locally emulated Cloud Code endpoints.
- The Antigravity process makes no independent Google network requests outside the configurable Cloud Code endpoint.

Remaining engineering work:

- Signed-out, no-Google-upstream feasibility gate.
- Production-grade request/response translation.
- Safe managed-profile lifecycle.
- Protocol compatibility guards.
- Full automated TDD coverage.
- Cross-platform IDE verification.

The prototype removed the model injection, switching, and context-preservation feasibility risks. The new privacy requirement introduces a separate release-blocking feasibility question that must be tested before implementation proceeds.
