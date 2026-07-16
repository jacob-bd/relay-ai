# Codex with relay-ai

Use **OpenAI Codex** (terminal CLI or desktop app) with models from your relay-ai registry — Anthropic, xAI, Google Gemini, Nvidia, DeepSeek, OpenAI, and more.

| Command | What it launches | Config target |
|---------|------------------|---------------|
| **`relay-ai codex`** | Codex **terminal** (TUI) | Temporary sidecar profile — never touches your main Codex config |
| **`relay-ai codex-app`** | Codex **desktop app** (macOS / Windows) | Patches `~/.codex/config.toml` with backup; restored on Ctrl+C |

Both commands use the same registry (`~/.relay-ai/providers.json`) and provider picker. The CLI uses OpenAI directly when possible; the desktop app always uses the local Responses proxy so it can keep Codex's built-in provider identity and preserve history visibility.

**Full flag reference:** `relay-ai codex --help` and `relay-ai codex-app --help`. This guide explains *how it works*, *what files are touched*, and *how to recover*.

**Agent / alef-agent integration** (boot flags, NDJSON, `exec --json`): see **[AI-AGENTS.md](AI-AGENTS.md)** or run `relay-ai --ai`.

---

## Prerequisites

1. **relay-ai** installed on your PATH (`npm install -g @jacobbd/relay-ai`, or built locally with `npm run build && npm link`).
2. **At least one provider** in the registry:
   ```bash
   relay-ai providers add
   # or: relay-ai providers import
   ```
3. **Codex installed:**
   - **CLI:** `npm install -g @openai/codex` (required for `relay-ai codex`)
   - **Desktop app:** [Codex for macOS or Windows](https://developers.openai.com/codex/cli) (required for `relay-ai codex-app`)

**Supported in Codex:** registry providers plus OpenCode Zen/Go cloud backends route through relay-ai's local Responses proxy.

---

## How it works (both commands)

Codex speaks the **OpenAI Responses API** (`POST /v1/responses`). Most registry providers do not. relay-ai bridges the gap:

```
Codex  →  relay-ai Responses proxy (127.0.0.1, Tier 2)  →  Vercel AI SDK  →  Anthropic / xAI / Gemini / …
Codex  →  OpenAI directly (Tier 1, OpenAI only)
```

| Tier | Providers | What relay-ai does |
|------|-----------|-------------------|
| **Tier 1 — Direct** | OpenAI (API key or ChatGPT OAuth) | Points Codex at OpenAI; no local proxy |
| **Tier 2 — Proxy** | Anthropic, xAI, Gemini, Nvidia, DeepSeek, most others | Local HTTP server translates Responses ↔ upstream SDK |

Your real API keys stay in relay-ai (keychain / registry). The proxy holds them in memory for the session.

---

## Codex CLI (`relay-ai codex`)

### Quick start

```bash
relay-ai codex
```

Pick provider → pick model → Codex TUI opens. relay-ai runs:

```bash
codex --profile relay-ai-launch -m <model-id>
```

### relay-ai flags

| Flag | Purpose |
|------|---------|
| *(none)* | Interactive launch |
| `--restore` | Remove leftover relay-ai CLI files after a crash |
| `--config` | Write profile + catalog to disk, print paths, exit (no Codex launch) |
| `--help` | Help text |

relay-ai **manages** `--profile` and `-m` / `--model`. Sandbox defaults to `danger-full-access`; pass other Codex flags directly:

```bash
relay-ai codex -s workspace-write
```

You do **not** need `--` before `-s`.

### Files relay-ai owns (CLI)

| File | Purpose |
|------|---------|
| `~/.codex/relay-ai-launch.config.toml` | Temporary profile for this session |
| `~/.relay-ai/codex/models-<provider>.json` | Model catalog |
| `~/.relay-ai/codex/session.json` | Session lock (one CLI session at a time) |

relay-ai **never edits** `~/.codex/config.toml` for CLI launches. Your personal Codex settings (sandbox, approvals, etc.) stay in that file and still apply.

### Cleanup (CLI)

| Situation | What happens |
|-----------|----------------|
| Normal exit (Codex quits, including Ctrl+C in Codex) | relay-ai removes overlay files automatically |
| Crash / closed terminal / force-quit | Files may remain; next launch auto-recovers when possible |
| Manual cleanup | `relay-ai codex --restore` |

You’ll see a **Cleanup** note before launch and a short message after exit.

### What relay-ai injects (CLI)

| Variable | When | Why |
|----------|------|-----|
| `RELAY_AI_CODEX_KEY=proxy-local` | Tier 2 only | Placeholder so Codex hits the local proxy; real key stays in the proxy |
| `OPENAI_API_KEY` (etc.) | Tier 1 OpenAI | Codex calls OpenAI natively |

relay-ai **strips CI-related env vars** (`CI`, `CODEX_CI`, `GITHUB_ACTIONS`, …) before spawning Codex so IDE terminals don’t accidentally force read-only CI mode.

**Not from relay-ai:** `CODEX_SANDBOX`, `CODEX_SANDBOX_NETWORK_DISABLED`, etc. — those are set by Codex when it runs shell commands. `RELAY_AI_CODEX_KEY` does **not** control sandbox policy.

### Sandbox and network (CLI)

Two layers people confuse:

1. **Codex’s sandbox** — shell commands inside Codex (files, network, approvals). Lives in `~/.codex/config.toml` and Codex CLI flags.
2. **relay-ai’s proxy** — model API traffic only.

**relay-ai codex defaults to `danger-full-access`** — the launch profile and spawn args both set it so shell tools (`curl`, `nlm`, npm, MCP CLIs) can reach the network without you passing `-s` every time. Override for one session:

```bash
relay-ai codex -s workspace-write
```

relay-ai **does not** edit your personal `~/.codex/config.toml` for CLI launches. To change sandbox for bare `codex` (without relay-ai), edit that file yourself:

```toml
sandbox = "danger-full-access"
ask_for_approval = "never"

[shell_environment_policy]
inherit = "all"
```

On macOS, profile TOML alone may not be enough; relay-ai also passes `-s danger-full-access` on spawn ([Codex #10390](https://github.com/openai/codex/issues/10390)).

---

## Codex desktop app (`relay-ai codex-app`)

### Quick start

```bash
relay-ai codex-app
```

Pick provider → pick model → Codex **app** opens. **Keep the relay-ai terminal open** until you’re done (the app always uses the foreground proxy). Press **Ctrl+C** to stop the proxy and restore your previous Codex config.

**Platforms:** macOS and Windows. Linux is not supported (no Codex desktop app).

### relay-ai flags

| Flag | Purpose |
|------|---------|
| *(none)* | Interactive launch + open app |
| `--restore` | Restore `config.toml` and remove relay-ai app files |
| `--config` | **Preview only** — print TOML that would be written; no disk writes, no app, no proxy |
| `--help` | Help text |

**`--config` note:** Skips the picker. Uses your last Codex provider/model from prefs (or the first compatible provider). The proxy port shown (`54321`) is a **placeholder**; a real launch uses a random port.

### Files relay-ai owns (App)

| File | Purpose |
|------|---------|
| `~/.codex/config.toml` | **Patched while session is active** — restored on Ctrl+C or `--restore` |
| `~/.relay-ai/codex/app-models-<provider>.json` | Model catalog (all routable models for that provider) |
| `~/.relay-ai/codex/session-app.json` | App session lock |
| `~/.relay-ai/codex/app-restore-state.json` | Snapshot of your pre-session root keys (for surgical restore) |
| `~/.relay-ai/codex/backups/config.toml.*.bak` | Rotating file backups before each patch |

CLI files (`relay-ai-launch.config.toml`, `session.json`, `models-*.json`) are **separate**. Running CLI after app (or vice versa) should not break the other.

### What gets written to `config.toml`

Example:

```toml
model = "claude-sonnet-4-6"
model_provider = "openai"
openai_base_url = "http://127.0.0.1:<random-port>/v1"
model_catalog_json = "/Users/you/.relay-ai/codex/app-models-anthropic.json"
model_context_window = 1000000
model_auto_compact_token_limit = 700000
```

`model_context_window` tells Codex the model's actual context limit. `model_auto_compact_token_limit` (set to 70% of the limit) tells Codex when to trigger auto-compaction, leaving enough headroom for the compaction request itself to succeed. Both fields are removed on restore.

The app deliberately keeps `model_provider = "openai"` and redirects the built-in provider with `openai_base_url`. Codex records the provider on every local thread and filters its history by provider; using a separate custom provider would hide existing OpenAI/ChatGPT threads while a relay-ai session is active. No conversations are deleted.

The catalog `display_name` uses human-readable labels (e.g. `Claude Haiku 4.5`).

### Cleanup (App)

| Situation | What to do |
|-----------|--------------|
| Normal end of session | **Ctrl+C** in the relay-ai terminal → config restored, proxy stopped |
| Codex already running | relay-ai asks to **restart Codex** so new settings apply; you can decline and reopen manually |
| Crash / killed terminal | Next launch auto-recovers when possible, or `relay-ai codex-app --restore` |
| Live session still running | `--restore` refuses until you Ctrl+C the other terminal |

### App vs CLI — config safety

| | CLI | App |
|--|-----|-----|
| Touches `~/.codex/config.toml`? | **Never** | Yes, with backup + restore |
| Proxy lifetime | Until Codex CLI exits | Until **Ctrl+C** in relay-ai terminal |
| Picker every launch? | Yes (prefs pre-highlight last choice) | Yes |

---

## Favorites catalog mode

When you have saved favorites via `relay-ai models`, both `relay-ai codex` and `relay-ai codex-app` will show your starting model + favorites in the mid-session model picker. Zen/Go favorites are included when an OpenCode API key is available.

### Slug policy

- **CLI** (`relay-ai codex`): slugs are `${providerId}__${modelId}` so models from different providers never collide.
- **App** (`relay-ai codex-app`): single-provider catalogs use bare model ids; favorites use the same `${providerId}__${modelId}` collision-safe form as the CLI.

### Authentication

For CLI favorites, the launched Codex child gets `OPENAI_API_KEY=proxy-local`, not your real upstream key. For the desktop app, Codex keeps its normal OpenAI login while `openai_base_url` points requests at the local proxy. In both cases, the proxy holds the real upstream credentials.

### Reasoning effort

The reasoning-effort slider in the Codex picker is shown only for models with a resolver-backed controllable reasoning profile. OpenRouter uses provider metadata (`supported_parameters`) when available; generic `@ai-sdk/openai-compatible` providers stay hidden unless relay-ai has a verified provider rule.

### Proxy warm-up

With 20 favorites spanning many providers, the first request after launch may be slow as the proxy initializes one `LanguageModel` per favorite. This is a known characteristic; subsequent requests are fast.

---

## Provider routing

| Provider | CLI route | App route | Notes |
|----------|-----------|-----------|-------|
| **OpenAI** | Tier 1 direct | Local proxy | `relay-ai providers auth openai` for ChatGPT OAuth |
| **Anthropic, xAI, Gemini, Nvidia, DeepSeek, …** | Tier 2 proxy | Local proxy | SDK translation path |
| **OpenCode Zen / Go** | Tier 2 proxy | Local proxy | Requires an OpenCode API key |

Add providers with `relay-ai providers add` or import from OpenCode.

---

## OAuth

Tokens (e.g. xAI, OpenAI OAuth) refresh at **launch only**. Long sessions may return 401 when a token expires. Restart `relay-ai codex` or `relay-ai codex-app`.

---

## Reasoning effort

Codex exposes a **reasoning effort** picker when relay-ai's model catalog includes supported levels. relay-ai fills `supported_reasoning_levels`, `default_reasoning_level`, and `supports_reasoning_summaries` from the centralized reasoning resolver, using provider metadata first and provider-specific rules second.

**You control effort in Codex's native UI** — relay-ai does not add its own menu. For `relay-ai codex-app`, an existing `model_reasoning_effort` in `~/.codex/config.toml` is **preserved** (not deleted on launch).

### Supported models (best-effort)

| Provider npm | Example models | Picker levels | Wire mapping |
|--------------|----------------|---------------|--------------|
| `@ai-sdk/anthropic` | claude-sonnet-4-6, claude-opus-4-6 | low, medium, high | SDK `thinking: adaptive` + `effort` |
| `@ai-sdk/openai` | gpt-5.5, gpt-5.4-codex | low, medium, high, xhigh | `reasoningEffort` on Responses API |
| `@ai-sdk/google` | gemini-2.5-pro, gemini-3-flash | low, medium, high | Gemini 2.5 → token budget; Gemini 3 → `thinkingLevel` |
| `@ai-sdk/mistral` | mistral-large, magistral-* | **high, off only** | `reasoningEffort: high \| none` |
| `@ai-sdk/xai` | grok-* | none, low, medium, high | `reasoningEffort` |
| `@openrouter/ai-sdk-provider` | z-ai/glm-5.2, provider models with `reasoning` in `supported_parameters` | none, minimal, low, medium, high, xhigh | `providerOptions.openrouter.reasoning.effort` |
| `@ai-sdk/openai-compatible` | unknown backends | *(picker hidden)* | no effort sent |

**Partial support:** Mistral only supports on/off — relay-ai shows `high` and `off`, not low/medium. Gemini 2.5 uses token budgets under the hood; the picker labels are low/medium/high for UX consistency.

**Local providers:** Same heuristics apply. Unrecognized models (e.g. Ollama `llama3:8b`) get an empty picker — best-effort, no v1 guarantee.

**Claude Code / Desktop gateway:** `relay-ai claude` and `relay-ai server` map Claude Code's `/effort` (`output_config.effort`) to the same SDK options. Anthropic direct passthrough routes forward effort unchanged.

---

## Troubleshooting

### CLI (`relay-ai codex`)

| Symptom | Fix |
|---------|-----|
| Provider missing in picker | `relay-ai providers add` |
| Leftover files after crash | Next launch auto-cleans, or `relay-ai codex --restore` |
| “Another session running” | Wait or `--restore` |
| Shell tools have no network | Should be default; confirm with `relay-ai codex --config` (profile has `sandbox = "danger-full-access"`) or pass `-s danger-full-access` |
| Read-only / CI behavior | relay-ai strips CI vars; try Terminal.app outside IDE |
| `codex` not found | `npm install -g @openai/codex` |

### App (`relay-ai codex-app`)

| Symptom | Fix |
|---------|-----|
| Existing conversations disappear during a relay-ai session | Update relay-ai. Older releases selected a custom `model_provider`, so Codex filtered the sidebar to relay-ai-only threads. Current releases keep the built-in `openai` provider and preserve normal history visibility. |
| App didn’t open | Open Codex manually once, run `relay-ai codex-app` again |
| Model errors / disconnected | Keep relay-ai terminal open (proxy must run) |
| Stuck on relay-ai settings | `relay-ai codex-app --restore` |
| `--restore` blocked | Ctrl+C the other relay-ai codex-app terminal first |
| Wrong config after test | `--restore`; backups in `~/.relay-ai/codex/backups/` |
| "prompt too long" / session crashes after many turns | The conversation history grew past the model’s context limit. Start a fresh conversation in Codex. relay-ai now sets `model_auto_compact_token_limit` in config.toml to prevent this going forward — see [Context management](#context-management-and-session-architecture). |
| Trying to continue a large GPT-5.5 session on a different model | Codex sends the full conversation history inline; 1 M-token models reject 2 M-token payloads. relay-ai trims the oldest messages automatically, but some early context will be lost. Starting fresh is the cleanest option. |
| Model shows as "Custom" in the Codex UI | Expected — Codex labels all external catalog models as "Custom". The correct model is in use. |

### Shared

| Symptom | Fix |
|---------|-----|
| Anthropic key rejected on `providers add` | Update relay-ai (Bearer vs `x-api-key` fix) |
| Model says relay-ai forced sandbox | Wrong — check Codex sandbox flags, not `RELAY_AI_CODEX_KEY` |
| MCP tools (Context7, chrome-devtools, the built-in browser) fail with `unsupported call: ...` | Update relay-ai — fixed by translating Codex's proprietary namespace-wrapped tool format on both request and response. |
| Image generation (`image_gen`) fails, e.g. `404 Not Found` on `/v1/images/generations` | **Known limitation, no workaround.** `image_gen` calls an OpenAI image backend relay-ai doesn't implement, and most registry models can't generate images regardless. Works normally with Codex's native OpenAI/ChatGPT models. |
| `Fatal error: remote compaction v2 expected exactly one compaction output item` | Update relay-ai — fixed by synthesizing the single `compaction` output item Codex's v2 compaction parser requires (previously the proxy replied with a normal message, which Codex rejected outright). |

---

## Context management and session architecture

### How Codex handles conversation history

Codex App is a **stateless client**: it sends the full accumulated conversation history with every single request to the proxy. There is no server-side reference system in use — the `previous_response_id` field in the Responses API spec is not implemented in the Codex App binary. Every turn sends all prior turns.

This means:

- Each request grows larger as the conversation continues (~one new message pair per turn).
- A session that ran for hundreds of turns with GPT-5.5 (which OpenAI manages server-side on their infrastructure) cannot be resumed transparently on a different model via relay-ai — the full local history is sent inline, and 1 M-token models will reject a 2 M-token payload.
- relay-ai has no way to make Codex adopt a different history-referencing approach. This is a fixed architectural property of the Codex App.

### How relay-ai protects against context overflow

relay-ai uses three complementary layers (App only for the first; all three apply to the proxy itself, which both the CLI and the app share):

**1. Early auto-compaction via config.toml (App only)**

At session start, relay-ai writes two fields into `~/.codex/config.toml`:

```toml
model_context_window = 1000000          # the model's actual limit
model_auto_compact_token_limit = 900000  # 90% of the limit
```

Codex reads `model_auto_compact_token_limit` and triggers its built-in compaction before the conversation reaches that threshold. The ratio is intentionally high (90%, not a tighter figure) — a single large tool result (e.g. a browser snapshot can be ~1 MB / ~300K tokens) must not trip auto-compaction after only a couple of turns. Without these fields, Codex either never compacts (for unknown models) or compacts too late, causing the compaction request itself to exceed the model limit. The CLI (`relay-ai codex`) does not write these fields — it launches a temporary sidecar profile rather than patching your `config.toml` — so auto-compact timing there follows the `codex` binary's own defaults or your existing config.

**2. Remote compaction v2 support**

When Codex does trigger compaction, it sends a `{"type":"compaction_trigger"}` request and requires the response to contain **exactly one** output item of type `compaction`, or it fails with `Fatal error: remote compaction v2 expected exactly one compaction output item, got N from M`. relay-ai detects this trigger, asks the model for a plain-text summary, and returns it wrapped as the single `compaction` item Codex expects — then decodes that item back into readable context on later turns, so compaction succeeds instead of crashing the session. This applies to both `relay-ai codex` and `relay-ai codex-app`/`relay-ai chatgpt`.

**3. Proxy-level truncation as a last resort**

If a conversation that already exceeds the safety threshold arrives at the proxy (e.g. after switching from a GPT-5.5 session to a 1 M-limit model mid-way through), relay-ai drops the oldest messages before forwarding — enough to bring the estimated token count below 85% of the model's context window. The session continues in a degraded but functional state rather than crashing.

### "Custom" label in the Codex App model picker

When relay-ai configures Codex to use an external model via `model_catalog_json` and a custom `openai_base_url`, Codex App displays the model with a **"Custom"** label in the UI (e.g. "Custom · Medium"). This is expected Codex App behavior for any model loaded from a catalog that isn't in Codex's built-in provider list. The actual model relay-ai selected is in use — the label is cosmetic.

### Background GPT requests from Codex's internal agent

Codex App has an internal agent subsystem that periodically sends background requests using hardcoded OpenAI model IDs (`gpt-5.4`, `gpt-5.4-mini`, `gpt-5.5`), regardless of what model is configured. relay-ai's proxy silently routes these to the session's starting model. This is intentional — the background agent handles UI state tasks and does not affect your conversation.

---

## See also

- [Codex advanced config](https://developers.openai.com/codex/config-advanced)
- [Codex agent approvals & security](https://developers.openai.com/codex/agent-approvals-security)
- [README — Codex sections](../README.md)
- `relay-ai codex --help` · `relay-ai codex-app --help`
