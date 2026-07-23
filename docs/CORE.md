# Embedding relay-ai (`@jacobbd/relay-ai/core`)

`@jacobbd/relay-ai/core` is a side-effect-free library surface that lets any Node.js application use relay-ai **in-process** — no CLI, no UI, no server, no child process. Two functions cover the whole surface:

1. **`listRelayModels()`** — a credential-free catalog of every model your enabled providers expose.
2. **`createRelayModel(routeId)`** — a ready [Vercel AI SDK](https://sdk.vercel.ai) `LanguageModel` for one of those models, with credentials (including OAuth refresh) resolved behind the scenes.

## What Core is — and isn't

Core is a **read/compose layer** over relay-ai's existing provider registry, credential resolution, and SDK adapter — it doesn't add new capabilities, it exposes existing ones as a library instead of a CLI.

- Relay AI keeps **sole ownership** of provider registration, credentials, the OS keyring, and OAuth login/refresh.
- Your application **never receives or stores** credential material — `createRelayModel()` resolves a credential internally and hands back only the finished SDK model.
- Re-authentication always happens through relay-ai (`relay-ai ui` or `relay-ai providers auth`), never through the consumer.
- Core never starts a server, opens a browser, prints CLI output, or writes to disk — importing it and calling its functions has no side effects beyond reading your existing config.

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
async function createRelayModel(routeId: RelayRouteId): Promise<LanguageModel>;
function toRelayRouteId(providerId: string, modelId: string): RelayRouteId;
function parseRelayRouteId(routeId: string): { providerId: string; modelId: string };
function isRelayCoreError(err: unknown): err is RelayCoreError;
class RelayCoreError extends Error { code, retryable, providerId?, routeId? }
```

### `listRelayModels()`

Returns one `RelayModelDescriptor` per cached model of every **enabled** provider. Fully credential-free — it never resolves an API key, refreshes an OAuth token, or calls a provider API. Results are sorted favorites-first, then by provider display name, then by model display name.

### `createRelayModel(routeId)`

Resolves the route to a provider + cached model, resolves the credential (transparently refreshing an expiring OpenAI or xAI OAuth token through relay-ai's existing refresh path if needed), and returns the exact `LanguageModel` relay-ai's own SDK adapter (`createLanguageModel()`) would produce.

**Nothing is cached across calls.** Every call re-reads the registry from disk and re-resolves the credential, so a provider you disable, re-authenticate, or add after your app started takes effect on the very next call — no restart needed.

## `RelayModelDescriptor` fields

| Field | Type | Notes |
|---|---|---|
| `routeId` | `RelayRouteId` | `` `${providerId}::${modelId}` `` — pass this straight to `createRelayModel()`. |
| `providerId` | `string` | Stable provider slug (e.g. `openai-oauth`, `openrouter`). |
| `providerName` | `string` | Human-readable provider name for display. |
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
| `capabilities.reasoningLevels` | `string[] \| undefined` | Present when `reasoning === 'adjustable'` — the valid levels for this model (e.g. `['low','medium','high']`). |
| `capabilities.defaultReasoningLevel` | `string \| undefined` | Present when `reasoning === 'adjustable'` — the default level. |

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
| `CREDENTIAL_UNAVAILABLE` | No credential is available for this provider — (re)authenticate in `relay-ai ui`. | `false` |
| `OAUTH_REFRESH_FAILED` | An OAuth token exists but refreshing it failed — re-authenticate in `relay-ai ui`. | `true` |
| `UNSUPPORTED_REGISTRY_VERSION` | The registry file was written by a newer relay-ai than this Core version supports — upgrade relay-ai. | `false` |
| `PROVIDER_LOAD_FAILED` | An unexpected failure building the SDK model (network, malformed provider config, etc). | `true` |

## Runtime behavior

- **No server, no browser, no CLI output** — importing `@jacobbd/relay-ai/core` and calling its functions never launches anything.
- **No disk writes** — even when the on-disk registry needs an internal format migration, Core performs it in memory only and never persists the result (unlike relay-ai's own CLI, which does persist migrations).
- **Always current** — `createRelayModel()` re-reads the registry and credentials on every call, so changes made through `relay-ai ui` while your app is running take effect immediately.
- **Schema compatibility** — Core supports registry schema v1. A registry written by a newer relay-ai fails fast with `UNSUPPORTED_REGISTRY_VERSION` instead of misreading it — upgrade relay-ai rather than downgrading the registry file.

## Troubleshooting

- **`listRelayModels()` returns an empty array.** No provider has been added yet, or every added provider is disabled. Run `relay-ai` or `relay-ai ui` and add/enable at least one provider.
- **`UNSUPPORTED_REGISTRY_VERSION`.** Your relay-ai install is older than whatever last wrote the registry (e.g. a newer CLI, or a shared registry file). Run `npm install -g @jacobbd/relay-ai@latest`.
- **`CREDENTIAL_UNAVAILABLE`.** The provider is enabled but its stored credential is missing or was removed from the OS keychain. Re-run `relay-ai ui` or `relay-ai providers auth <id>` to re-add it.
- **`OAUTH_REFRESH_FAILED`.** The refresh token itself was revoked or expired (common after a password change on the provider's side). Re-authenticate that provider from `relay-ai ui`.
- **Testing against a fixture registry instead of your real one.** Set `RELAY_AI_HOME` to a temp directory containing your own `providers.json` before importing Core.
