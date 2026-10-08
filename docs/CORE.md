# Embedding relay-ai (`@jacobbd/relay-ai/core`)

`@jacobbd/relay-ai/core` is a side-effect-free library surface that lets any Node.js application use relay-ai **in-process** — no CLI, no UI, no server, no child process. Two functions cover the whole surface:

1. **`listRelayModels()`** — a credential-free catalog of every model your enabled providers expose.
2. **`createRelayModel(routeId)`** — a ready [Vercel AI SDK](https://sdk.vercel.ai) `LanguageModel` for one of those models, with credentials (including OAuth refresh) resolved behind the scenes.

## What Core is — and isn't

Core is a **read/compose layer** over relay-ai's existing provider registry, credential resolution, and SDK adapter — it doesn't add new capabilities, it exposes existing ones as a library instead of a CLI.

- Relay AI keeps **sole ownership** of provider registration, credentials, the OS keyring, and OAuth login/refresh.
- Your application **never receives or stores** credential material — `createRelayModel()` resolves a credential internally and hands back only the finished SDK model.
- Re-authentication always happens through relay-ai (`relay-ai ui` or `relay-ai providers auth`), never through the consumer.
- Core never starts a server, opens a browser, prints CLI output, or writes registry/preferences files. OAuth refresh can update Relay's credential store, including after a provider rejects an expired token during inference.
- **"OAuth" is not one thing.** Each OAuth provider has its own transport — OpenAI ChatGPT (including the Responses-Lite WebSocket path), Cloud Code Assist, xAI, GitHub, ClinePass and the rest are independent code paths with independent failure modes. A fix to one says nothing about the others; treat them as separate integrations when you test.

## Prerequisites

Core reads the same config relay-ai's CLI uses — it doesn't create it. Before your app can see any models, someone needs to have added at least one provider once:

```bash
npm install -g @jacobbd/relay-ai
relay-ai            # or: relay-ai ui
```

Walk through the wizard (or the browser UI) to add and authenticate at least one provider. That writes `~/.relay-ai/providers.json` (registry) and stores the credential in your OS keychain or the config, depending on what you chose. `listRelayModels()` returns nothing useful until this has happened at least once.

Config location can be overridden with `RELAY_AI_HOME` — useful for pointing a test/CI process at a fixture registry instead of your real one.

## Quick start

```bash
npm install @jacobbd/relay-ai ai
```

```ts
import { listRelayModels, createRelayModel, isRelayCoreError } from '@jacobbd/relay-ai/core';
import { streamText } from 'ai';

const models = listRelayModels();               // credential-free catalog
const model = await createRelayModel(models[0].routeId);

try {
  const result = await streamText({ model, prompt: 'Hello!' });
  for await (const chunk of result.textStream) process.stdout.write(chunk);
} catch (err) {
  if (isRelayCoreError(err)) {
    console.error(`[${err.code}] ${err.message}`, { retryable: err.retryable });
  } else {
    throw err;
  }
}
```

## API reference

Exports from `@jacobbd/relay-ai/core` (see `src/core/index.ts`):

```ts
function listRelayModels(): RelayModelDescriptor[];
async function createRelayModel(
  routeId: RelayRouteId,
  options?: CreateRelayModelOptions,
): Promise<LanguageModel>;
function toRelayRouteId(providerId: string, modelId: string): RelayRouteId;
function parseRelayRouteId(routeId: string): { providerId: string; modelId: string };
function isRelayCoreError(err: unknown): err is RelayCoreError;
class RelayCoreError extends Error { code, retryable, providerId?, routeId? }

type RelayReasoningLevel =
  | 'off' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

interface CreateRelayModelOptions {
  sessionId?: string;
  onDebug?: (message: string) => void;
  fetchImpl?: typeof globalThis.fetch;
  reasoning?: RelayReasoningLevel;
}
```

### `listRelayModels()`

Returns one `RelayModelDescriptor` per cached model of every **enabled** provider. Fully credential-free — it never resolves an API key, refreshes an OAuth token, or calls a provider API. Results are sorted favorites-first, then by provider display name, then by model display name.

### `createRelayModel(routeId, options?)`

Resolves the route to a provider + cached model, resolves the credential (transparently refreshing an expiring OAuth token through relay-ai's existing refresh path if needed), and returns a ready AI SDK `LanguageModel`.

**Which transport backs that model depends on the route** — it is not always the generic SDK-provider product:

| Route | Transport |
|---|---|
| Ordinary API-key and OAuth providers | relay-ai's generic SDK adapter (`createLanguageModel()`), i.e. the matching `@ai-sdk/*` provider package. |
| Models flagged `preferWebSockets` (e.g. OpenAI OAuth `gpt-5.6-luna`) | The generic `@ai-sdk/openai` provider, driven by relay-ai's Responses-Lite **WebSocket** `fetch` instead of HTTP. |
| Cloud Code Assist models (`modelFormat: 'cloud-code'`) | A **specialized native transport**: `@ai-sdk/google` wrapped so requests are enveloped for Cloud Code Assist. Not the generic factory path. |

Passing `reasoning` or `sessionId` additionally returns a *wrapped* model (see below), so the returned object is not guaranteed to be identical to what `createLanguageModel()` alone would build. Everything returned is a normal AI SDK `LanguageModel` and works with `streamText`/`generateText` the same way.

### Shared provider request preparation

Provider requirements are applied on the model itself through
`provider-factory.ts::withProviderRequestDefaults`, so Core and the SDK-backed
launchers use the same preparation on every generated or streamed request:

- Claude Code OAuth receives the billing system line, account/device/session
  metadata and request-shaped beta flags. Existing system blocks and cache
  controls survive unchanged; a pre-applied billing line is not duplicated.
- OpenAI receives `store: false` and `include: ['reasoning.encrypted_content']`
  for reasoning round trips. Explicit per-call options override these defaults.
- Google receives `thinkingConfig.includeThoughts: true`, including the native
  Cloud Code transport. An explicit caller setting still wins.
- Alibaba/DashScope receives a neutral user continuation after a trailing tool
  result, at the upstream boundary rather than in stored conversation history.

Anthropic SDK OAuth requests also use the same one-401-refresh-and-retry policy
as Anthropic passthrough. A refreshed token is retained for later calls on that
model. Other HTTP failures do not trigger credential refresh. ClinePass and
Cloud Code retain their existing provider-specific refresh transports.

This shares provider requirements, not client orchestration: each host still
owns its tool execution, conversation history and session identity. Core's
strict reasoning-level validation also remains distinct from picker substitution.

### `options.sessionId` — OpenCode Go conversation identity

When the route is OpenCode Go, `sessionId` is sent as `x-opencode-session` on
every upstream model call, including streamed, retried, and tool-loop calls.
The value is opaque, trimmed, bounded to 256 characters, and rejected when it
contains control characters. Headers supplied directly on an individual AI SDK
call take precedence over this default. See
[OpenCode Go conversation sessions](OPENCODE-GO-SESSIONS.md) for the client
matrix and the Alef migration checklist.

**Nothing is cached across calls.** Every call re-reads the registry from disk and re-resolves the credential, so a provider you disable, re-authenticate, or add after your app started takes effect on the very next call — no restart needed.

### `options.reasoning` — provider-neutral reasoning level

Ask for a reasoning level in provider-neutral terms and let Relay Core translate it into whatever the resolved route's provider actually wants:

```ts
const model = await createRelayModel('openai-oauth::gpt-5.6-luna', { reasoning: 'xhigh' });
const result = streamText({ model, prompt: 'Plan the migration.' });
```

- **Your application never writes provider-specific `providerOptions`.** The same `'xhigh'` becomes an OpenAI `reasoning.effort`, a Gemini `thinkingConfig`, an OpenRouter `reasoning` object, and so on — that mapping lives inside Relay Core and moves with relay-ai releases.
- **Levels are never substituted.** Core validates the level against the route's real capabilities *before* mapping, so `xhigh` either goes out as `xhigh` or the call throws. It is never quietly replaced with the nearest available value. (relay-ai's own CLI picker does substitute — that convenience is deliberately not part of this contract.)
- **Check first if you want to avoid the throw.** `listRelayModels()[].capabilities.reasoningLevels` reports the exact levels each route accepts (present when `capabilities.reasoning === 'adjustable'`), typed as `RelayReasoningLevel[]` so it round-trips into this option with no cast:

  ```ts
  const descriptor = listRelayModels().find(m => m.routeId === routeId)!;
  const level = descriptor.capabilities.reasoningLevels?.at(-1);   // RelayReasoningLevel | undefined
  const model = await createRelayModel(routeId, level ? { reasoning: level } : {});
  ```

  Every advertised level is guaranteed to map to a real, distinct request — the catalog is filtered through the same mapper that builds the request, so it cannot offer a level that does nothing. But **each route accepts only a subset** of `RelayReasoningLevel`; the union type is not a promise that every route takes every value.
- **The level is applied to every call** made with the returned model, and is merged *underneath* per-call options — an explicit `providerOptions` passed to `streamText`/`generateText` still wins.
- **Omitting `reasoning` changes nothing.** Existing callers keep the previous behavior exactly.
- Levels are resolved eagerly, before any credential or network work, so an unsupported level fails fast without touching the keyring.

### `options.onDebug` — sanitized transport diagnostics

An optional hook for one-line transport diagnostics. Messages carry **event types, field names, endpoint hosts, attempt numbers, status codes, counts, lengths, and error class names** — never credentials, account ids, project ids, prompts, tool arguments, or response bodies.

Scope, accurately:

- **Generic SDK-provider routes** — forwarded to relay-ai's provider factory; the Responses-Lite WebSocket transport is the main producer of messages today (connection, per-frame summaries, terminal events, close codes).
- **Cloud Code Assist routes** — forwarded to the native Cloud Code transport (request fingerprints, per-endpoint request/response, timings, endpoint failover, credential refresh, raw usage and response-body outcome).
- Ordinary HTTP provider calls do not currently emit diagnostics of their own, so a plain API-key route may produce no messages at all. Treat `onDebug` as best-effort observability, not as a guaranteed event stream.

### Antigravity cache diagnostics and custom transport

For an embedded host such as Alef, enable diagnostics when constructing its Cloud Code model:

```ts
const model = await createRelayModel('antigravity::gemini-3.7-flash-high', {
  onDebug: line => diagnosticsLogger.info(line),
  fetchImpl: (input, init) => fetch(input, init), // optional; substitute your transport for A/B tests
});
```

`fetchImpl` is supported on Antigravity Cloud Code routes; other routes ignore it.
It receives the **final Cloud Code envelope and authenticated headers**, and serves
every inference attempt, including endpoint failover and a retry after OAuth refresh.
OAuth token refresh itself uses Relay's existing machinery. A custom transport must
preserve the request signal and return a standard `Response`. A host can bind an
Undici dispatcher inside this function without changing global fetch. This hook is
trusted code: unlike the sanitized debug hook, it sees bearer tokens, project metadata,
prompts, tool schemas and full response bodies. Do not log these from your custom fetch.

Cloud Code debug lines start with `cloud-code: call=<local UUID> attempt=<number>`.
The diagnostic UUID is separate from the upstream request ID and is never sent to
Google. Each call has its own ID; attempt numbers increase across endpoint failover
and credential-refresh retries. `fingerprint` is emitted at attempt 0, before sending.
AI SDK retries that invoke the model again create separate call IDs.

- `fingerprint` includes 128-bit truncated SHA-256 hashes and UTF-8 byte lengths of
  `systemInstruction`, `tools`, `toolConfig` and `generationConfig`. Absent sections
  have `present: false`. It also records the number of function declarations, the
  contents count and the inner request's top-level JSON key order; unknown keys are
  replaced with `[other]` to avoid exposing caller-defined data.
- Each `contents[i]` has a byte length and a cumulative `prefixHash`. The hash covers
  all content entries through index `i`, in order, with byte-length framing. Compare
  successive hashes across calls: matching entries through index `k` identify a shared
  contents prefix through `k`. Compare system/tools hashes separately. Hashes use the
  serialized request sections without sorting keys, so order changes are visible.
- `timing` records `sendMs` (call start to attempt start) and `headersMs` (attempt
  start to fetch returning headers). `end` records `firstBodyByteMs` and `elapsedMs`,
  both measured from call start using a monotonic clock. Body timings reflect when
  Relay observes bytes as they are consumed, not socket-level arrival or server compute
  time. HTTP version and socket reuse are reported as `unavailable` because standard
  fetch does not expose them; a custom transport can instrument its own connection.
- The final `end` event carries raw `promptTokenCount`, `cachedContentTokenCount` and
  `thoughtsTokenCount` as `{ present: true, value: number }` or `{ present: false }`.
  It distinguishes an absent cache field from an explicit zero, before SDK normalization.
  `usageMetadataPresent` indicates whether any usage metadata was observed. The latest
  observed usage object is used; unexpected nonnumeric values are marked invalid and
  never echoed. A missing usage object on a cancelled/failed stream is inconclusive.
- Outcomes are `completed` (response-body EOF), `failed` (body read error) or `cancelled`
  (abort signal or consumer cancellation). EOF does not by itself certify a successful
  model completion; check HTTP status and SDK results too. Failures before response
  headers produce an `end` event with `phase: "fetch"`. Retryable attempts log their
  status or network error before failover; only the final selected body is observed.

Diagnostics are off unless `onDebug` is provided. They never print prompt text, tool
schemas, credential values, project/account IDs, response text or cancellation reasons.
Hashing and response inspection run only when enabled. Response bytes and cancellation
still flow to the SDK; no cloned stream is drained in the background. A throwing debug
callback is ignored so logging cannot fail a model call. Hashes are comparison aids,
not encryption; treat collected logs as diagnostic data.

For cache-friendly calls, keep the large shared system instruction and tool definitions
stable and preserve their ordering; append conversation history and put changing context
late in the prompt. Google's public guidance recommends large common prefixes and
similar requests close together ([Gemini caching documentation](https://ai.google.dev/gemini-api/docs/caching)).
That guidance concerns the public Gemini API; Cloud Code's internal cache-affinity rules
are undocumented, and a matching fingerprint does not guarantee a cache hit.
`sessionId` remains an OpenCode Go option. Relay makes no Antigravity session-ID or
request-ID behavior change based on this investigation.

## `RelayModelDescriptor` fields

| Field | Type | Notes |
|---|---|---|
| `routeId` | `RelayRouteId` | `` `${providerId}::${modelId}` `` — pass this straight to `createRelayModel()`. |
| `providerId` | `string` | Stable provider slug (e.g. `openai-oauth`, `openrouter`). |
| `providerName` | `string` | Human-readable provider name for display. |
| `providerShortName` | `string` | Compact human-readable provider label for constrained UI; falls back to `providerName`. |
| `modelId` | `string` | Catalog id used to look the model up again in relay-ai. |
| `upstreamModelId` | `string` | The id actually sent to the upstream API (can differ from `modelId`). |
| `displayName` | `string` | Human-readable model name for display. |
| `authType` | `'api' \| 'oauth' \| 'none'` | How this provider authenticates. |
| `favorite` | `boolean` | Whether this model is in the user's relay-ai favorites. |
| `contextWindow` | `number \| undefined` | Max context tokens, when known. |
| `pricing` | `{ input, output, cacheRead?, cacheWrite? } \| undefined` | Per-token cost, when known. |
| `capabilities.tools` | `boolean \| 'unknown'` | **Always `'unknown'` today** — the underlying model cache carries no tools metadata, and Core deliberately never guesses from a model's name. Don't build a filter on `=== true`. |
| `capabilities.vision` | `boolean \| 'unknown'` | Same permanent-placeholder caveat as `tools`. |
| `capabilities.reasoning` | `'none' \| 'fixed' \| 'adjustable' \| 'unknown'` | Derived from real provider metadata: `none` = no reasoning, `fixed` = reasons but the level can't be set, `adjustable` = level is controllable. |
| `capabilities.reasoningLevels` | `RelayReasoningLevel[] \| undefined` | Present when `reasoning === 'adjustable'` — exactly the levels this route accepts (e.g. `['low','medium','high']`). Every entry is guaranteed to map to a real, distinct upstream request, and is directly assignable to `CreateRelayModelOptions.reasoning`. |
| `capabilities.defaultReasoningLevel` | `RelayReasoningLevel \| undefined` | Present when `reasoning === 'adjustable'` — the default level. |

## Route ids

`RelayRouteId` is the string type `` `${string}::${string}` `` — always `provider::model`, split on the **first** `::` only, so model ids containing `/` or `:` survive intact (e.g. `openrouter::vendor/model:free`).

```ts
toRelayRouteId('openai-oauth', 'gpt-5.6');                        // 'openai-oauth::gpt-5.6'
parseRelayRouteId('openrouter::vendor/model:free');
// { providerId: 'openrouter', modelId: 'vendor/model:free' }
parseRelayRouteId('gpt-5.6');                                     // throws INVALID_ROUTE_ID — no bare ids
```

Route ids are **unconditionally scoped** — never bare, even when a model id happens to be unique across all your providers right now. This matters if you persist a route id long-term (e.g. as a user's saved model choice): a scheme that only qualifies on collision would silently break a previously-saved bare id the day a second provider starts exposing the same model. `provider::model` is always stable.

## Error handling

Every error Core throws is a `RelayCoreError` — check with `isRelayCoreError(err)` rather than `instanceof`, since your app and relay-ai may load separate copies of the class. Errors carry only safe, structured metadata (`code`, `retryable`, optional `providerId`/`routeId`) and never a raw provider response, credential, or token — even `JSON.stringify(err)` / `err.message` are safe to log.

| Code | Meaning | `retryable` default |
|---|---|---|
| `INVALID_ROUTE_ID` | The route id isn't `provider::model` shaped, or the provider id fails validation. | `false` |
| `ROUTE_NOT_FOUND` | No provider is registered with that provider id. | `false` |
| `PROVIDER_DISABLED` | The provider exists but is disabled — enable it in `relay-ai ui`. | `false` |
| `UNSUPPORTED_MODEL` | The provider has no cached model with that model id, or the model has no usable SDK package — refresh its models in `relay-ai ui`. | `false` |
| `UNSUPPORTED_REASONING_LEVEL` | The `reasoning` level isn't a known level, or this route can't express it — check `capabilities.reasoningLevels` from `listRelayModels()`. | `false` |
| `CREDENTIAL_UNAVAILABLE` | No credential is available for this provider — (re)authenticate in `relay-ai ui`. | `false` |
| `OAUTH_REFRESH_FAILED` | An OAuth token exists but refreshing it failed — re-authenticate in `relay-ai ui`. | `true` |
| `UNSUPPORTED_REGISTRY_VERSION` | The registry file was written by a newer relay-ai than this Core version supports — upgrade relay-ai. | `false` |
| `PROVIDER_LOAD_FAILED` | An unexpected failure building the SDK model (network, malformed provider config, etc). | `true` |

## Runtime behavior

- **No server, no browser, no CLI output** — importing `@jacobbd/relay-ai/core` and calling its functions never launches anything.
- **No registry/preferences writes** — registry migrations stay in memory. Relay's existing credential machinery can persist an OAuth refresh; the consumer still never receives or stores credentials.
- **Always current** — `createRelayModel()` re-reads the registry and credentials on every call, so changes made through `relay-ai ui` while your app is running take effect immediately.
- **Schema compatibility** — Core supports registry schema v1. A registry written by a newer relay-ai fails fast with `UNSUPPORTED_REGISTRY_VERSION` instead of misreading it — upgrade relay-ai rather than downgrading the registry file.

## Verification status

Be precise about what has and hasn't been confirmed against live traffic:

- The Responses-Lite (Luna) incomplete-frame handling in 0.9.2 and 0.9.3 is verified against **realistic synthetic frame fixtures** driven through the real `createRelayModel()` + AI SDK `streamText()` path. Those fixtures reproduce the reported production symptom (a completed response with usage but no assistant text, or a tool call with empty arguments). The **exact production frame bytes were never captured**, and no live Luna canary has been run against these builds — so the fix is proven to correct the adapter's behavior on frames of that shape, not proven to be the exact production root cause.
- Cloud Code Assist concurrent-refresh and endpoint-failover behavior is verified against scripted transports, not live Google endpoints.
- **OpenAI reasoning levels come from OpenAI's model pages, not the bundled adapter.** The per-model profiles in `provider-factory.ts` were taken from `developers.openai.com` on 2026-08-14; the installed `@ai-sdk/openai` docs still describe `xhigh` as GPT-5.1-Codex-Max-only and are behind the API. They are keyed on the **exact** model id (a dated snapshot suffix is the only alias) because named descendants genuinely differ — `gpt-5.5-pro` drops `none`/`low` and defaults to `high`, and `gpt-5.2-chat-latest` does not reason at all. A model with no profile falls back to `low`/`medium`/`high`, which under-offers rather than sending a value the model may reject.
- Those sets are documentation-verified but **not traffic-verified** — a live call per level is the only proof the backend accepts them, and the ChatGPT OAuth / Responses-Lite backend in particular is a separate surface from the public API.
- **No result here generalizes across providers.** Luna, Cloud Code Assist, and every other OAuth provider are separate transports. "OAuth works" is never a conclusion you can draw from one of them passing.

## Troubleshooting

- **`listRelayModels()` returns an empty array.** No provider has been added yet, or every added provider is disabled. Run `relay-ai` or `relay-ai ui` and add/enable at least one provider.
- **`UNSUPPORTED_REGISTRY_VERSION`.** Your relay-ai install is older than whatever last wrote the registry (e.g. a newer CLI, or a shared registry file). Run `npm install -g @jacobbd/relay-ai@latest`.
- **`CREDENTIAL_UNAVAILABLE`.** The provider is enabled but its stored credential is missing or was removed from the OS keychain. Re-run `relay-ai ui` or `relay-ai providers auth <id>` to re-add it.
- **`OAUTH_REFRESH_FAILED`.** The refresh token itself was revoked or expired (common after a password change on the provider's side). Re-authenticate that provider from `relay-ai ui`.
- **`UNSUPPORTED_REASONING_LEVEL`.** Either the level string isn't a `RelayReasoningLevel`, or — much more often — it isn't in *this route's* `capabilities.reasoningLevels`. Gemini routes take `low`/`medium`/`high`; xAI chat takes `low`/`high` and xAI Responses adds `medium`; `xhigh` exists only on a short allowlist of OpenAI models. The error message lists the levels the route does accept. Read `capabilities.reasoningLevels` from `listRelayModels()`, or drop the `reasoning` option to use the provider's default.
- **Testing against a fixture registry instead of your real one.** Set `RELAY_AI_HOME` to a temp directory containing your own `providers.json` before importing Core.
