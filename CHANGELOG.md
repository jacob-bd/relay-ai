# Changelog

## [0.3.5] - 2026-06-26

### Fixed

- **Windows: Claude Desktop 3P config now writes to the correct path** — relay-ai was writing the `configLibrary` to `%APPDATA%\Claude-3p` (Roaming) but Claude Desktop reads from `%LOCALAPPDATA%\Claude-3p` (Local). The config is now written to the correct location. Reported by Trojan28A ([#11](https://github.com/jacob-bd/relay-ai/issues/11)).

- **Windows: Claude Desktop and Codex App now launch correctly from MSIX installs** — `Start-Process 'shell:AppsFolder\...'` failed silently due to PowerShell backslash double-escaping via `JSON.stringify`. The launcher now uses `cmd /c start` with an argument array, which bypasses PowerShell string parsing entirely and correctly opens MSIX-packaged apps. ([#11](https://github.com/jacob-bd/relay-ai/issues/11)).

- **Windows: OpenCode CLI now discovered correctly when `where.exe` returns multiple results** — `where.exe opencode` returns both a bare script and a `.cmd` wrapper. relay-ai was taking the first result (the bare script), which Node's `spawn()` cannot execute directly. relay-ai now prefers the `.cmd` entry. The same fix applies to the `claude`, `codex`, and `gemini` binary lookups. The OpenCode `serve` subprocess also now uses `cmd.exe /c` on Windows to avoid Node 22's DEP0190 deprecation warning. ([#11](https://github.com/jacob-bd/relay-ai/issues/11)).

## [0.3.4] - 2026-06-23

### Fixed

- **Go models no longer mislabeled as Anthropic format** — OpenCode Go models (e.g. `minimax-m3`, `qwen3.7-plus`, `minimax-m2.7`, `qwen3.7-max`, `qwen3.6-plus`) were incorrectly classified as `modelFormat: 'anthropic'` due to stale `@ai-sdk/anthropic` npm entries written by the OpenCode cache. The Go backend is an OpenAI-compatible gateway only; relay-ai now clamps any `anthropic` format classification to `openai` for all Go models regardless of cache data. Reported by Philip2050 ([#10](https://github.com/jacob-bd/relay-ai/issues/10)).

## [0.3.3] - 2026-06-22

### Fixed

- **Codex App: old sessions no longer show "Custom" as the model name** — relay-ai previously wrote its internal alias model ID (e.g. `go__glm-5.2`) into `config.toml`, which Codex baked into every session record. Reopening that conversation in native Codex showed "Custom" because the alias is unrecognized. relay-ai now writes `gpt-5.5` as the display model so sessions record a name Codex recognizes, enabling clean resume without errors.

## [0.3.2] - 2026-06-22

### Fixed

- **Codex App: rate limit errors now appear in the conversation instead of crashing silently** — when a model hits its usage limit (e.g. OpenCode Go's 5-hour cap), the proxy now injects a readable error message directly into the Codex App conversation: `"5-hour usage limit reached. Resets in Xmin. To continue using this model now, enable usage from your available balance: ..."`. Previously the session just stalled with no explanation in the UI.

- **Codex App: rate limit errors print a clean one-liner in the terminal** — instead of flooding the terminal with full RetryError stack traces (one per retry attempt, per request), the proxy now prints a single `[relay-ai] <model>: <message>` line per failed request.

- **Codex proxy: removed SDK default `console.error` on stream failures** — the Vercel AI SDK's `streamText` calls `console.error(error)` by default whenever the stream encounters an error. This was the root cause of the full stack trace dumps. The proxy now passes `onError: () => {}` to suppress this. The error is still handled through the stream pipeline and surfaced to the user.

- **Codex App: context overflow no longer crashes long sessions** — relay-ai now writes `model_context_window` and `model_auto_compact_token_limit` (70% of the model's actual limit) into `~/.codex/config.toml` at session start. Codex uses these values to trigger auto-compaction before the conversation reaches the model's hard limit, preventing the compaction-fails-at-limit crash that previously broke sessions and made them unrecoverable. Applies to single-provider, favorites, and Vertex AI sessions alike.

- **Codex App: proxy-level message truncation as a safety net** — if a conversation history arrives that already exceeds 85% of the selected model's context window (e.g. a long native GPT-5.5 session loaded into a 1 M-token model), relay-ai silently drops the oldest messages before forwarding to the upstream model. The session continues in a degraded but functional state instead of crashing with an unrecoverable error.

- **Codex App: Ctrl+C now shows a confirmation menu instead of immediately closing** — pressing Ctrl+C now presents an arrow-key selection menu: *"Close Codex Desktop and restore your Codex config?"* (Yes / No). Pressing Ctrl+C a second time during the prompt, or pressing Enter on Yes, closes the app and restores config. Choosing No keeps the session running. SIGTERM and SIGHUP still close immediately without a prompt.

- **Codex App: `--trace` request observability** — `--trace` mode now logs `previous_response_id`, `input_items`, and `body_bytes` for every incoming proxy request, making it possible to verify Codex's conversation-history protocol against a specific provider setup.

## [0.3.1] - 2026-06-22

### Fixed

- **Codex App: background GPT model requests no longer crash your session** — The Codex desktop app has an internal agent subsystem that sends background requests using hardcoded model IDs (`gpt-5.4`, `gpt-5.4-mini`, `gpt-5.5`), even when you've configured a completely different model like GLM or DeepSeek. These requests were hitting the relay-ai proxy and getting 404 errors, which interrupted your chat session and showed up as confusing error states in the UI. The proxy now silently routes those background requests to your configured starting model instead. Your session keeps running. (Fixes [#8](https://github.com/jacob-bd/relay-ai/issues/8))

- **Codex App: `GET /v1/responses` polling no longer returns 404** — Codex polls this endpoint in the background for session state. The proxy only handled `POST /v1/responses` before, so every poll got a 404. Now it returns an empty list, which is all Codex actually needs.

- **`--trace` output was a false negative** — `relay-ai codex-app --trace` would print `(no errors found in debug log)` even when the proxy had been silently dropping dozens of model-not-found failures the whole session. Trace output now surfaces `resolveModel failed` and `resolveModel fallback` lines so you can actually see what's happening.

## [0.3.0] - 2026-06-21

*Happy Father's Day!* 👨‍👦


### Added
- **New Native Providers** — Added native provider templates and registry support for DeepSeek (`deepseek`), Zhipu (`zhipu`), and Moonshot (`moonshot`), facilitating direct integration of Chinese LLM providers.
- **Experimental Gemini Support** — Introduced experimental support for Google Gemini models via a custom SDK adapter and local proxy, enabling `relay-ai gemini`.
- **Kimi/Moonshot Reasoning Level Selection** — Enabled support for Codex's native "Select Reasoning Level" UI for Kimi models by exposing `supported_reasoning_levels` in the proxy catalog and translating reasoning effort parameters.
- **Provider Documentation** — Created a dedicated [PROVIDERS.md](file:///Users/jbendavi/dev_projects/relay-ai/docs/PROVIDERS.md) documentation file explaining the differences between Kimi, Kimi Global, and Moonshot models, and linked it from the main README.

## [0.2.8] - 2026-06-20

### Added
- **xAI OAuth provider (`xai-oauth`)** — SuperGrok OAuth now gets its own registry slot and coexists with an API-key xAI provider; both can be active simultaneously without overwriting each other.
- **OpenAI OAuth provider (`openai-oauth`)** — ChatGPT Plus/Pro OAuth now gets its own registry slot and coexists with an API-key OpenAI provider; both can be active simultaneously without overwriting each other.
- **Browser auto-open during OAuth sign-in** — the device-code URL opens automatically in the default browser on all platforms (macOS, Windows, Linux desktop) so you don't have to copy-paste the link.
- **3-tier model refresh for OpenAI OAuth** — on `providers refresh-models`, relay-ai first queries the ChatGPT Codex-specific endpoint for models guaranteed to work, falls back to the filtered general ChatGPT list, and uses a static seed only when both network tiers are unreachable.
- **Static xAI OAuth seed** — `buildXaiOAuthModels()` provides a fallback Grok model list (Grok 3 and 4 families) when the live `api.x.ai/v1/models` endpoint rejects the SuperGrok JWT.
- **Registry migration** — existing `{id: 'openai', authType: 'oauth'}` and `{id: 'xai', authType: 'oauth'}` entries are automatically renamed to `openai-oauth` and `xai-oauth` respectively on next load, preserving credentials and the original keyring slot.
- **Richer SDK error logging in proxy** — SDK errors now include the full response body alongside the message, making Codex inference failures easier to diagnose.
- **Fuzzy multi-token model search** — model search now supports multi-token AND matching and punctuation normalization. Queries like `"QWEN 3.7"` or `"qwen 2.5 32"` now successfully match models like `qwen3-7b` and `qwen2.5-coder-32b`.
- **Multi-model selection in favorites manager** — allow users to select and add multiple favorite models from a single provider in one step using `p.multiselect` with a dimmed visual cue `(Space to select, Enter to confirm)`.
- **Back-button navigation in launcher model selectors** — added `← Go back` options and handled cancellations to loop back to the provider selection menu (with the chosen provider pre-selected) in `relay-ai claude`, `relay-ai codex`, `relay-ai codex-app`, and the favorites addition wizard.
- **Alphabetical sorting of providers and models** — sorted the launcher and wizard selection lists alphabetically using natural collation for cleaner readability and easier scanning.
- **Server model catalog printout** — `relay-ai server` and `relay-ai server --vertex` now print a structured, grouped, and copy-pasteable catalog of model names along with their exact ID strings to copy-paste for `anthropic` and `openai` formats, respecting gateway masking.
- **Unified OpenAI Endpoint Support** — `relay-ai server` now supports a native OpenAI completions endpoint (`/openai/v1/chat/completions`) for all model types (Anthropic, Google Gemini, Grok, etc.) using a bidirectional translation adapter, allowing OpenAI-compatible clients to connect to any model.
- **API Server Guide & THE AI Counsel setup documentation** — added a comprehensive setup guide (`docs/API_SERVER.md`) explaining server startup outputs, network IPs, and detailed integration steps for connecting THE AI Counsel to the server gateway.


### Fixed
- **OpenAI OAuth model retrieval** — restored live model discovery for ChatGPT accounts by explicitly sending the installed `claude` version (`?client_version=`) and a standard `User-Agent`, which the Codex backend now strictly requires.
- **OpenAI OAuth "Instructions are required" error** — the ChatGPT Codex backend requires the system prompt in `openai.instructions` inside `providerOptions`, not the standard `system` field; this caused every Claude Code tool-use step to fail when using an OpenAI OAuth provider.
- **OpenAI OAuth token expiry** — `oauthCredentialShouldRefresh` now applies the pre-emptive 2-minute JWT expiry buffer to `openai` and `openai-oauth` providers, matching the existing behaviour for xAI and GitHub Copilot. Previously, OpenAI OAuth access tokens (1-hour TTL) were only checked against the hard `expires` wall-clock, not the JWT claim.
- **Broken provider state after `relay-ai providers auth openai-oauth`** — if a user passed the registry ID instead of the canonical `openai` to the auth command, `upsertOAuthProvider` would store `templateId: 'openai-oauth'` and all subsequent model refreshes would throw "unsupported template". Fixed by stripping the `-oauth` suffix when deriving `templateId`; the `else` branch also now updates `templateId` on existing entries, healing any already-broken providers on next auth.
- **xAI live model metadata gaps** — newly-discovered Grok models not yet in the static seed were built without `contextWindow`, `reasoning`, and using the raw ID prefix for `brand` instead of `deriveBrand`. This showed as 0 context window in Claude Code's status bar and incorrect brand metadata.
- **Speculative OpenAI model IDs removed from seed** — `gpt-5-pro`, `gpt-5-mini`, `gpt-5-codex`, `gpt-5.2`, `gpt-5.2-pro`, and `gpt-5.2-codex` were in the static seed but are not confirmed available on the ChatGPT Codex backend. They would surface in the model picker when the network was unreachable (Tier 3 path) and then fail at inference time.
- **Codex direct-tier routing** — `resolveCodexRoute` now keys on `model.npm === '@ai-sdk/openai'` instead of `provider.id === 'openai'`, correctly routing standard OpenAI models to the direct tier regardless of which provider ID variant is in use.
- **Proxy token loopback security** — hardened local proxy endpoints (`startProxyCatalog` and `codex-proxy`) against malicious cross-origin access by generating a unique `proxyToken` per session and enforcing `Origin`/`Referer` checks (`127.0.0.1`/`localhost`) as a defense-in-depth measure. (Thanks to @wnstfy)
- **Server password storage** — replaced plaintext file storage for LAN network passwords with system keyring storage (`@napi-rs/keyring`), hardened dotfolder permissions, and suppressed console output in `relay-ai server` mode. (Thanks to @wnstfy)
- **Dependency vulnerabilities** — replaced the deprecated `smol-toml` package, enforced a `ws` version override to resolve upstream security advisories, and aligned the root package-lock.json version. (Thanks to @wnstfy)
- **PowerShell launch corruption** — fixed command-line argument escaping logic in `relay-ai codex-app` and `claude-app` on Windows to use single-quoted string literals, preventing `\` path corruption. (Thanks to @sewersydah)
- **Codex-App favorites proxy routing and model validation** — resolved model ID mapping collisions by routing favorites through provider-prefixed slugs (e.g. `xai__grok-build-0.1`), resolving `Custom` model loading and Claude Haiku gateway routing errors in the favorites proxy. Skipped unsupported OAuth favorites and added diagnostics logs.

---

## [0.2.7] - 2026-06-19 (Official Launch Release)

### Added
- **Native provider registry** — Add, list, remove, refresh, and import providers with secure OS credential storage and templates for OpenRouter, Groq, Mistral, Together AI, Zen/Go, and SDK-backed custom endpoints.
- **Claude Code launcher** — Launch registry models through `relay-ai claude`, including provider/model boot flags, local OpenCode provider discovery, recent models, search, pagination, and favorites catalogs for mid-session switching.
- **Codex CLI launcher** — Launch the Codex terminal with registry providers via `relay-ai codex`.
- **Codex App launcher** — Launch the Codex desktop app with registry providers via `relay-ai codex-app`. Preserves existing conversation history by keeping Codex's built-in OpenAI provider identity; routes the selected model through a foreground local Responses proxy. Supports `--trace` for proxy debug logging.
- **Unified SDK gateway** — Route non-Anthropic providers through the Vercel AI SDK adapter while preserving Anthropic-compatible tool use, streaming, context windows, and model catalogs.
- **Claude Desktop integration** — Launch Claude Desktop in third-party provider mode with automatic configuration backup and restore.
- **Foreground server gateway** — Run `relay-ai server` for Claude Desktop or LAN usage, with registry-backed routing, password protection, and optional Vertex AI support.
- **Reasoning capability metadata** — Resolve reasoning controls from provider metadata, including OpenRouter `supported_parameters`, so models receive compatible reasoning options.
- **Favorites catalogs** — Save up to 20 models and switch mid-session in Claude Code (`/model`) and Codex.
- **First-run setup** — Configure providers from an inline wizard or import existing OpenCode provider settings.
- **Complete command help** — Every top-level command fully documented, including `codex-app`, `claude-app`, Vertex, restore, config, trace, and agent-reference flags.
- **Agent / headless launch** — Boot flags (`--provider`, `--model`), clean NDJSON/JSONL stdout, and `relay-ai --ai` reference for scripts and alef-agent.
