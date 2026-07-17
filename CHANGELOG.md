# Changelog

## [0.4.7] - 2026-07-16

### Added

- **Use Relay models alongside your normal Claude models in Claude Code** — the new transparent proxy mode keeps Claude Code signed in to Anthropic while adding a selected Relay model and compatible favorites to the same session. Enable it from the CLI wizard, pass `--http-proxy`, or select **Keep my Anthropic login and add Relay models** on the Claude Code card in `relay-ai ui`. Relay models are available through the `/model relay:<provider>:<model>` commands printed at launch because Claude Code cannot add them to its built-in model picker. Based on the transparent proxy contribution by Brandon Wallace ([@bman654](https://github.com/bman654)) in [#22](https://github.com/jacob-bd/relay-ai/pull/22), integrated and hardened in [#23](https://github.com/jacob-bd/relay-ai/pull/23).

### Security

- **Transparent proxy sessions are isolated and locked down** — every launch uses a password-protected loopback proxy and a unique temporary certificate authority that is removed when the session ends. Native Anthropic requests preserve their original authentication and body, while registry credentials are available only to the selected Relay model and compatible favorites. Non-local inherited proxy settings and unsupported proxy protocols are rejected instead of being silently chained.

### Documentation

- Added setup, switching, security, compatibility, and troubleshooting guidance for transparent proxy mode to `README.md` and `docs/AI-AGENTS.md`.
- Added focused contribution guidelines and a pull request template in [#24](https://github.com/jacob-bd/relay-ai/pull/24), including expectations for large, security-sensitive, and generated-file changes.

### Known limitations

- Transparent proxy mode is for **Claude Code**, not Claude Desktop, and currently preserves only a direct Anthropic login. Google Vertex AI configuration is not preserved, corporate proxy chaining is not supported, and the launch/proxy/cleanup flow has not yet been verified on Windows.

## [0.4.6] - 2026-07-16

### Added

- **Browse provider models in the web UI** — clicking a provider card on the Providers & Keys page in `relay-ai ui` now opens a dedicated model browser for that provider, with case-insensitive search across model IDs and names, pagination (25 models per page), and input/output pricing per million tokens when the provider publishes it. The sidebar brand also now links to the relay-ai GitHub repository.

## [0.4.5] - 2026-07-15

### Fixed

- **MCP tools and the built-in browser now work in Codex / ChatGPT desktop app with non-native models** (#21) — Codex wraps MCP server tools (and the built-in browser, which is itself exposed as an MCP tool) in a proprietary `{type:"namespace"}` envelope. relay-ai already flattened these into callable function tools for the model, but sent the model's tool call back to Codex as a flat name instead of splitting it back into the `{namespace, name}` shape Codex's own dispatcher requires, so every call was rejected with `unsupported call: ...`. Also added translation for `tool_search` (deferred/lazy-loaded tools), `additional_tools` turn-local tool definitions, and `type:"custom"` tools (e.g. `apply_patch`). Credit to [bharat2808/codex-ollama-proxy](https://github.com/bharat2808/codex-ollama-proxy) — a community proxy for Codex + Ollama that solved this same class of problem first and whose approach to flattening/splitting namespace tools informed this fix.
- **`Fatal error: remote compaction v2 expected exactly one compaction output item` no longer crashes Codex / ChatGPT app sessions** — Codex's "remote compaction v2" requires the response to contain exactly one output item of type `compaction`; relay-ai was replying with a normal reasoning+message turn, which Codex rejected outright. relay-ai now asks the model for a plain-text summary and returns it wrapped as the single `compaction` item Codex expects, decoding it back into readable context on later turns.
- **Compaction no longer fires prematurely in the ChatGPT desktop app** — a single large tool result (e.g. a browser snapshot) could push a session past relay-ai's auto-compact threshold within a couple of turns. Raised `model_auto_compact_token_limit` from 55% to 90% of the model's context window.

### Added

- **Untruncated Codex request/response trace dump** — `relay-ai codex`/`codex-app --trace` now writes full, unclipped `/v1/responses` request and response bodies (tools array, every input item) to `~/.relay-ai/logs/codex-body-dump.jsonl`, for diagnosing Codex tool-shape and compaction issues without reproducing twice.

### Documentation

- Updated the MCP known-limitation notes in `README.md`/`docs/CODEX.md` to reflect the fix above, corrected stale auto-compaction figures, and documented a new known limitation: `image_gen` (image generation) calls an OpenAI-only image backend relay-ai doesn't implement, and most registry models can't generate images regardless — no workaround planned.

## [0.4.4] - 2026-07-13

### Added

- **Automatic update notifications in the CLI and web UI** — interactive CLI commands now perform a silent, cached check for newer npm releases and show the exact update command when one is available. The web UI displays the same information below its version badge with a copyable update command. Network failures never block startup or normal commands.
- **Embedded gateway lifecycle messages in `relay-ai ui`** — starting or stopping the Server Gateway from the browser now prints a concise terminal message showing whether it started in local or network mode and how many models are exposed.

## [0.4.3] - 2026-07-11

### Fixed

- **Registry server errors now preserve the real upstream status and detail** — SDK-backed Anthropic and OpenAI routes no longer collapse provider errors into an opaque `502 Bad Gateway`, making authentication, rate-limit, and invalid-request failures actionable.
- **The web UI version now stays synchronized with the CLI** — the sidebar version is derived from `package.json` at server startup instead of using a hardcoded value.
- **README demo previews render reliably** — broken embedded video previews now use YouTube-hosted thumbnails.

### Documentation

- **Restored the complete project documentation set** — setup and reference guides for Claude Desktop, Codex, Gemini, providers, the API server, model compatibility, troubleshooting, and AI agents are tracked in the repository again.
- **Package archives are excluded from source and npm packages** — generated `.tgz` files can no longer pollute the repository root or recursively include themselves in a release archive.

## [0.4.1] - 2026-07-11

### Fixed

- **GPT-5.6 Luna (OpenAI OAuth) now works** — `gpt-5.6-luna` was selectable but failed at inference (`404 Model not found` / "No output generated") because it requires OpenAI's Codex **Responses-Lite over WebSocket** transport (`wss://chatgpt.com/backend-api/codex/responses`), while relay-ai only spoke the standard HTTP Responses path. relay-ai now opens an outbound WebSocket per request for models the backend flags this way, forwarding the ChatGPT subscription headers (`ChatGPT-Account-Id`, `originator`, `version`, `x-openai-internal-codex-responses-lite`) and the `OpenAI-Beta: responses_websockets` opt-in, and streams the event frames back as SSE. One socket per request, so concurrent Claude Code requests (e.g. background title generation) can't be crossed. Thanks to @tonyb760 for the detailed report (#18). (`store: false` and the `ChatGPT-Account-Id`/`originator` headers were already shipped in 0.4.0.)

### Added

- **Backend-driven transport selection for ChatGPT Codex models** — relay-ai reads the `use_responses_lite` / `prefer_websockets` capability flags the ChatGPT Codex model endpoint reports and routes each model accordingly, instead of hardcoding model names. Future Responses-Lite models are picked up automatically with no code change. The static seed carries the same flags as a fallback for a discovery-endpoint outage.

## [0.4.0] - 2026-07-10

### Added

- **`relay-ai ui` — Visual launcher web UI** — Run `relay-ai ui` to open a browser-based dashboard for managing providers and launching every supported coding agent from a single interface. Features include:
  - **App launcher cards** — one card per tool (Claude Code CLI, Codex CLI, Gemini CLI, Anti-gravity CLI, Antigravity App, Antigravity IDE, Claude Code Desktop, Codex Desktop). Click to expand, pick a provider and model, and launch.
  - **In-UI model selection** — selecting a provider and model before clicking Launch passes `--provider`/`--model` directly to the terminal command, bypassing the interactive picker entirely. The terminal opens straight to the running session with no second selection step.
  - **Real brand icons** — every app card shows its actual brand icon: Anthropic orange for Claude Code CLI and Desktop, OpenAI Codex dark for Codex CLI and Desktop, Google gradient for Gemini CLI, Anti-gravity dark for the AGY family, and the relay-ai SVG mark for the sidebar logo.
  - **General Favorites sidebar** — view and manage your saved favorite models with a slot indicator bar (Slots used X/20).
  - **Antigravity Favorites sidebar** — dedicated favorites panel for Antigravity sessions.
  - **Provider management panel** — add providers from templates, delete, and trigger model-list refreshes without leaving the UI.
  - **Recent launch folders** — picker remembers your last-used working directories for CLI launchers.

- **Server tab in `relay-ai ui`** — run the same API gateway as `relay-ai server`, configured and launched entirely from the browser instead of a terminal wizard:
  - **Setup form** mirrors the CLI wizard: favorites-only vs. specific providers (searchable multi-select), "Mask gateway model ids" for Claude Desktop / Cowork discovery, and local-only vs. network listen mode with a password field (reuse a saved password or save a new one to the OS keychain).
  - **Running view** shows live, copyable Anthropic and OpenAI endpoint URLs (plus one per network interface in network mode), a reveal/copy API key, and the full exposed model catalog (provider, name, Anthropic ID, OpenAI ID) — with a one-click Stop.
  - Runs in-process inside the `relay-ai ui` server (no child process), so it stops automatically when the UI is closed, and shares the same saved settings as the terminal wizard so both stay in sync.

- **Codex Desktop app (`relay-ai codex-app`) in the UI launcher** — the Codex Desktop app now appears as a launcher card in `relay-ai ui` with correct detection paths for macOS (`/Applications/Codex.app`, `~/Applications/Codex.app`) and Windows (`Programs/Codex`, `Programs/OpenAI Codex`, `openai-codex-electron`), the Codex brand icon, and a dark card background. Previously `relay-ai codex-app` was a full working CLI command but was invisible in the UI.

- **Claude Desktop (`relay-ai claude-app`) in the UI launcher** — Claude Desktop is now a launcher card in `relay-ai ui` alongside the CLI tools, with a launch-folder control suppressed (it's a GUI app). Favorites launch resolves the first matching favorite and passes it through so the terminal skips the picker.

- **`relay-ai server --quick` / `--saved` and one-run override flags** — after configuring the server once, start it without prompts via `relay-ai server --quick` (or `--saved`). Any one-run option also skips the wizard: `--listen local|network`, `--providers all|favorites|id1,id2`, `--free-only` / `--no-free-only`, `--mask-gateway-ids` / `--no-mask-gateway-ids`, and `--password <value>`. Non-interactive shells (scripts, services, CI, pipes) use quick mode automatically; if it resolves to network mode with no `--password` and no saved password, it now exits with a clear error instead of prompting.

- **`--trace` now covers Codex App WebSocket traffic, plus live generation progress** — the Codex App's WebSocket `/v1/responses` handler had no debug logging, so `--trace` was blind to nearly all Codex App traffic; it now logs incoming requests, context/compaction checks, and resolved effort just like the HTTP path. Generation also reports progress roughly every 3 seconds (running reasoning length and a tail preview), so a stuck or looping generation can be observed live instead of only after the fact.

- **`relay-ai antigravity` / `relay-ai antigravity-ide` / `relay-ai agy` — Antigravity launcher support** — one of the biggest additions in this release: launch Google's Antigravity CLI, desktop app, or IDE through relay-ai's provider registry, so you can use any configured provider's models — Claude, GPT, DeepSeek, and more — inside Antigravity instead of only Google's own models. Fully supported on both macOS and Windows, including app/IDE detection, launch, and quit on both platforms, plus a dedicated Antigravity Favorites list for quick model switching.

- **`relay-ai chatgpt`** — alias for `relay-ai codex-app`. OpenAI merged the Codex desktop app into the ChatGPT desktop app on 2026-07-09; the app is now named `ChatGPT.app` on macOS (bundle id and config format unchanged) and opens in Codex mode for existing Codex users. Detection/launch/quit logic and UI labels updated accordingly. The Windows install path was updated by analogy with the confirmed macOS rename and is not yet verified against a real install.

- **Nvidia (build.nvidia.com) provider support** — Nvidia's model catalog is now available as a provider template, wired up end-to-end alongside the other native providers.

- **Kilo Code provider support** — Kilo Code is now available as a provider template, including its free anonymous-access tier (no API key required to use its free models).

### Fixed

- **Codex Desktop / Claude Desktop restart on Windows silently did nothing if the app minimized to the tray instead of exiting** — the restart flow's `waitForQuit` considered the app "closed" as soon as its window handle disappeared, which happens immediately for tray-minimizing apps even though the process (and its old config) is still running. The next launch would then just refocus the stale process, so a newly selected model never took effect. `waitForQuit` now polls actual process existence instead of window visibility, so the existing force-kill fallback actually runs when needed.

- **Security: Codex Desktop's WebSocket transport now requires the same authentication as its HTTP path** — the `/v1/responses` WebSocket upgrade handler had no auth check, unlike the HTTP `POST` handler for the same route, so any local process could open a WebSocket connection to the proxy and get model completions on your configured credentials. It now enforces the identical bearer-token check.

- **Security: custom provider display names are now escaped in the UI** — a custom endpoint's display name was rendered into the Providers list without HTML-escaping, allowing a crafted name to run arbitrary script in the `relay-ai ui` page.

- **Security: `allowInsecureLocal` no longer permits plaintext HTTP to public hosts** — the custom-endpoint URL validator now also requires the resolved address to actually be a loopback or private/LAN address before allowing `http://`, closing a gap where a public IP could be registered with insecure HTTP.

- **Security: unsafe app-launch arguments are now rejected instead of shell-escaped** — the native terminal launcher's argument quoting didn't fully protect the outer shell command on every platform. Arguments outside the safe identifier character set are now rejected outright rather than escaped.

- **Codex App: non-rate-limit errors no longer show a fake "context too large" message** — an invalid API key, a bad request, or an upstream outage was rewritten into a canned "conversation context was too large to summarize" message, hiding the real cause. The actual error message is now shown.

- **OAuth-authenticated Anthropic-format providers no longer break permanently after token expiry, and now work correctly through `relay-ai server`** — the Anthropic-passthrough path used by `relay-ai claude`/`codex`/`gemini`/`server` now retries once with a refreshed token on a 401, and `relay-ai server`'s passthrough now applies the same request handling and forwards the same custom provider headers that `relay-ai claude` already did, instead of dropping them and corrupting streaming responses.

- **`relay-ai gemini`: selecting a non-default model from a backend-routed provider could silently route to the wrong model** — a backend-routing rewrite changed the model's internal id but Gemini CLI was still launched with the old one, so requests transparently fell back to a different model than the one selected.

- **Windows: Codex CLI could be reported as "not found" even when installed** — the binary-verification step didn't account for `.cmd`-wrapped installs the way the actual launch step already did, and newer Node.js versions could reject running the check directly.

- **`relay-ai gemini`: non-streaming tool calls no longer lose their arguments** — a local proxy mapped tool-call results using an incorrect field name, so a non-streaming request that ended in a tool call reached the client with no arguments at all.

- **`relay-ai ui` Server tab: rapid double-clicking Start could corrupt saved settings** — two near-simultaneous start requests could both pass the "already running" check and race through setup, with the losing request's settings silently overwriting the winner's. Start requests are now serialized.

- **Codex Desktop: the "keep session running" option on Ctrl+C is back** — an unrelated commit had accidentally dropped the confirmation prompt, so Ctrl+C always restored your Codex config immediately with no way to decline. The prompt is restored.

- **Gemini CLI: stale OAuth auth settings no longer block relay-ai launches** — if `~/.gemini/settings.json` had `security.auth.selectedType` set to `oauth-personal` from a previous direct Gemini CLI login, Gemini CLI preferred that saved setting over relay-ai's injected proxy API key and could fail before reaching the local proxy. `relay-ai gemini` now launches Gemini with an isolated temporary `GEMINI_CLI_HOME`, forces `gemini-api-key` auth for the child process, and cleans up the temporary overlay when Gemini exits. Fixes [#13](https://github.com/jacob-bd/relay-ai/issues/13).

- **Codex App: WebSocket `/v1/responses` fully implemented** — the proxy now accepts WS upgrades, reads the request from the first text frame, runs the same `translateResponsesRequest` + `streamResponsesResponse` path as the HTTP POST handler, and streams each SSE event back as a WS text frame (raw JSON, no SSE envelope). Fixes the "Stream error / Reconnecting 5/5" loop seen in newer Codex App versions when the proxy rejected upgrades with HTTP 503. Connection closes cleanly when the stream ends.

- **Codex App: context trimming no longer over-trims by 3x** — the proxy's internal character limit now matches the caller's token-to-character estimate, preventing oversized sessions from being reduced to a single message before compaction.

- **Codex App: relay-model sessions compact earlier** — the app now sets `model_auto_compact_token_limit` to 55% of the selected model's context window, giving compaction more headroom across providers with different practical limits.

- **Codex App: compaction payloads are protected before upstream** — compaction-sized requests now get oversized text/tool-output blobs clipped and are trimmed to a conservative budget before they reach Anthropic, Gemini, xAI, OpenRouter, OpenCode, or other relay providers.

- **Codex App: empty translated input no longer creates invalid Anthropic requests** — empty input now becomes a non-empty placeholder message instead of `messages.0` with empty content.

- **UI → terminal model selection is now end-to-end** — selecting a provider and model in `relay-ai ui` and clicking Launch previously showed the full interactive provider/model picker in the terminal anyway. Two bugs combined to cause this: (1) `claude-app` and `codex-app` arg parsers used a bare `for...of` loop that dumped every arg — including `--provider` and `--model` — into `claudeArgs` without calling `tryConsumeRelayLaunchFlag`, so `parsed.launchProvider`/`parsed.launchModel` were always `undefined`; (2) neither command had a boot path that checked those values. Both are now fixed.

- **`claude-app` with Groq: requests with more than 128 tools no longer fail** — Groq's API enforces a hard limit of 128 tools per request. Claude Desktop sends its full tool set on every request — built-in file/bash tools plus every configured MCP tool and injected skill — which easily exceeds 128. The proxy now automatically truncates to 128 when routing via `@ai-sdk/groq`, logging `tools truncated: N → 128 (provider limit)` to the trace log when trimming fires.

- **Non-Anthropic providers: null optional parameters no longer cause tool-call validation errors** — Open models (GPT OSS 120B, GLM, Z.AI, and similar) sometimes emit `null` for optional tool-call parameters instead of omitting the key. Claude Desktop's schema validator treats `null` as a type mismatch and shows *"Tool call validation failed: parameters for tool X did not match schema"*. The proxy now strips top-level `null` values from all tool-call inputs before returning them to the client. Applies to both streaming and non-streaming response paths.

- **`--trace` logs now show provider API errors** — when a provider returned an error (429 rate limit, 400 bad request, 502 upstream failure, etc.), the proxy's catch block sent the error response but never logged it, so `--trace` output appeared clean even on repeated failures. All SDK-level errors in both the Anthropic-format and OpenAI-format proxy handlers are now logged with the provider npm, upstream model ID, and error message.

- **Claude Desktop: direct OpenAI (ChatGPT) OAuth launches keep OAuth routing metadata** — selecting an OpenAI OAuth model directly in `relay-ai claude-app`, instead of through Favorites, no longer drops `authType`, `oauthAccountId`, or model reasoning metadata while building the local gateway catalog. This keeps GPT-5.5 and other ChatGPT OAuth models routed through the ChatGPT Codex backend instead of the public OpenAI API. Reported by @lffzdd ([#15](https://github.com/jacob-bd/relay-ai/issues/15)).

- **New OpenAI models newer than GPT-5.5 (e.g. GPT-5.6 Sol/Terra/Luna) could fail outright when using a direct API key** — a hardcoded list of "which models require OpenAI's Responses API" only named GPT-5.4 and GPT-5.5 specifically, so any newer model silently fell back to the older Chat Completions endpoint, which OpenAI rejects for these models. Every OpenAI model now defaults to the Responses API (a strict superset of Chat Completions), so this no longer needs a code update for each new model release. Reported by @tonyb760 ([#17](https://github.com/jacob-bd/relay-ai/issues/17)).

- **Refreshing an OAuth-based provider's model list could silently hide newly released models with no indication anything was wrong** — if live model discovery failed for a ChatGPT- or SuperGrok-authenticated provider, the refresh silently overwrote your existing (possibly more current) cached model list with an older, built-in fallback list, and reported success regardless. Refreshing now keeps your existing cached list when live discovery fails, and clearly reports the failure and its cause instead of failing silently.

- **xAI OAuth-authenticated providers failed to refresh their model list** — the model-refresh command didn't recognize the `xai-oauth` provider template, so refreshing a Grok OAuth provider's model catalog threw an "unsupported template" error instead of updating it.

- **Anonymous/free-access providers (e.g. Kilo Code) failed with "No credential" in Codex CLI, Codex Desktop, and Claude Desktop** — the shared credential-resolution logic that already correctly handled these providers in `relay-ai claude`/`gemini`/`agy` had drifted out of sync in three other launch paths, which still required a real API key even for providers designed to work without one.

- **Non-streaming requests to OpenAI's ChatGPT/Codex OAuth backend failed with a confusing "Stream must be set to true" error** — that backend requires streaming for every request, but a non-streaming retry (e.g. after a transient upstream error) was still forwarded as-is. relay-ai now always streams internally for that backend and assembles a complete response itself, regardless of what the client requested.

- **xAI's `grok-4.5` wasn't recognized as a reasoning-effort model** — the hardcoded model-name check only matched `grok-4.3`, so newer Grok models silently lost the ability to control reasoning effort.

- **Reasoning effort was silently dropped for xAI models launched through Favorites/model-switching** — the effort-application code looked at the gateway's local alias id instead of the real upstream model id, so the setting never applied whenever a model was chosen via the switch-menu/favorites catalog rather than a direct launch.

- **xAI context window sizing used a stale, hardcoded model-name pattern instead of live data** — newer Grok models (e.g. `grok-4.5`, `grok-4.20`) weren't recognized by the old pattern match, causing incorrect context-window sizing and premature or mistimed compaction.

- **DeepSeek tool calls could leak as raw text instead of firing** — DeepSeek's "DSML" tool-call markup sometimes came through the Codex App path unparsed, showing up as garbled text in the response instead of executing the intended tool call.

- **Upstream streams that died silently could hang a request forever** — if an upstream provider connection stopped sending data without an error or a clean end, the request had no timeout and would hang indefinitely; stream errors also weren't being recorded to `--trace` output.

- **Windows Credential Manager silently failed to save long OAuth tokens** — Windows' underlying credential store has a roughly 1,280-character limit per entry, so longer tokens (e.g. some OpenAI OAuth JWTs) failed to save without any visible error.

- **GitHub Copilot model listing was broken** — the provider hit the wrong API endpoint and was missing a required header, so its model catalog couldn't be fetched even with a valid Copilot subscription.

### Known limitations

- **Very large pre-existing Codex App sessions may still fail relay-model compaction** — sessions that already grew under native GPT-5.5 can exceed a 1 M-token relay model's practical compaction budget when switched to Claude or another relay model. relay-ai now clips oversized text/tool-output blobs and trims as a last resort, but this is best-effort recovery, not a guarantee. The reliable recovery path is to continue or compact once with a native Codex/GPT model when quota is available, or start a fresh relay-model session.

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

- **Codex App: context overflow no longer crashes long sessions** — relay-ai now writes `model_context_window` and `model_auto_compact_token_limit` into `~/.codex/config.toml` at session start. Codex uses these values to trigger auto-compaction before the conversation reaches the model's hard limit, preventing the compaction-fails-at-limit crash that previously broke sessions and made them unrecoverable. Applies to single-provider, favorites, and Vertex AI sessions alike.

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
