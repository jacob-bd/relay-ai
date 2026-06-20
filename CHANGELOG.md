# Changelog

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
