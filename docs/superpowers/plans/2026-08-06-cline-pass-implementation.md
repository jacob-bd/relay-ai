# ClinePass Dual Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ClinePass to Relay AI with API-key authentication, WorkOS OAuth, dynamic model discovery, automatic credential refresh, and routing across Relay's registry-backed launch surfaces.

**Architecture:** Keep one registry provider ID, `cline-pass`, and add additive `authMethods` metadata so the same provider can be configured by API key or OAuth. Store API and OAuth credentials under isolated keyring accounts, keep OAuth tokens raw at rest, and apply the `workos:` prefix only at the Cline transport boundary. Use Cline's public recommended-model endpoint for catalog data and authenticated `/api/v1/models` only for API-key validation.

**Tech Stack:** TypeScript, Node.js `fetch`, Vitest, Vercel AI SDK `@ai-sdk/openai-compatible`, existing Relay provider registry, keyring abstraction, CLI prompts, and web UI API.

## Global Constraints

- Work directly on `main`, as explicitly requested by Jacob.
- Provider ID is exactly `cline-pass`; do not create separate API and OAuth provider IDs.
- SDK runtime base URL is `https://api.cline.bot/api/v1` and is used only for chat completions.
- Catalog URL is `https://api.cline.bot/api/v1/ai/cline/recommended-models`.
- API-key validation URL is `https://api.cline.bot/api/v1/models`.
- OAuth registration URL is `https://api.cline.bot/api/v1/auth/register`.
- OAuth refresh URL is `https://api.cline.bot/api/v1/auth/refresh`.
- Preserve full Cline model IDs, including `cline-pass/` prefixes and `:free` suffixes, in outbound request bodies.
- Read only the `clinePass` and `free` catalog arrays; never expose `recommended` models as ClinePass models.
- Store raw OAuth access tokens; apply `workos:` exactly once only for ClinePass OAuth transport requests.
- Implement one mid-session SDK 401 refresh retry; never retry indefinitely or retry when the refreshed token is missing or unchanged.
- Preserve existing provider behavior and existing test expectations.
- Do not add a static model fallback that can expose stale or usage-billed models.

---

### Task 1: Add ClinePass contracts, URL helpers, and dynamic catalog parsing

**Files:**
- Create: `src/cline-pass.ts`
- Create: `src/registry/fetch-cline-pass-models.ts`
- Modify: `src/provider-templates.ts`
- Modify: `src/registry/model-source.ts`
- Test: `tests/cline-pass-models.test.ts`
- Test: `tests/provider-templates.test.ts`

**Interfaces:**
- `src/cline-pass.ts` exports `CLINE_PASS_HOST`, `CLINE_PASS_SDK_BASE_URL`, `CLINE_PASS_CATALOG_URL`, `CLINE_PASS_VALIDATION_URL`, `CLINE_PASS_REGISTER_URL`, and `CLINE_PASS_REFRESH_URL`.
- `src/registry/fetch-cline-pass-models.ts` exports `fetchClinePassModels(): Promise<CachedModel[]>`, `validateClinePassApiKey(apiKey: string): Promise<void>`, and `parseClinePassModels(payload: unknown): CachedModel[]`.
- Extend `ProviderModelSource` with `'cline-recommended'`.
- Extend `ProviderTemplate` with `authMethods?: ProviderAuthType[]`; templates without it behave as `[authType]`.

- [ ] **Step 1: Write failing URL and parser tests.**

Use a fixture containing `clinePass`, `free`, `recommended`, `tags`, and a `poolside/...:free` ID. Assert exact endpoint constants, exclusion of `recommended`, deduplication with `clinePass` winning, full IDs preserved as both `id` and `upstreamModelId`, free status, and a 128K fallback context window.

- [ ] **Step 2: Run the focused tests and verify the expected failures.**

Run: `npx vitest run tests/cline-pass-models.test.ts tests/provider-templates.test.ts`

Expected: FAIL because the ClinePass constants, parser, model source, and template metadata do not exist.

- [ ] **Step 3: Implement the URL constants and parser.**

Build all four authenticated/public URLs from `CLINE_PASS_HOST`, not from the SDK base URL. Parse only `clinePass` and `free`; use `resolveContextWindow` when no richer metadata is available; classify free entries through the existing free-model helpers.

- [ ] **Step 4: Add the hybrid provider template.**

Add `cline-pass` with `authType: 'api'`, `authMethods: ['api', 'oauth']`, `npm: '@ai-sdk/openai-compatible'`, `defaultBaseUrl: CLINE_PASS_SDK_BASE_URL`, `modelSource: 'cline-recommended'`, and the official Cline API/settings URL. Update `listSupportedTemplates`, `listAddableTemplates`, and `listVisibleOAuthTemplates` to use `authMethods` while preserving old-template behavior.

- [ ] **Step 5: Run the focused tests and commit.**

Run: `npx vitest run tests/cline-pass-models.test.ts tests/provider-templates.test.ts`

Expected: PASS. Commit: `git add src/cline-pass.ts src/registry/fetch-cline-pass-models.ts src/provider-templates.ts src/registry/model-source.ts tests/cline-pass-models.test.ts tests/provider-templates.test.ts && git commit -m "feat: add ClinePass catalog contract"`

### Task 2: Implement ClinePass WorkOS OAuth and refresh conversion

**Files:**
- Create: `src/oauth/cline-pass.ts`
- Modify: `src/oauth/types.ts`
- Modify: `src/oauth/refresh.ts`
- Test: `tests/oauth-cline-pass.test.ts`
- Test: `tests/oauth.test.ts`

**Interfaces:**
- `requestClinePassDeviceCode(): Promise<ClinePassDeviceCode>`
- `runClinePassDeviceCodeFlow(onDeviceCode): Promise<ClinePassOAuthResult>`
- `refreshClinePassAccessToken(refreshToken: string): Promise<OAuthTokenResponse>`
- `ClinePassOAuthResult` contains `tokens: OAuthTokenResponse`, optional `accountId`, and `providerData`.

- [ ] **Step 1: Write failing protocol tests.**

Test WorkOS device-code request, `authorization_pending`, `slow_down` interval increase, success, denial, expiry, timeout, Cline registration response conversion, malformed `expiresAt`, refresh responses with and without a replacement refresh token, and non-2xx/`success: false` responses.

- [ ] **Step 2: Run the focused OAuth tests and verify they fail for missing implementation.**

Run: `npx vitest run tests/oauth-cline-pass.test.ts`

Expected: FAIL because the module and functions do not exist.

- [ ] **Step 3: Implement the WorkOS device flow.**

Use Cline's production WorkOS client ID and `https://api.workos.com/user_management/authorize/device` plus `/user_management/authenticate`. Honor the server interval and add one second on `slow_down`; never log device or token values.

- [ ] **Step 4: Implement Cline registration and refresh.**

POST WorkOS tokens to Cline's register endpoint, convert ISO `expiresAt` to `expires_in`, retain `userInfo.clineUserId` as `accountId`, preserve the previous refresh token when refresh omits one, and preserve transient-failure behavior so valid stored credentials are not wiped.

- [ ] **Step 5: Register the provider in OAuth refresh dispatch.**

Add `cline-pass` to `NATIVE_OAUTH_PROVIDER_IDS` and route it explicitly in `refreshStoredOAuthCredential`. Do not add a generic fallback that can send new providers through OpenAI's refresh flow.

- [ ] **Step 6: Run OAuth tests and commit.**

Run: `npx vitest run tests/oauth-cline-pass.test.ts tests/oauth.test.ts tests/refresh-credentials.test.ts`

Expected: PASS. Commit: `git add src/oauth/cline-pass.ts src/oauth/types.ts src/oauth/refresh.ts tests/oauth-cline-pass.test.ts tests/oauth.test.ts && git commit -m "feat: add ClinePass OAuth flow"`

### Task 3: Integrate registry setup, validation, replacement, and refresh

**Files:**
- Modify: `src/registry/add-template.ts`
- Modify: `src/registry/provider-auth.ts`
- Modify: `src/registry/refresh-models.ts`
- Modify: `src/registry/crud.ts`
- Modify: `src/registry/import-build.ts`
- Test: `tests/registry-add-template.test.ts`
- Test: `tests/provider-auth.test.ts`
- Test: `tests/registry-refresh-models.test.ts`

**Interfaces:**
- API-key setup for `cline-pass` calls `validateClinePassApiKey` before saving, then `fetchClinePassModels` for cache population.
- OAuth setup stores under `oauthAuthRef('cline-pass')` and preserves the existing cache while replacing `authType` and `authRef`.

- [ ] **Step 1: Write failing registry tests.**

Cover API-key 401 rejection, successful ClinePass API-key setup, template-header persistence, API→OAuth replacement, OAuth→API replacement, old-secret deletion after new credential durability, and model-cache preservation.

- [ ] **Step 2: Run focused registry tests and verify red.**

Run: `npx vitest run tests/registry-add-template.test.ts tests/provider-auth.test.ts tests/registry-refresh-models.test.ts`

Expected: FAIL on missing ClinePass-specific setup, refresh, and replacement behavior.

- [ ] **Step 3: Add the ClinePass API-key setup path.**

Special-case `modelSource === 'cline-recommended'`: validate the key against authenticated `/api/v1/models`, fetch the public ClinePass catalog, persist `template.headers` into `provider.api.headers`, and save under `keyring:provider:cline-pass`.

- [ ] **Step 4: Add explicit ClinePass OAuth setup.**

Add a `cline-pass` branch to `runNativeDeviceCode`, `PROVIDER_DISPLAY`, `saveNativeOAuthCredential`, and `upsertOAuthProvider`. The OAuth path must not fall through to OpenAI. Store under `keyring:oauth:provider:cline-pass`.

- [ ] **Step 5: Implement safe credential replacement.**

When switching modes, save and verify the new secret/registry entry first, then delete the old `authRef`. Keep the existing models cache. Wire the existing `replaceExisting` option only for the ClinePass mode-switch path.

- [ ] **Step 6: Add ClinePass model refresh.**

Route `refreshProviderModels` for `modelSource === 'cline-recommended'` through the public catalog regardless of auth mode. On refresh failure, retain an existing cache; on initial setup, fail without a catalog.

- [ ] **Step 7: Run focused tests and commit.**

Run: `npx vitest run tests/registry-add-template.test.ts tests/provider-auth.test.ts tests/registry-refresh-models.test.ts`

Expected: PASS. Commit: `git add src/registry/add-template.ts src/registry/provider-auth.ts src/registry/refresh-models.ts src/registry/crud.ts src/registry/import-build.ts tests/registry-add-template.test.ts tests/provider-auth.test.ts tests/registry-refresh-models.test.ts && git commit -m "feat: register ClinePass credentials"`

### Task 4: Add runtime credential formatting and SDK 401 retry

**Files:**
- Modify: `src/cline-pass.ts`
- Modify: `src/provider-factory.ts`
- Modify: `src/proxy.ts`
- Modify: `src/upstream-forward.ts`
- Test: `tests/provider-factory.test.ts`
- Test: `tests/proxy.test.ts`
- Test: `tests/upstream-forward.test.ts`

**Interfaces:**
- `formatClineRuntimeCredential(providerId: string | undefined, authType: 'api' | 'oauth' | 'none' | undefined, key: string): string` is idempotent and prefixes only ClinePass OAuth credentials.
- `ProviderModelSpec` gains optional `refreshToken?: () => Promise<string | null>` and `onTokenRefreshed?: (token: string) => void`.

- [ ] **Step 1: Write failing formatting and retry tests.**

Assert raw OAuth → `workos:raw`, already-prefixed OAuth remains unchanged, API keys remain raw, and one mocked SDK fetch 401 calls refresh once then retries with the new formatted token. Assert unchanged/failed refresh returns the original 401 without looping.

- [ ] **Step 2: Run focused tests and verify red.**

Run: `npx vitest run tests/provider-factory.test.ts tests/proxy.test.ts tests/upstream-forward.test.ts`

Expected: FAIL because ClinePass formatting and SDK retry are not wired.

- [ ] **Step 3: Implement the idempotent token helper.**

Keep stored OAuth JSON raw and use the helper only when creating Cline SDK providers or authenticated Cline validation requests.

- [ ] **Step 4: Implement the SDK fetch wrapper.**

Pass a custom `fetch` to `createOpenAICompatible` for ClinePass OAuth. On the first 401, call `refreshToken`, replace only the Authorization header, retry once, and invoke `onTokenRefreshed` with the raw replacement token. Leave all non-Cline providers unchanged.

- [ ] **Step 5: Wire proxy route callbacks.**

Pass `route.refreshToken`, `route.headers`, and `route.onTokenRefreshed` through the SDK path. Add `headers` to the single-model `startProxy` SDK options and update the route token after refresh.

- [ ] **Step 6: Run focused tests and commit.**

Run: `npx vitest run tests/provider-factory.test.ts tests/proxy.test.ts tests/upstream-forward.test.ts`

Expected: PASS. Commit: `git add src/cline-pass.ts src/provider-factory.ts src/proxy.ts src/upstream-forward.ts tests/provider-factory.test.ts tests/proxy.test.ts tests/upstream-forward.test.ts && git commit -m "feat: refresh ClinePass SDK sessions"`

### Task 5: Propagate OAuth refresh callbacks and headers through launch surfaces

**Files:**
- Modify: `src/types.ts`
- Modify: `src/registry/materialize.ts`
- Modify: `src/catalog.ts`
- Modify: `src/cli.ts`
- Modify: `src/gemini.ts`
- Modify: `src/codex.ts`
- Modify: `src/codex-proxy.ts`
- Modify: `src/server/router.ts`
- Test: `tests/catalog.test.ts`
- Test: `tests/codex-proxy.test.ts`
- Test: `tests/server-router.test.ts`

**Interfaces:**
- `LocalProvider` carries `authRef?: string` so route builders can resolve a fresh credential.
- Registry-backed SDK routes use `() => resolveProviderCredential(providerId, oauthAuthRef(providerId))` for OAuth providers.

- [ ] **Step 1: Write failing route propagation tests.**

Assert materialized providers retain `authRef`, catalog routes carry headers and a refresh callback, single-model launches pass headers, server SDK models receive the callback, and Codex proxy routes can refresh once.

- [ ] **Step 2: Run focused tests and verify red.**

Run: `npx vitest run tests/catalog.test.ts tests/codex-proxy.test.ts tests/server-router.test.ts`

Expected: FAIL on missing `authRef` propagation and SDK callback wiring.

- [ ] **Step 3: Carry `authRef` through materialization.**

Add the non-secret `authRef` to `LocalProvider` and preserve it from the registry.

- [ ] **Step 4: Add callbacks to route construction.**

Update `localModelToRoute`, CLI single-model routing, Gemini route construction, Codex route construction, and server model initialization to pass headers and OAuth refresh callbacks.

- [ ] **Step 5: Extend Codex proxy model creation.**

Pass the callback into `createLanguageModel` when building the cached model. The custom fetch wrapper must resolve fresh credentials on a 401 without rebuilding unrelated routes.

- [ ] **Step 6: Run focused tests and commit.**

Run: `npx vitest run tests/catalog.test.ts tests/codex-proxy.test.ts tests/server-router.test.ts`

Expected: PASS. Commit: `git add src/types.ts src/registry/materialize.ts src/catalog.ts src/cli.ts src/gemini.ts src/codex.ts src/codex-proxy.ts src/server/router.ts tests/catalog.test.ts tests/codex-proxy.test.ts tests/server-router.test.ts && git commit -m "feat: propagate ClinePass runtime refresh"`

### Task 6: Expose both authentication methods in CLI and web UI

**Files:**
- Modify: `src/providers-command.ts`
- Modify: `src/ui/api.ts`
- Modify: `src/ui/public/app.js`
- Test: `tests/providers-command.test.ts`
- Test: `tests/ui-api-oauth.test.ts`
- Test: `tests/ui-api-models.test.ts`

- [ ] **Step 1: Write failing CLI/UI tests.**

Assert ClinePass appears in API and OAuth template metadata, `providers auth cline-pass` uses the Cline flow, UI OAuth start accepts ClinePass, and configured ClinePass remains visible with a way to switch authentication mode.

- [ ] **Step 2: Run focused tests and verify red.**

Run: `npx vitest run tests/providers-command.test.ts tests/ui-api-oauth.test.ts tests/ui-api-models.test.ts`

Expected: FAIL because ClinePass is not in the dispatch tables and template serialization does not expose dual auth.

- [ ] **Step 3: Update CLI auth menus and help.**

Add ClinePass to provider display/help text, derive the OAuth hint from visible templates where practical, and keep the explicit native branch.

- [ ] **Step 4: Update UI API routes.**

Return `authMethods`, include ClinePass in device-code allowlists, add its OAuth start branch, and expose provider replacement actions without exposing credential values.

- [ ] **Step 5: Update the web UI.**

Render one ClinePass card with API-key and OAuth options. Reuse existing device-code polling and API-key setup components; show a confirmation before replacing the active credential.

- [ ] **Step 6: Run focused tests and commit.**

Run: `npx vitest run tests/providers-command.test.ts tests/ui-api-oauth.test.ts tests/ui-api-models.test.ts`

Expected: PASS. Commit: `git add src/providers-command.ts src/ui/api.ts src/ui/public/app.js tests/providers-command.test.ts tests/ui-api-oauth.test.ts tests/ui-api-models.test.ts && git commit -m "feat: expose ClinePass authentication choices"`

### Task 7: Update project documentation and run full verification

**Files:**
- Modify: `AGENTS.md`
- Create: `docs/CLINEPASS.md`
- Modify: `README.md` if provider documentation is linked there
- Test: `tests/cli.test.ts`

- [ ] **Step 1: Add documentation tests for help and endpoint contracts.**

Assert CLI help names ClinePass OAuth and API-key setup and that the documented endpoint constants remain exact.

- [ ] **Step 2: Document setup and operational behavior.**

Document both setup commands, web UI setup, subscription/API-key prerequisites, dynamic catalog behavior, credential storage, refresh behavior, and quota/error expectations. Update `AGENTS.md` architecture notes for the new model source, OAuth module, authMethods metadata, and runtime prefix seam.

- [ ] **Step 3: Run targeted verification.**

Run: `npm run typecheck`, `npm run build`, and the complete targeted test set from Tasks 1–6.

Expected: typecheck and build succeed; all targeted tests pass.

- [ ] **Step 4: Run the complete repository suite.**

Run: `npm test`

Expected: all existing and new tests pass with no failures.

- [ ] **Step 5: Perform live read-only catalog and validation checks.**

Confirm the public catalog returns only parsed ClinePass/free models and that an invalid API key is rejected by authenticated `/api/v1/models`. Do not print or persist any live credential.

- [ ] **Step 6: Commit documentation and final verification.**

Run: `git diff --check && git status --short --branch`

Commit: `git add -f AGENTS.md docs/CLINEPASS.md README.md tests/cli.test.ts && git commit -m "docs: document ClinePass support"`

Expected: clean working tree except for intentional user changes, with the full test and build results recorded in the final handoff.
