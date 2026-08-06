# ClinePass Dual Authentication Design

**Date:** 2026-08-06

**Status:** Approved design; implementation plan pending.

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

Relay will represent ClinePass as one provider ID, `cline-pass`, with two supported authentication methods. The provider template will gain an `authMethods` metadata field so a provider can advertise both `api` and `oauth` without creating duplicate registry entries. The registry still stores exactly one active credential for the provider; changing authentication mode replaces the active credential after confirmation.

Both methods use the same endpoint and model catalog:

- Base URL: `https://api.cline.bot/api/v1`
- Runtime protocol: OpenAI-compatible Chat Completions
- Model catalog: `GET /api/v1/ai/cline/recommended-models`
- Model IDs: preserve the full `cline-pass/...` slug

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
4. After WorkOS authorization, Relay sends the WorkOS access and refresh tokens to Cline's `/api/v1/auth/register` endpoint.
5. Relay stores the resulting Cline credential in the existing OAuth credential store, using the shared Cline storage identity so Cline and ClinePass can reuse one sign-in.
6. On use, Relay formats the access token with the `workos:` prefix and refreshes it through `/api/v1/auth/refresh` when needed.

The OAuth implementation will handle pending authorization, server-requested slow-down, expiry, denial, invalid grants, and transient refresh failures without logging token values.

### API key

1. User selects ClinePass API key in `relay-ai providers` or the web UI.
2. Relay accepts a key created in Cline Settings > API Keys.
3. Relay validates the key with an authenticated Cline API request before saving it.
4. Relay stores the key using the existing API-key credential path and caches the current dynamic model list.

API-key credentials remain raw Bearer tokens; they must not receive the OAuth-only `workos:` prefix.

## Model catalog

The existing generic `/v1/models` discovery path cannot be used because Cline's endpoint requires authentication and does not provide the public ClinePass catalog contract. Relay will add a dedicated `cline-recommended` model source and parser.

The parser will:

- Read the `clinePass` and `free` arrays.
- Preserve Cline's model IDs exactly.
- Deduplicate entries by ID.
- Assign Cline's subscription pricing classification.
- Apply explicit metadata when supplied and Relay's context-window fallback when it is not.
- Return the existing `CachedModel` shape so materialization, favorites, launchers, and server routes remain unchanged.

The catalog is fetched during API-key setup and during provider refresh. OAuth setup uses the same public catalog after credential registration.

## Runtime routing

ClinePass will use `@ai-sdk/openai-compatible` with the Cline base URL. The route will retain the provider ID and authentication type so the provider factory can apply Cline-specific behavior without affecting other OpenAI-compatible providers.

Relay will send Cline's documented optional identity headers where appropriate and preserve the existing user-agent/header forwarding path. The single-model `startProxy` path will be updated to carry static route headers consistently with catalog launches.

## User interface and CLI

The CLI provider menu will expose API-key setup and OAuth sign-in as separate actions for the same ClinePass provider. The web UI will render one ClinePass card with both options, reusing the existing API-key form and device-code polling components.

The API response for provider templates will include `authMethods`. Existing templates will default to their current single `authType`, so existing provider behavior and UI remain unchanged.

## Error handling

- Invalid API keys: reject during setup with the upstream status and a clear re-authentication hint.
- OAuth denial or expiry: show the WorkOS/Cline error without exposing token contents.
- Expired OAuth credentials: refresh automatically; if refresh is rejected, require sign-in again.
- ClinePass quota or subscription failures: preserve the upstream HTTP status and message through Relay's normal provider error path.
- Catalog failure: retain the previous cache when refreshing an already configured provider, but fail new setup if no model catalog can be obtained.

## Verification strategy

Automated tests will cover:

- Provider template listing and dual-auth metadata.
- Cline recommended-model payload parsing and deduplication.
- WorkOS device-code request, polling states, registration, and refresh response conversion.
- OAuth token prefixing versus raw API-key handling.
- Registry persistence and credential replacement.
- UI/API OAuth dispatch and template serialization.
- Static header propagation through both single-model and catalog proxy routes.

Live smoke testing will verify API-key setup, OAuth setup, streaming, tool calls, model switching, refresh after expiry, and invalid/subscription-limited responses. Live tests require a Cline account and an active ClinePass subscription for paid model calls.

## Non-goals and constraints

- Do not hard-code the model list from documentation.
- Do not duplicate ClinePass as separate API and OAuth provider IDs.
- Do not store OAuth access tokens with the `workos:` prefix; apply it only at runtime.
- Do not modify unrelated provider authentication flows.
- Do not add usage billing or subscription-management APIs.
