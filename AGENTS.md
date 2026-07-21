# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository. Note that the codebase supports Claude Code, OpenAI Codex, and Google Gemini CLI.

**Docker / always-on gateway:** If a user asks to run Relay AI in a container, follow **[docs/DOCKER.md](docs/DOCKER.md)** (AI checklist + questions). That deploys Server + Admin UI only — not desktop app launch.

## Commands

```bash
npm run build       # compile TypeScript → dist/cli.js (via tsup, ESM, shebang injected)
npm test            # run all tests with vitest
npm run typecheck   # type-check without emitting (tsc --noEmit)
npm run dev         # watch mode build

# Run a single test file
npx vitest run tests/env.test.ts
npx vitest run tests/models.test.ts

# Test the CLI locally (already npm-linked)
relay-ai --help
relay-ai models          # manage favorite models for mid-session switching
relay-ai Codex --dry-run   # simulate full first-run without writing anything
relay-ai Codex --setup    # re-ask subscription tier
relay-ai Codex --trace    # write debug log to /tmp/relay-ai-debug.log and print errors on exit
relay-ai server           # foreground OpenCode/registry API gateway
relay-ai server --vertex  # foreground Vertex AI gateway (gcloud ADC)
relay-ai codex            # Codex CLI with registry providers (see docs/CODEX.md)
relay-ai codex-app        # Codex desktop app (macOS/Windows; see docs/CODEX.md)
relay-ai gemini           # Gemini CLI with registry providers (see docs/GEMINI.md)

# Rebuild after code changes before testing manually
npm run build && relay-ai --version
```

## Architecture

**Entry point:** `src/cli.ts` orchestrates the full flow. Every other module is a focused unit with no side effects at import time.

**Data flow (`relay-ai Codex`):**
```
cli.ts
  → findClaudeBinary()         [launch.ts — locate Codex binary]
  → fetchLocalProviders()      [providers.ts — ephemeral opencode serve, GET /config/providers, normalize]
  → p.select "Which provider?" [shown when local providers are available]

  ── OpenCode cloud path (default) ──
  → resolveOrCollectApiKey()   [reads env, OS credential store (all platforms), or prompts user]
  → askSubscriptionTier()      [prompts.ts — one-time question, saved to conf store]
  → getModels()                [models.ts — API fetch + cache enrichment + format classification]
  → runWizard()                [prompts.ts — backend/model selector, filters unsupported]

  ── Local provider path ──
  → pickLocalModel()           [prompts.ts — filter/select model from local provider]

  ── Shared launch (no favorites) ──
  → startProxy()               [proxy.ts — single-model wrapper around startProxyCatalog]
  → buildChildEnv(baseUrl, …)  [env.ts — removes 17 conflicting vars, sets OpenCode vars]
  → launchClaude()             [launch.ts — spawn with stdio:inherit]
  → proxyHandle.close()        [stops proxy after Codex exits]

  ── Switch-menu launch (favorites.length > 0) ──
  → buildCatalogRoutes()       [catalog.ts — starting model + favorites, max 20]
  → startProxyCatalog()        [proxy.ts — multi-route proxy, alias IDs per model]
  → buildChildEnv(…, gatewayDiscovery=true)  [sets CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1]
  → launchClaudeViaCatalog()   [cli.ts — shared launch + trace cleanup]
```

**`relay-ai models`:** Interactive favorites manager (`src/favorites.ts`). Reads/writes `favoriteModels` in config. Saves once on Done. Stale favorites (unavailable models) are silently skipped when building the catalog.

**Catalog routing** (`src/catalog.ts`): `localModelToRoute`, `zenGoModelToRoute`, `makeRouteResolver`, `buildCatalogRoutes`. Routes built only for starting model + favorites — not the full model list. Alias IDs via `aliasModelId()` in proxy so Codex sees unique model names in `/model`.

**Critical URL constraint:** `BACKENDS.baseUrl` in `constants.ts` must NOT include `/v1`. The Anthropic SDK appends `/v1/messages` automatically. Setting it to `https://opencode.ai/zen/v1` would cause requests to hit `/zen/v1/v1/messages` → 404.

**Model discovery two-source merge:**
- Primary: `GET {backendUrl}/v1/models` (no auth needed, returns available IDs)
- Enrichment: `~/.cache/opencode/models.json` (written by OpenCode CLI) — provides `name`, `family`, `cost`, `provider.npm`
- `isAnthropicNative`: true when `modelFormat === 'anthropic'`
- `modelFormat`: classified from `provider.npm` in cache, or by ID-prefix heuristic:
  - `@ai-sdk/anthropic` or `Codex-*` → `'anthropic'` (direct passthrough)
  - `@ai-sdk/openai` or `gpt-*` → `'unsupported'` in the **cloud OpenCode wizard** (OpenCode Zen/Go proxy layer; not direct OpenAI). Use the **local OpenAI provider** instead for GPT models.
  - `@ai-sdk/google` or `gemini-*` → `'unsupported'` (needs model-specific endpoints)
  - Everything else → `'openai'` (routed through the SDK adapter via the local proxy)
- `sourceBackend`: set from the backend that was queried — critical for `go` tier which shows Zen free models + Go paid models in one list, so the correct `ANTHROPIC_BASE_URL` can be set per selected model

**Translation layer — the Vercel AI SDK adapter** (`src/sdk-adapter.ts` + `src/provider-factory.ts`): All non-Anthropic providers route through the Vercel AI SDK (`ai` + `@ai-sdk/*`, the same packages OpenCode loads), which owns wire format, endpoint selection, and provider quirks. This is the **single** translation path — there is no hand-rolled per-provider translation.

- **`provider-factory.ts`** — `createLanguageModel({ npm, modelId, apiKey, baseURL })` (async) maps whatever `api.npm` OpenCode assigns to an SDK `LanguageModel` via dynamic `import(npm)` + `create*` factory discovery. Special branches for OpenAI/xAI Responses API selection and openai-compatible/openrouter base URLs. `isSdkMigratedNpm(npm)` is true for any npm except `@ai-sdk/anthropic`. `modelPrefersResponsesApi(modelId)` selects `provider.responses(id)` over `provider.chat(id)` for OpenAI/xAI models that require the Responses API (GPT-5.4+, GPT-5.5, `*-codex`, o-series, xAI `*-multi-agent`). OpenCode's bundled SDK provider packages ship as npm `dependencies` (externalized in tsup, loaded on demand).
- **`sdk-adapter.ts`** — Anthropic `/v1/messages` ↔ SDK, one turn per request (Codex owns the tool loop). `translateRequest(body, npm)` builds the SDK call params (messages, tools, tool_choice, system) and folds inline `role:'system'` messages — Codex injects the skills list / system-reminders this way — into the system prompt so they aren't dropped. `streamAnthropicResponse` maps the SDK `fullStream` to Anthropic SSE; `generateAnthropicResponse` handles non-streaming. `thought_signature` round-trips: encoded into the Anthropic `tool_use.id` as `{id}::ts::{signature}` and decoded back into `providerOptions.google.thoughtSignature` (Gemini puts the signature on the tool-call parts, captured at `tool-input-start`). The SDK handles Gemini's strict `thought_signature` echo-back correctly — the reason a hand-rolled Gemini-native path used to be required.

**Local proxy** (`src/proxy.ts`): a local HTTP server on `127.0.0.1:<random-port>` that accepts Anthropic-format requests at `/v1/messages` and dispatches per route (`startProxyCatalog`/`startProxy`): `modelFormat === 'anthropic'` → direct passthrough to the provider's Anthropic endpoint; otherwise → `isSdkMigratedNpm(route.npm)` → the SDK adapter. Each `ProxyRoute` carries `npm` + `baseURL`. `GET /v1/models` returns a synthetic catalog including `context_window` per model (via `formatAnthropicModelEntry` / `resolveContextWindow`) so Codex's status bar shows accurate remaining context. `aliasModelId()` rewrites non-`Codex-*` ids to `anthropic-{provider}__{id}` so gateway model discovery accepts them.

**Subscription tiers** control which models are shown and whether a backend selector appears:
- `free` / `zen`: always Zen backend, no backend selector
- `go`: Go backend, but also fetches Zen for free models — combined list, backend inferred from `sourceBackend` of selected model
- `both`: shows backend selector

**Env isolation:** `buildChildEnv()` copies `process.env`, deletes all 17 vars in `CONFLICTING_ENV_VARS`, then sets `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`. `launchClaude()` also passes `--model`. Isolation applies to the child process only — the parent shell is not mutated (except `OPENCODE_API_KEY` during key setup). Codex may persist the model to `~/.Codex/settings.json` independently; that is outside relay-ai's control.

**Preferences** (at `~/.relay-ai/config.json`, migrated from legacy `conf` path on first read): `lastBackend`, `lastModel`, `lastProvider`, `recentModelsByProvider`, `favoriteModels`, `subscriptionTier`, and a 1-hour model list cache. Override path with `RELAY_AI_HOME`. All writes are skipped when `dryRun === true`.

**API key storage** uses `@napi-rs/keyring` (installed as `optionalDependencies`) for cross-platform credential store access. The module is loaded via dynamic `import()` so a missing native binary degrades gracefully. `tsup.config.ts` marks `@napi-rs/keyring` and all `@ai-sdk/*` provider packages as `external` so they resolve from `node_modules` at runtime (keeps `dist/cli.js` small).

On startup, `resolveOrCollectApiKey()` silently calls `readFromCredentialStore()` — if a key is found the prompt is skipped entirely.

Save options per platform:
- **macOS** (4 options): Keychain only | Keychain + `~/.zshrc` auto-load | shell profile (plaintext) | session only
  - The `~/.zshrc` auto-load line uses the `security` CLI directly (so the shell can source it): `export OPENCODE_API_KEY="$(security find-generic-password -s relay-ai -a relay-ai -w 2>/dev/null)"`
- **Windows** (3 options): Windows Credential Manager | `setx` user env var (plaintext) | session only
  - `setx` is called with `stdio: ['pipe','pipe','pipe']` to suppress its "SUCCESS" stdout
- **Linux desktop** (3 options): Secret Service (GNOME Keyring / KWallet) | shell profile (plaintext) | session only
  - Secret Service availability is probed via a test `getPassword()` call — returns false if the daemon isn't running
- **Linux headless** (2 options): shell profile | session only — shown with a `p.log.info` note explaining why secure storage is unavailable

In all cases `process.env['OPENCODE_API_KEY']` is set immediately so the key is active for the current session regardless of save choice.

**Local provider discovery** (`src/providers.ts`): `fetchLocalProviders()` spawns `opencode serve --port 0`, waits for the listening URL in stdout/stderr (10s timeout, spinner shown in CLI), fetches `GET /config/providers`, then kills the process. `normalizeProviders()` (called internally) skips OAuth providers (empty key), and classifies each model via `resolveEndpoint(npm, apiUrl)`: `@ai-sdk/anthropic` → passthrough; `@ai-sdk/openai-compatible` without `api.url` → skip; any other non-empty `api.npm` → SDK adapter (`format: 'openai'`). OpenCode is the source of truth for which providers/models appear — relay-ai does not maintain a per-package allowlist. Each model captures `api.npm`, `api.url` (`apiBaseUrl`), and `api.id` (`upstreamModelId` for SDK/upstream calls; catalog `id` stays for Codex's picker). Cost display in Codex is inaccurate for non-Anthropic models (Codex applies its own pricing table); documented limitation.

**Local provider routing:** Two paths depending on `model.modelFormat`:
- `'anthropic'`: `buildChildEnv(model.baseUrl, model.id, provider.apiKey)` — no proxy, Codex talks directly to the provider's Anthropic-compatible endpoint. The `baseUrl` must NOT include `/v1` (the Anthropic SDK appends it).
- `'openai'`: `startProxy(model.completionsUrl ?? '', model.id, trace, contextWindow, { npm, baseURL, upstreamModelId })` — SDK adapter proxy on a random local port; `buildChildEnv('http://127.0.0.1', model.id, provider.apiKey, proxyPort)`. The route's `npm` selects the SDK provider via dynamic import; `baseURL` (`api.url`) is used for openai-compatible / openrouter providers. `completionsUrl` is optional for SDK-first-party packages (SDK owns endpoints).

**Providers that need a non-empty API key:** `normalizeProviders` skips any provider with an empty `key` field (to filter OAuth-only providers like OpenAI/xAI configured via browser login). Local providers that don't validate keys (e.g. Ollama) must still have a non-empty placeholder key set in OpenCode (e.g. `"ollama"`).

**Server command local providers** (`src/server/index.ts`): `loadServerModels()` fetches the provider catalog via `fetchProviderCatalog({ agent: 'server' })` and converts all registry providers to `ServerModelInfo[]` via `localProvidersToServerModels`. The router (`src/server/router.ts`) `handleAnthropicMessages`: anthropic-format → forward raw to `{baseUrl}/v1/messages`; openai-format → `isSdkMigratedNpm(npm)` guard → `createLanguageModel` + `streamAnthropicResponse`/`generateAnthropicResponse` (same SDK adapter as the CLI proxy). `GET /models` strips `apiKey` from output. Spinner shows `"N models (M from registry providers)"`.

**Stale free models:** `STALE_FREE_MODELS` in `constants.ts` contains models whose free promotion ended but the API still returns them. Currently only `qwen3.6-plus-free`. These are filtered out in `mergeModels()`.

**Recent models per provider** (`src/prompts.ts`, `src/cli.ts`, `src/types.ts`, `src/config.ts`): `UserPreferences.recentModelsByProvider: Record<string, string[]>` stores up to 3 recently used model IDs per provider. `pickLocalModel()` shows them at the top of the picker with a `'recent'` hint, plus a "Browse all models →" option. On launch, `cli.ts` prepends the selected model id and saves back (deduped, max 3). Skipped on `--dry-run`.

**Large catalog UX** (`src/prompts.ts`): `MODEL_SEARCH_THRESHOLD = 25` — lists above this show search or paginated browse. `MODEL_PAGE_SIZE = 15` — prev/next pagination. `selectModelWithSearch`, `selectLargeCatalog`, `pickModelFromPagedList`.

**Shared upstream forwarding** (`src/upstream-forward.ts`): `relayAnthropicMessages`, `postJsonUpstream`, anthropic header helpers — used by `proxy.ts` and `server/router.ts`.

**Provider catalog helpers** (`src/provider-catalog.ts`): `fetchProviderCatalog`, `resolveLocalProviders`, `providersForPicker`, `localProvidersToServerModels`, `resolveProvidersForDisplay`, `formatRegistryAuthLabel` — registry-first catalog resolution used by CLI, server, and providers command.

**Antigravity gateway** (`src/antigravity/`): `relay-ai agy` / `antigravity` / `antigravity-ide` run a local fake Cloud Code (Gemini internal) API server (`cloud-code-gateway.ts::startCloudCodeGateway`) that Antigravity talks to instead of Google's real backend. `request-adapter.ts::translateRequest` converts Cloud Code's `generateContent`/`streamGenerateContent` request shape (Gemini-style uppercase JSON Schema types, `functionCall`/`functionResponse` parts) into Vercel AI SDK params; `response-adapter.ts::formatCloudCodeChunk` converts the SDK's streamed output back into Cloud Code SSE chunks. Antigravity routes every MCP tool call through one generic `call_mcp_tool` wrapper function whose `Arguments` field has no fixed schema (it must accept any MCP tool's params) — Google's own Gemini reliably fills that field with a real object, but third-party models routed through relay-ai (this affects any agent launched via relay-ai's Antigravity gateway, not Codex directly) often stringify it instead (`"Arguments": "{}"` rather than `{}`), which Antigravity's MCP execution rejects as `"Invalid request parameters"` for every MCP tool call regardless of model strength or free/paid tier. `response-adapter.ts::normalizeFunctionCallArgs` un-stringifies any top-level tool-call argument that parses as valid JSON to an object/array before the chunk is sent back to Antigravity, fixing this. When debugging Antigravity issues, relay-ai's own `--trace` log truncates bodies to 500 chars and never logs tool-call arguments — Antigravity's own richer per-session record at `~/.gemini/antigravity-cli/brain/<session-uuid>/.system_generated/logs/transcript_full.jsonl` (JSONL, one record per step, `tool_calls` entries carry exact arguments) is the better source of truth. See `ANTIGRAVITY-DEBUG-SESSION.md` for the full debugging history.

**Tests** cover pure functions: `env.ts`, `models.ts`, `sdk-adapter.ts`, `provider-factory.ts`, `proxy.ts` (`aliasModelId`), `providers.ts`, `catalog.ts`, `favorites.ts`, `prompts.ts`, `upstream-forward.ts`, `config.ts`, `tool-search.ts`, `cli.ts` (help text), server modules. Interactive launch flow and real-provider behavior verified manually.

## Key constraints

- `settings.json` is never touched by relay-ai. Launch config is env-var-only, passed to the child process (plus `--model`). This avoids the backup/restore problem that `ollama launch Codex` has. **Caveat:** Codex itself persists the launched model to `~/.Codex/settings.json`, so bare `Codex` later may still show an relay-ai alias (e.g. `anthropic-opencode-go__deepseek-v4-flash`). Gateway discovery caches at `~/.Codex/cache/gateway-models.json`. Reset with `Codex --model sonnet` or by editing/removing those files.
- `--dry-run` ignores all saved state (env key, Keychain, tier, preferences) and skips all writes. Used to simulate a fresh first-run experience.
- When adding a new backend, update `BACKENDS` in `constants.ts`, the `BackendConfig` id union in `types.ts`, and the subscription tier logic in `prompts.ts` and `cli.ts`.
- `buildChildEnv(baseUrl: string, model, apiKey, proxyPort?)` — takes a plain string URL, not a `BackendConfig`. When `proxyPort` is set, `ANTHROPIC_BASE_URL` is always `http://127.0.0.1:{proxyPort}` regardless of `baseUrl`.
- `startProxy(completionsUrl, modelId, debug, contextWindow?, sdk?)` — single-model wrapper around `startProxyCatalog`; `sdk` carries `{ npm, baseURL }` to select the SDK provider.
- `startProxyCatalog(routes, startingAliasId, debug)` — multi-route catalog proxy for switch-menu sessions.
- `MAX_MODEL_CATALOG = 20` in `constants.ts` — favorites cap and max routes in catalog.
- **Provider credential resolution is not centralized.** `src/provider-catalog.ts::resolveLocalProviderApiKey()` is the canonical helper (direct key → anonymous/`apiKeyOptional` providers like Kilo Code → registry authRef → OAuth keyring fallback) and is used by `cli.ts`, `gemini.ts`, and `antigravity/launch-routes.ts`. `codex.ts`, `codex-app.ts`, `claude-app.ts` (2 call sites), and `favorites-resolver.ts::resolveFavorite()` each have/had their own separate copy of similar logic that can drift from the shared helper (this is how the Kilo Code "No credential" bug shipped — the anonymous-provider fix landed in the shared helper but not in these four other call sites, including `codex.ts` itself). When fixing a provider-credential bug, grep all of them — a fix to the shared helper alone will not propagate.

**Codex favorites catalog:** When `prefs.favoriteModels.length > 0`, `relay-ai codex` and `relay-ai codex-app` enter favorites mode on launch:
- Shared resolver (`src/favorites-resolver.ts`) resolves each favorite to a `{providerId, providerName, model, apiKey}` entry, filtering by `agent: 'codex'` blacklist.
- Codex CLI builds a `CodexProxyRoute[]` from resolved entries and starts a single multi-route proxy (`startCodexProxy(routes, { requireAuth: true })`).
- The proxy port is exposed to the child via `OPENAI_API_KEY=proxy-local`.
- Catalog slugs are `${providerId}__${modelId}` (CLI) or `codexAppModelSlug(modelId)` (App).
- `--restore` globs `models-*.json` (CLI) and `app-models-*.json` (App); the new files are `models-favorites.json` and `app-models-favorites.json`.
- Zen/Go favorites are skipped in Codex (use Claude or Desktop gateway).

**ChatGPT/Codex desktop app rename (2026-07-09):** OpenAI merged the standalone Codex desktop app into the ChatGPT desktop app. `relay-ai chatgpt` is a full alias for `relay-ai codex-app` (added in `cli.ts`'s `first === 'codex-app' || first === 'chatgpt'` check — `emptyParsed('codex-app')` still drives dispatch either way, so no new `ParsedArgs['command']` variant was needed). On macOS the app is confirmed renamed `Codex.app` → `ChatGPT.app`, with the bundle id unchanged (`com.openai.codex`) and the running process/executable renamed `Codex` → `ChatGPT` — `src/codex/app-launch.ts`'s `DARWIN_APP_NAMES = ['ChatGPT', 'Codex']` and `native-launcher.ts`'s Windows/macOS fallback paths check both names so pre-update installs keep working. The Windows path/process names were updated by analogy with the confirmed macOS rename (same install-folder convention) via `WIN_APP_NAMES` in `app-launch.ts` — **not yet verified against a real Windows install**; confirm and correct if the actual folder/exe name differs once available.

**Windows desktop-app restart bug (fixed 2026-07-09):** `waitForQuit()` in `codex/app-launch.ts` and `claude-desktop/app-launch.ts` used to treat "no visible main window" (`winHasWindow()`) as "the app has quit." Electron apps that minimize to the tray on window-close clear their window handle immediately while the process stays alive, so this returned `true` instantly, skipping the `winForceQuit()` fallback — the old process (with its already-loaded config) kept running, and a relaunch just refocused it. Fixed to poll actual process existence (`winMatchingPids().length === 0`) instead. `antigravity/launch-ide.ts`'s Windows detection was written process-existence-based from the start (`Win32_Process` filtered by `--user-data-dir`) so it didn't have this bug, but its `winQuitProcess()` (graceful `CloseMainWindow()` only) had no force-kill fallback at all — added `forceQuitAntigravityApp`/`forceQuitAntigravityIde`, wired into `antigravity.ts`'s four quit call sites after a `waitForAntigravity*Quit` timeout.

**Antigravity Windows support (added 2026-07-09):** `findAntigravityAppBinary()`/`findAntigravityIdeBinary()` in `antigravity/launch-ide.ts` were hardcoded `if (process.platform !== 'darwin') return null;` — Windows always failed with a macOS-specific "not installed" error regardless of actual install state. Real paths confirmed against a live install: `%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe` and `%LOCALAPPDATA%\Programs\Antigravity IDE\Antigravity IDE.exe` (Windows paths are case-insensitive, so the `Antigravity`/`antigravity` casing mismatch doesn't matter). The manual path override (`getAppPathOverride`) was also dead code on non-macOS before this fix — it's now checked before the platform branch.

**Server tab (`relay-ai ui`):** Runs the same gateway as `relay-ai server`, in-process inside the `relay-ai ui` web server — no child process, no PID file. Stops automatically when the UI process exits.
- `src/ui/server-control.ts` — lifecycle module: `startGatewayServer(request)`, `stopGatewayServer()`, `getServerStatus()`. Holds the single `ServerHandle` + loaded model list in module state. Reuses `loadServerModels`, `resolveServerUpstreamApiKey`, `getLocalIps` (exported from `src/server/index.ts`) and `filterServerModelsByProviders`/`filterServerModelsByFavorites` (`src/server/catalog-filter.ts`) — identical filtering logic to the CLI wizard.
- API routes in `src/ui/api.ts`: `GET /api/server/status` (current state + saved wizard defaults for pre-filling the form), `GET /api/server/providers` (provider picker list via `fetchProviderCatalog` + `providersForTarget(catalog, 'server')`), `POST /api/server/start`, `POST /api/server/stop`.
- Persists the same settings the CLI wizard saves (`setServerExposedProviders`, `setServerMaskGatewayIds`, `setServerFavoritesOnly`, `setSavedServerPassword`) so a `relay-ai server` quick-start run in the terminal picks up whatever was last configured from the browser, and vice versa.
- A network-mode password is never sent back to the browser as `passwordMode: 'saved'` — the client only learns `hasSavedPassword: boolean`; the actual saved password is resolved server-side.
- `EADDRINUSE` on port `17645` (e.g. a terminal `relay-ai server` already running) surfaces as a specific inline error rather than a generic failure.
- Frontend (`src/ui/public/app.js`, `state.server`): polls `GET /api/server/status` every 5s (cheap enough to run continuously; also drives the sidebar "Live" badge). Setup-state and running-state are two fully-templated views swapped into a single `#server-panel` container, matching the file's existing full-innerHTML-replace convention (see `renderApps()`).

## Release status (v0.6.1)

Current version is **v0.6.1** — maintenance: UI Zen/Go add + provider count refresh; providers are Relay-native (OpenCode CLI = optional `providers import` only). Docker Server + Admin UI from **v0.6.0** remains — see `docs/DOCKER.md`.

**Known limitations (by design):**
- Cost display in Codex is always inaccurate for non-Anthropic models.
- OAuth-authenticated providers (no stored key) are silently skipped.
- `@ai-sdk/github-copilot` won't work — OpenCode loads it from internal `@opencode-ai/core`, not a public npm factory we can ship.
- Bedrock/Azure are not first-class API-key providers yet (optional `providers import` if already configured in OpenCode CLI). Vertex uses `relay-ai server --vertex` + gcloud ADC.
- Providers with custom auth mechanisms (e.g. Azure OpenAI with deployment URLs) are not fully supported.
- The `::ts::` separator in tool_use ids encodes `thought_signature`; would break if a signature ever literally contained `::ts::`. Extremely unlikely.
- In switch-menu (gateway-discovery) mode the displayed context window reflects the **launch** model and does NOT update on live `/model` switch. Codex's gateway model discovery only carries `id` + `display_name` (no `context_window`) and fetches `/v1/models` once at startup, so `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (fixed at launch) is the only lever. Single-model launches show the correct window.

**Provider quirks (documented from testing):**
- **Mistral free tier:** strict API rate limits (HTTP 429, code `1300`). Tool-heavy Codex sessions burn quota quickly (parallel title-generation requests, Skill injection, multi-turn tool loops). The SDK handles Mistral message ordering; throttling is unaffected.
- **OpenAI direct (`@ai-sdk/openai` local provider):** newer models (GPT-5.4+, GPT-5.5, `*-codex`, o-series) require the Responses API — `provider-factory.modelPrefersResponsesApi()` selects `openai.responses(id)` for them, `openai.chat(id)` otherwise. OpenCode catalog IDs may differ from upstream API IDs — `upstreamModelId` uses OpenCode's `api.id` (e.g. `gpt-5.5-fast` → `gpt-5.5`). GPT-5.5 reasoning round-trips via encrypted content in `thinking.signature`. Cloud OpenCode Zen/Go GPT models remain hidden in the wizard (`unsupported`); use the local OpenAI provider for GPT access.
