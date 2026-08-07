# ClinePass Dual Authentication Design

**Date:** 2026-08-06

**Status:** Approved and amended after adversarial review; implementation in progress.

## Goal

Add ClinePass as a first-class Relay AI provider with both OAuth sign-in and API-key authentication, dynamic model discovery, automatic OAuth refresh, and routing through the existing OpenAI-compatible proxy.

## Scope

The first release includes:

- ClinePass OAuth using Cline's WorkOS device-code flow.
- ClinePass API-key setup from the CLI and web UI.
- Dynamic model discovery from Cline's public recommended-model catalog.
- Streaming, tool calls, and model switching through Relay's existing SDK adapter.
- Credential refresh, credential replacement, and actionable authentication errors.
- Unit tests, live smoke-test instructions, and provider documentation.

The first release does not include usage-meter dashboards, subscription management, or quota visualization. ClinePass usage limits remain enforced by Cline and are surfaced as upstream errors.

## Architecture

Relay will represent ClinePass as one provider ID, `cline-pass`, with two supported authentication methods. The provider template will gain an `authMethods` metadata field so a provider can advertise both `api` and `oauth` without creating duplicate registry entries. The registry still stores exactly one active credential for the provider. ClinePass credentials use isolated storage identities (`keyring:provider:cline-pass` for API keys and `keyring:oauth:provider:cline-pass` for OAuth); Relay does not share storage with a hypothetical `cline` provider. Changing authentication mode replaces the active credential only after the new credential succeeds, then deletes the superseded secret.

Both methods use the same endpoint and model catalog:

- SDK runtime base URL: `https://api.cline.bot/api/v1` (used only for chat completions)
- Runtime protocol: OpenAI-compatible Chat Completions
- Public model catalog: `GET https://api.cline.bot/api/v1/ai/cline/recommended-models`
- Authenticated credential validation: `GET https://api.cline.bot/api/v1/users/me`
- OAuth registration: `POST https://api.cline.bot/api/v1/auth/register`
- OAuth refresh: `POST https://api.cline.bot/api/v1/auth/refresh`
- Model IDs: preserve the full `cline-pass/...` slug in both Relay and upstream request bodies, as required by Cline's API documentation.

Cline's API documentation states that API keys and account auth tokens both use Bearer authentication. Cline's own implementation uses a WorkOS device flow for account sign-in, registers the resulting WorkOS tokens with Cline, refreshes them through Cline, and formats the runtime OAuth credential as `workos:<access-token>`.

Sources:

- https://docs.cline.bot/getting-started/clinepass
- https://docs.cline.bot/api/authentication
- https://github.com/cline/cline/blob/main/sdk/packages/core/src/auth/cline.ts
- https://github.com/cline/cline/blob/main/sdk/packages/core/src/auth/provider-auth-registry.ts
- https://github.com/cline/cline/blob/main/sdk/packages/llms/src/catalog/catalog-cline-recommended.ts

## Authentication flows

### OAuth

1. User selects ClinePass OAuth in `relay-ai providers` or the web UI.
2. Relay requests a WorkOS device code using Cline's production client ID.
3. Relay displays the verification URL and user code, then polls WorkOS with the documented interval handling.
4. After WorkOS authorization, Relay sends the WorkOS access and refresh tokens to `https://api.cline.bot/api/v1/auth/register`.
5. Relay stores the resulting Cline credential under `keyring:oauth:provider:cline-pass`.
6. On use, Relay keeps the stored access token raw, formats it with the `workos:` prefix exactly once at the Cline transport boundary, and refreshes it through `https://api.cline.bot/api/v1/auth/refresh` when needed.

The OAuth implementation will handle pending authorization, server-requested slow-down, expiry, denial, invalid grants, and transient refresh failures without logging token values.

### API key

1. User selects ClinePass API key in `relay-ai providers` or the web UI.
2. Relay accepts a key created in Cline Settings > API Keys.
3. Relay validates the key with authenticated `GET https://api.cline.bot/api/v1/users/me` before saving it.
4. Relay stores the key using the existing API-key credential path and caches the current dynamic model list.

API-key credentials remain raw Bearer tokens; they must not receive the OAuth-only `workos:` prefix.

## Model catalog

The existing generic `/v1/models` discovery path is not the ClinePass catalog. Relay validates API keys through the authenticated account endpoint and uses a dedicated `cline-recommended` model source and parser for the public catalog. The catalog and validation URL builders use explicit full URLs so the SDK runtime base cannot accidentally produce `/api/v1/api/v1` paths.

The parser will:

- Read only the `clinePass` and `free` arrays; never expose the `recommended` array through ClinePass.
- Preserve Cline's full model IDs exactly, including `cline-pass/` prefixes and `:free` suffixes.
- Deduplicate entries by ID, with `clinePass` winning over a duplicate `free` entry.
- Mark `free` entries as free and assign subscription pricing to ClinePass entries.
- Enrich capabilities through Relay's existing model metadata lookup when possible; otherwise use a 128K context-window default and tolerate `description`/`tags` fields without depending on them.
- Return the existing `CachedModel` shape so materialization, favorites, launchers, and server routes remain unchanged.

The catalog is fetched during API-key setup and during provider refresh. OAuth setup uses the same public catalog after credential registration.

## Runtime routing

ClinePass will use `@ai-sdk/openai-compatible` with the Cline SDK runtime base URL. The route will retain the provider ID and authentication type so the provider factory can apply Cline-specific behavior without affecting other OpenAI-compatible providers.

Relay will send Cline's documented optional identity headers where appropriate and preserve the existing user-agent/header forwarding path. Template headers will be persisted for API-key entries, and the single-model `startProxy` path will carry static route headers consistently with catalog launches.

The helper `formatClineRuntimeCredential(providerId, authType, key)` will be idempotent and will add `workos:` only for `providerId === 'cline-pass' && authType === 'oauth'`. It will be used by the Cline SDK transport and any authenticated Cline validation request; stored OAuth values and refresh-token requests remain raw.

SDK-routed ClinePass requests will have a single 401 retry. The retry calls the route's refresh callback, formats the newly returned raw token, retries with the new Bearer token, and updates the route's current token. A missing, unchanged, or failed refresh result will not retry again or loop indefinitely. This behavior covers proxy catalog, single-model proxy, server, and other registry-backed SDK routes that use the shared provider factory.

## User interface and CLI

The CLI provider menu will expose API-key setup and OAuth sign-in as separate actions for the same ClinePass provider. The web UI will render one ClinePass card with both options, reusing the existing API-key form and device-code polling components.

The API response for provider templates will include `authMethods`. Existing templates will default to their current single `authType`, so existing provider behavior and UI remain unchanged. ClinePass must be added explicitly to every OAuth dispatch table; it must never fall through to the OpenAI device-code flow.

When changing ClinePass authentication mode, the new credential is validated/saved first, the registry entry's `authType` and `authRef` are updated, the existing model cache is retained, and the old keyring secret is deleted only after the new entry is durable.

## Error handling

- Invalid API keys: reject during setup when authenticated `/api/v1/models` returns 401/403, with a clear re-authentication hint.
- OAuth denial or expiry: show the WorkOS/Cline error without exposing token contents.
- Expired OAuth credentials: refresh automatically; if refresh is rejected, require sign-in again.
- ClinePass quota or subscription failures: preserve the upstream HTTP status and message through Relay's normal provider error path.
- Catalog failure: retain the previous cache when refreshing an already configured provider, but fail new setup if no model catalog can be obtained. Do not add a hard-coded fallback list that can expose stale or usage-billed models.

## Verification strategy

Automated tests will cover:

- Provider template listing and dual-auth metadata.
- Cline recommended-model payload parsing and deduplication.
- Exact URL construction for catalog, validation, registration, and refresh endpoints.
- WorkOS device-code request, polling states, registration, and refresh response conversion.
- OAuth token prefixing versus raw API-key handling.
- Registry persistence and credential replacement.
- UI/API OAuth dispatch and template serialization.
- Static header propagation through both single-model and catalog proxy routes.
- SDK-path 401 refresh with one retry and no infinite loop.

Live smoke testing will verify API-key setup, OAuth setup, streaming, tool calls, model switching, refresh after expiry, and invalid/subscription-limited responses. Live tests require a Cline account and an active ClinePass subscription for paid model calls.

## Non-goals and constraints

- Do not hard-code the model list from documentation.
- Do not duplicate ClinePass as separate API and OAuth provider IDs.
- Do not store OAuth access tokens with the `workos:` prefix; apply it only at runtime.
- Do not modify unrelated provider authentication flows.
- Do not add usage billing or subscription-management APIs.
