# Changelog

## [Unreleased]

### Added
- Route providers through the Vercel AI SDK (`ai` + `@ai-sdk/*`) via a single Anthropic↔SDK adapter (`src/sdk-adapter.ts`, `src/provider-factory.ts`). The SDK owns wire format, endpoint selection, and provider quirks (Gemini `thought_signature`, xAI multi-agent `/responses`, Mistral ordering). All local providers and cloud Zen/Go (openai-format) route through it; Anthropic-format models stay direct passthrough.

### Changed
- Removed the now-dead Gemini-native / OpenAI-Responses / OpenAI-compatible branches from the launch proxy request handler (every provider route goes through the SDK adapter). The hand-rolled translation modules remain only for the `server` command pending its migration.

### Docs
- Document that Claude Code persists launched models to `~/.claude/settings.json` and may cache gateway catalogs — bare `claude` can show opencode-starter aliases after a session.

### Added
- `opencode-starter models` — interactive favorites manager (add/remove, max 10) for mid-session model switching.
- Multi-route catalog proxy (`startProxyCatalog`) — when favorites exist, launch starts a proxy with your starting model plus favorites; Claude Code `/model` shows them via `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`.
- Model picker search (lists >25 models) and paginated browse (15 per page with prev/next).
- Recent models per provider (up to 3) shown at the top of local-provider pickers.
- Shared modules: `src/catalog.ts`, `src/favorites.ts`, `src/provider-catalog.ts`, `src/upstream-forward.ts`.

### Changed
- Cloud and local-provider favorites can be mixed in the switch menu; routes resolve per provider (Zen, Go, or local).
- Favorites manager saves once on Done instead of after every add/remove.
- Server router and proxy share upstream forwarding helpers from `src/upstream-forward.ts`.

## [0.3.0] - 2026-06-05

### Added
- Local OpenCode provider discovery — pick Groq, Mistral, xAI, Anthropic-direct, Ollama, Google/Gemini, OpenAI, and other configured providers at launch.
- Gemini native API translation (`src/proxy-gemini.ts`) — full thinking mode and correct `thought_signature` round-trips on tool calls.
- OpenAI Responses API routing (`src/proxy-responses.ts`) for GPT-5.4+, GPT-5.5, Codex, and o-series when using a local OpenAI provider.
- Mistral message-order normalization (`src/mistral-messages.ts`) for tool-heavy sessions.
- Tool-search beta passthrough for local proxy sessions.
- Accurate `context_window` in synthetic `/v1/models` responses for Claude Code's status bar.
- Server mode includes local-provider models with per-model routing; `GET /models` strips `apiKey` from output.

### Fixed
- `thought_signature` preserved through Anthropic ↔ OpenAI and Anthropic ↔ Gemini native round-trips.
- `prompt_cache_key` removed from OpenAI translation output (rejected by Google, Groq, Mistral).
- Gemini tool schema sanitization (allow-list, `required[]` filtering, exclusive min/max stripping).
- Shell injection hardening in API key save paths (macOS profile quoting, Windows `setx` arg array).
- Server streaming for openai-format models; empty `completionsUrl` guard; apiKey exposure on `/models`.

## [0.2.5] - 2026-06-05

- Fix: Pass `X-API-Key` headers to upstream servers for paid Anthropic-format models.
- Fix: Blacklist deprecated MiMo models `mimo-v2-pro` and `mimo-v2-omni` to prevent runtime failures.

## [0.2.4] - 2026-06-05

- Fix: Server network mode now displays the actual local LAN IP address instead of the `<this-computer-ip>` placeholder.
- Fix: Server password prompt now shows input in plaintext so users can verify what they typed before confirming.
- Fix: Server network mode startup output now shows the actual server password so users can share/copy it.

## [0.2.3] - 2026-06-05

- Fix: The `opencode-starter server` command now automatically resolves/loads the API key from the OS credential store (Keyring/Keychain/Credential Manager) if it's not exported in the shell environment.
- Docs: Added instructions to the `README.md` on how to upgrade the package.

## [0.2.2] - 2026-06-05

- Simplified dry-run key-save logging in `resolveOrCollectApiKey` — replaced a 7-branch `if-else` chain with a `Record<SaveChoice, string>` lookup table. No behavioral change.

## [0.2.1]

- Changed the Claude Code launch path to the `opencode-starter claude` command namespace. Bare `opencode-starter` now prints help and migration guidance instead of launching Claude Code.
- Preserved passthrough Claude Code args after `claude`, including `-c`, `--resume <session-id>`, session IDs, and args after `--`.
- Added foreground `opencode-starter server` mode for local or LAN API gateway use.
- Added Anthropic-compatible and limited OpenAI-compatible server endpoints.
- Moved app preferences and model cache to `~/.opencode-starter/config.json`.
- Added one-time migration from the previous OS-native config path.
- Added opt-in saved server password support for network server mode.
- Updated documentation with the supported tools command table, Claude examples, dry-run/setup/trace placement, and migration note.
- Added MIT license file.
