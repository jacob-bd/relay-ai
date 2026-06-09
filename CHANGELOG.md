# Changelog

## [Unreleased]

## [1.0.0] - 2026-06-09

### Changed
- **Rebrand:** `opencode-starter` → **`relay-ai`**. CLI command, config dir (`~/.relay-ai/`), and env override (`RELAY_AI_HOME`) updated throughout.
- Migrates existing config from `~/.opencode-starter/` and legacy credential-store entries on first run.

### Added
- `relay-ai server --vertex` — Anthropic-compatible gateway to Claude on Google Vertex AI using local gcloud ADC.

## [0.3.0] - 2026-06-07

### Added
- Local OpenCode provider discovery — launch Claude Code with any provider configured in OpenCode: Groq, Mistral, xAI, Google/Gemini, OpenAI, Anthropic-direct, Ollama, OpenRouter, Cerebras, Perplexity, Bedrock, Vertex, and more. Includes full Gemini thinking + tool calls, OpenAI Responses-API models (GPT-5.4+, GPT-5.5, Codex, o-series), and Mistral.
- Bundled OpenCode SDK provider packages (Cerebras, Perplexity, Bedrock, Vertex, Azure, Together AI, DeepInfra, Alibaba, GitLab, Venice, and others) so any provider configured in OpenCode resolves at runtime without extra installs.
- `relay-ai models` — interactive favorites manager (up to 20 models) for mid-session switching. With favorites set, Claude Code's `/model` switches live between your starting model and your favorites.
- Model picker search and paginated browse for large catalogs; recent models per provider shown at the top of pickers.
- Accurate `context_window` in synthetic `/v1/models` responses so Claude Code's status bar shows real remaining context.
- `relay-ai server` exposes local-provider models with per-model routing; `GET /models` never returns API keys.

### Changed
- All providers route through a single Vercel AI SDK adapter (`ai` + `@ai-sdk/*`), which owns wire format, endpoint selection, and provider quirks (Gemini `thought_signature`, xAI multi-agent `/responses`, Mistral message ordering). Both the `claude` launch proxy and the `server` command use it; Anthropic-format models remain direct passthrough.
- Local provider discovery trusts OpenCode's `api.npm` — removed the static SDK allowlist; any configured provider appears in the picker and routes through the SDK adapter (except `@ai-sdk/anthropic` passthrough and `@ai-sdk/openai-compatible` without a base URL).
- `createLanguageModel` is async and dynamically imports the `create*` factory from whatever npm package OpenCode assigns.

### Fixed
- Local OpenAI providers: use OpenCode's `api.id` as the upstream model ID so catalog aliases (e.g. `gpt-5.5-fast` → `gpt-5.5`) don't hit `model_not_found` on the OpenAI API.
- GPT-5.5 multi-turn reasoning: round-trip encrypted reasoning content via the Responses API without leaking SDK warnings into the Claude Code TUI.

### Docs
- Note that Claude Code persists launched models to `~/.claude/settings.json` and may cache gateway catalogs — bare `claude` can show relay-ai aliases after a session.
- Updated README and CLAUDE.md for SDK adapter proxy naming, OpenCode-trusted discovery, `upstreamModelId`, and provider compatibility.

## [0.2.5] - 2026-06-05

- Fix: Pass `X-API-Key` headers to upstream servers for paid Anthropic-format models.
- Fix: Blacklist deprecated MiMo models `mimo-v2-pro` and `mimo-v2-omni` to prevent runtime failures.

## [0.2.4] - 2026-06-05

- Fix: Server network mode now displays the actual local LAN IP address instead of the `<this-computer-ip>` placeholder.
- Fix: Server password prompt now shows input in plaintext so users can verify what they typed before confirming.
- Fix: Server network mode startup output now shows the actual server password so users can share/copy it.

## [0.2.3] - 2026-06-05

- Fix: The `relay-ai server` command now automatically resolves/loads the API key from the OS credential store (Keyring/Keychain/Credential Manager) if it's not exported in the shell environment.
- Docs: Added instructions to the `README.md` on how to upgrade the package.

## [0.2.2] - 2026-06-05

- Simplified dry-run key-save logging in `resolveOrCollectApiKey` — replaced a 7-branch `if-else` chain with a `Record<SaveChoice, string>` lookup table. No behavioral change.

## [0.2.1]

- Changed the Claude Code launch path to the `relay-ai claude` command namespace. Bare `relay-ai` now prints help and migration guidance instead of launching Claude Code.
- Preserved passthrough Claude Code args after `claude`, including `-c`, `--resume <session-id>`, session IDs, and args after `--`.
- Added foreground `relay-ai server` mode for local or LAN API gateway use.
- Added Anthropic-compatible and limited OpenAI-compatible server endpoints.
- Moved app preferences and model cache to `~/.relay-ai/config.json`.
- Added one-time migration from the previous OS-native config path.
- Added opt-in saved server password support for network server mode.
- Updated documentation with the supported tools command table, Claude examples, dry-run/setup/trace placement, and migration note.
- Added MIT license file.
