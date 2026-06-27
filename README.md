<p align="center">
  <img src="assets/banner.png" alt="relay-ai banner" width="100%">
</p>

# relay-ai


> Relay any model into any coding agent — launch tools, switch providers, and run local API gateways.

[![npm version](https://img.shields.io/npm/v/@jacobbd/relay-ai)](https://www.npmjs.com/package/@jacobbd/relay-ai)
[![License](https://img.shields.io/npm/l/@jacobbd/relay-ai)](LICENSE)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?style=flat-square&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/jacobbd)

<p align="center">
  <a href="https://youtu.be/IvsUPHLhX0o">
    <img src="assets/demo-part1-thumbnail.png" alt="relay-ai demo — installation, configuration, Claude Code, Claude Cowork & Claude Code Desktop (Part 1)" width="100%">
  </a>
</p>

> **Demo (Part 1):** Installation · Configuration · Claude Code · Claude Cowork · Claude Code Desktop — [watch on YouTube](https://youtu.be/IvsUPHLhX0o)

**relay-ai** is an interactive CLI that launches AI coding tools and runs local API gateways on your machine. Currently, it supports **Claude Code**, **Claude Desktop (Cowork + Code)**, the **OpenAI Codex CLI**, the **Codex desktop app (macOS + Windows)**, **Google Gemini CLI**, and experimental **Antigravity CLI / IDE** support.

Pick your backend:

- **Your providers** — configure once with `relay-ai providers` (Groq, Mistral, Nvidia, DeepSeek, custom OpenAI/Anthropic endpoints, and more)
- **OpenCode Zen / Go** — cloud models with your OpenCode API key (optional; add via `relay-ai providers`)
- **One-time OpenCode import** — bring existing OpenCode provider settings into the registry (`relay-ai providers import`)
- **Google Vertex AI** — Claude on Vertex via `relay-ai server --vertex` and local gcloud credentials (no OpenCode key required)

## Commands

| Command | Description |
|---------|-------------|
| `relay-ai` | Print help (does not launch Claude Code) |
| `relay-ai claude` | Pick a provider → launch Claude Code |
| `relay-ai providers` | Add, import, list, remove, and refresh your AI providers |
| `relay-ai models` | Manage favorite models for mid-session `/model` switching |
| `relay-ai server` | Foreground API gateway (registry providers + optional Zen/Go) |
| `relay-ai server --vertex` | Foreground Anthropic-compatible gateway to Claude on Vertex AI |
| `relay-ai claude-app` | Launch Claude Desktop app with registry providers ([guide](docs/CLAUDE_DESKTOP_SETUP.md)) |
| `relay-ai codex` | Launch OpenAI Codex CLI with registry providers ([guide](docs/CODEX.md)) |
| `relay-ai codex-app` | Launch Codex desktop app with registry providers ([guide](docs/CODEX.md)) |
| `relay-ai gemini` | Launch Google Gemini CLI with registry providers |
| `relay-ai agy` | Launch Antigravity CLI with Relay models ([warning + guide](docs/ANTIGRAVITY.md)) |
| `relay-ai antigravity-ide` | Launch Antigravity IDE with Relay models, macOS ([warning + guide](docs/ANTIGRAVITY.md)) |
| `relay-ai providers auth <id>` | Authenticate an OAuth provider (GitHub Copilot, xAI, OpenAI, Claude Code, Antigravity) |
| `relay-ai --ai` | Full agent reference for scripts and alef-agent ([guide](docs/AI-AGENTS.md)) |

## Features

- **Native provider registry:** `relay-ai providers` stores config in `~/.relay-ai/providers.json` and secrets in the OS keychain — no OpenCode binary required at launch. See **[docs/PROVIDERS.md](docs/PROVIDERS.md)** for a full list of providers and known issues.
- **Provider templates:** Add Groq, Mistral, Together, OpenRouter, and 15+ SDK-backed providers, plus custom OpenAI/Anthropic-compatible endpoints
- **OpenCode import:** One-time migration from OpenCode (`providers import`); validates API keys and skips placeholders like `anything`
- **OpenCode Zen / Go:** Optional cloud backends when you have an OpenCode API key
- **SDK adapter proxy:** Non-Anthropic providers route through the Vercel AI SDK (same packages OpenCode uses), so Claude Code still speaks Anthropic format. Labeled `(via proxy)` in the picker
- **Favorite models:** Save up to 20 and switch mid-session with Claude Code's `/model` command
- **Smart model pickers:** Recent models per provider, search for large lists (>25), paginated browse (15 per page)
- **Refresh model lists:** `relay-ai providers refresh-models` updates cached catalogs per provider
- **API server:** Run a local gateway on port **17645** for Claude Code, Claude Desktop, or any Anthropic-compatible client
- **Server wizard:** Filter exposed providers, mask discovery ids for Claude Desktop, optional favorites-only catalog, local vs network listen mode
- **Vertex gateway:** Anthropic-compatible Claude on Google Vertex AI using gcloud Application Default Credentials
- **Antigravity CLI / IDE support:** Experimental local Cloud Code gateway for Antigravity's native model picker. Read the account warning before using it
- **Clean environment isolation:** We strip 17 conflicting env vars (Vertex AI, Bedrock, AWS, Foundry, stale Anthropic config) from the child process only. We never touch `~/.claude/settings.json` (see caveat below)
- **Secure key storage:** Per-provider keys and the OpenCode API key go in the OS credential store (macOS Keychain, Windows Credential Manager, Linux Secret Service) or your shell profile
- **Cross-platform:** macOS, Windows, Linux (Ubuntu, Fedora, distros with GNOME Keyring or KWallet)
- **Dry run mode:** Walk through the full wizard and preview the launch command without starting anything
- **Preference memory:** Last provider and model are pre-selected next time
- **Agent / headless launch:** Boot flags (`--provider`, `--model`), clean NDJSON/JSONL stdout for alef-agent, and `relay-ai --ai` reference — see **[docs/AI-AGENTS.md](docs/AI-AGENTS.md)**

## Supported tools

| Tool | Command | Status |
|------|---------|--------|
| Provider registry | `relay-ai providers` | ✅ Supported ([guide](docs/PROVIDERS.md)) |
| Claude Code | `relay-ai claude` | ✅ Supported |
| Favorite models | `relay-ai models` | ✅ Supported |
| OpenCode API server | `relay-ai server` | ✅ Supported |
| Vertex API gateway | `relay-ai server --vertex` | ✅ Supported |
| Claude Desktop (Cowork + Code) | `relay-ai claude-app` | ✅ Supported macOS + Windows ([guide](docs/CLAUDE_DESKTOP_SETUP.md)) |
| Codex CLI | `relay-ai codex` | ✅ Supported ([guide](docs/CODEX.md)) |
| Codex desktop app | `relay-ai codex-app` | ✅ Supported macOS + Windows ([guide](docs/CODEX.md)) |
| Google Gemini CLI | `relay-ai gemini` | ⚠️ Experimental, model switching is done via .model prompt |
| Antigravity CLI | `relay-ai agy` | ⚠️ Experimental, use a throwaway Google account ([guide](docs/ANTIGRAVITY.md)) |
| Antigravity IDE | `relay-ai antigravity-ide` | ⚠️ Experimental macOS support, use a throwaway Google account ([guide](docs/ANTIGRAVITY.md)) |
| GitHub Copilot OAuth | `relay-ai providers auth github-copilot` | ✅ Device code flow ([guide](docs/SUBSCRIPTION-OAUTH.md)) |
| xAI SuperGrok OAuth | `relay-ai providers auth xai-oauth` | ✅ Device code flow ([guide](docs/SUBSCRIPTION-OAUTH.md)) |
| OpenAI ChatGPT OAuth | `relay-ai providers auth openai-oauth` | ✅ Device code flow ([guide](docs/SUBSCRIPTION-OAUTH.md)) |
| Claude Code OAuth | `relay-ai providers auth claude-code` | ⛔ Almost certainly violates Anthropic ToS — bans documented ([⚠️ read guide first](docs/SUBSCRIPTION-OAUTH.md)) |
| Antigravity OAuth | `relay-ai providers auth antigravity` | ⛔ Google bans documented — use throwaway account only ([⚠️ read guide first](docs/SUBSCRIPTION-OAUTH.md)) |

## Prerequisites

- Node.js 18+
- A supported AI coding tool installed (e.g. [Claude Code](https://www.npmjs.com/package/@anthropic-ai/claude-code), [OpenAI Codex](https://www.npmjs.com/package/@openai/codex), or [Google Gemini CLI](https://www.npmjs.com/package/@google/gemini-cli))
- At least one provider configured via `relay-ai providers add` or `import` — **or** an [OpenCode API key](https://opencode.ai/auth) for Zen/Go cloud backends
- [OpenCode CLI](https://opencode.ai) only if you want **one-time import** from an existing OpenCode setup (optional)
- For **Vertex gateway:** [Google Cloud SDK](https://cloud.google.com/sdk) with `gcloud auth application-default login`, a GCP project with Vertex AI enabled, and Claude partner models enabled in that project
- For **Antigravity CLI / IDE:** a Google account is still needed for Antigravity authentication. Do **not** use your main Google account. Use a throwaway or secondary account you can afford to lose.
- For **Claude Code OAuth** or **Antigravity OAuth** subscription providers: read **[docs/SUBSCRIPTION-OAUTH.md](docs/SUBSCRIPTION-OAUTH.md)** in full before using. Account bans are a documented risk. relay-ai takes no responsibility.

**A note on providers:** relay-ai keeps your provider list in `~/.relay-ai/providers.json`. You can add providers directly (API key + template), import from OpenCode once, or use Zen/Go cloud backends. OpenCode is not required after setup.

## Installation

To install the CLI globally:

```bash
npm install -g @jacobbd/relay-ai
```

### Upgrading

To upgrade to the latest version:

```bash
npm update -g @jacobbd/relay-ai
```

### Uninstallation

To uninstall the CLI globally:

```bash
npm uninstall -g @jacobbd/relay-ai
```

> [!NOTE]
> If you use a Node version manager like **NVM**, make sure you run the uninstall command using the active Node version that was used to install it (e.g., run `nvm use <version>` first).

To fully remove the tool and all its configuration data, you can delete the configuration directory (`.relay-ai`) on your operating system:

- **macOS / Linux**:
  ```bash
  rm -rf ~/.relay-ai
  ```
- **Windows**:
  - In Command Prompt:
    ```cmd
    rmdir /s /q "%USERPROFILE%\.relay-ai"
    ```
  - In PowerShell:
    ```powershell
    Remove-Item -Recurse -Force "$env:USERPROFILE\.relay-ai"
    ```


## Setup

### Configure providers

```bash
relay-ai providers          # hub: add, import, list, refresh models
relay-ai providers add      # pick a template or custom endpoint
relay-ai providers import   # one-time migration from OpenCode (optional)
```

On first `relay-ai claude` run with an empty registry, an inline wizard walks you through Quick start (Zen), import, or opening `relay-ai providers`.

### OpenCode API key (Zen/Go only)

Grab your key at [opencode.ai/auth](https://opencode.ai/auth) if you use OpenCode Zen or Go (skip for registry-only or Vertex setups).

| Platform | Secure storage | Plaintext fallback |
|----------|---------------|-------------------|
| macOS | Keychain (optional: + `~/.zshrc` auto-load) | Shell profile |
| Windows | Credential Manager | `setx` user env var |
| Linux (desktop) | Secret Service (GNOME Keyring / KWallet) | Shell profile |
| Linux (headless) | n/a | Shell profile |

The key is active in your current session right away, no matter which option you pick. No terminal restart needed.

## Usage

### Launch Claude Code

```bash
relay-ai claude
```

First run: pick a provider from your registry (or complete the inline setup wizard). If you've added OpenCode Zen/Go, those appear alongside registry providers like Groq, Nvidia, or DeepSeek.

#### Favorite models and mid-session switching

Save the models you bounce between:

```bash
relay-ai models
```

Add up to 20 favorites from Zen, Go, or any OpenCode-configured provider. When you have favorites, `relay-ai claude` starts a multi-route proxy automatically. Claude Code's `/model` command lists your starting model plus favorites. Switch live, no restart.

No favorites? Launch works like before: single model, no switch menu. `--dry-run` ignores saved favorites so you can preview a single-model launch.

#### `relay-ai claude` options

| Flag | Description |
|------|-------------|
| `--dry-run` | Run the full wizard but preview the launch command instead of executing |
| `--setup` | Reminder to use `relay-ai providers` for provider setup |
| `--trace` | Write debug logs to `~/.relay-ai/logs/` and show errors on exit |
| `--help` | Show command help |
| `--version` | Show version |

```bash
relay-ai claude --dry-run
relay-ai claude --setup
relay-ai claude --trace
```

Claude Code flags and session IDs pass through unchanged:

```bash
relay-ai claude -c
relay-ai claude --resume abc-123
relay-ai claude abc-123
```

**Non-interactive / agent launch** — skip the wizard with boot flags:

```bash
relay-ai claude --provider groq --model llama-3.3-70b-versatile -p "Summarize README.md"
relay-ai claude --model zen__deepseek-v4-flash-free -p "task" --output-format stream-json
```

| Flag | Description |
|------|-------------|
| `--provider` | Boot provider id (skip wizard with `--model` or in print mode) |
| `--model` | Boot model id, or slug `provider__model-id` |

For alef-agent, NDJSON streaming, Codex `exec --json`, and sandbox defaults, see **[docs/AI-AGENTS.md](docs/AI-AGENTS.md)** and run `relay-ai --ai`.

Use `--` when you want every following token passed directly to Claude Code:

```bash
relay-ai claude -- --print "hello"
relay-ai claude -- --dangerously-skip-permissions
relay-ai claude --dry-run -- --print "test"
```

## Server mode

Run relay-ai as a foreground API gateway on port **17645**:

| Mode | Command | Auth | Models |
|------|---------|------|--------|
| **Registry gateway** | `relay-ai server` | Per-provider keys in registry (+ OpenCode key for Zen/Go if exposed) | Providers you configured |
| **Vertex gateway** | `relay-ai server --vertex` | gcloud Application Default Credentials | Claude on Vertex AI |

> **Claude Desktop (Cowork + Code):** For the automated macOS/Windows setup, use `relay-ai claude-app`. For manual or network setups, see [docs/CLAUDE_DESKTOP_SETUP.md](docs/CLAUDE_DESKTOP_SETUP.md).

### Registry gateway (`relay-ai server`)

Works with any providers in your registry. Zen/Go models appear when you have an OpenCode API key and those providers are exposed.

The wizard asks:

| Prompt | What it does |
|--------|--------------|
| **Configure & start** vs **Start with saved settings** | Full wizard or reuse saved server preferences |
| **Exposed providers** | Limit which providers appear in the catalog (Zen, Go, Groq, OpenAI, etc.) |
| **Mask gateway model ids for discovery?** | Recommended **Yes** for Claude Desktop — hides competitor vendor strings in model ids so discovery works |
| **Expose only favorite models?** | Optional cap at your favorites (manage with `relay-ai models`) |
| **Listen mode** | **Local only** (`127.0.0.1`) or **Network** (`0.0.0.0` + server password) |

**Local mode** — point any Anthropic-compatible client at your machine:

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:17645/anthropic"
export ANTHROPIC_API_KEY="anything"
```

**Network mode** — other devices on your LAN:

```bash
export ANTHROPIC_BASE_URL="http://<server-ip>:17645/anthropic"
export ANTHROPIC_API_KEY="<server-password>"
```

By default the server password stays in memory only. If you choose to save it, relay-ai stores it in `~/.relay-ai/config.json`.

OpenAI-format models also get an OpenAI-compatible endpoint:

```bash
export OPENAI_BASE_URL="http://127.0.0.1:17645/openai/v1"
export OPENAI_API_KEY="anything"
```

Health check:

```bash
curl -s http://127.0.0.1:17645/health
curl -s http://127.0.0.1:17645/anthropic/v1/models | head
```

The spinner reports how many models loaded and how many came from registry providers.

### Vertex gateway (`relay-ai server --vertex`)

Anthropic-compatible gateway to Claude on Google Vertex AI. No OpenCode API key required.

**Setup:**

```bash
gcloud auth application-default login
export ANTHROPIC_VERTEX_PROJECT_ID="your-gcp-project"   # or GOOGLE_CLOUD_PROJECT
export GOOGLE_CLOUD_LOCATION="global"                   # optional; default: global
relay-ai server --vertex
```

**Default models:** `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-haiku-4-5`

**Shorthand aliases** (for Claude Code `/model` and `settings.json`): `sonnet`, `opus`, `haiku`. Append `[1m]` for 1M context on Sonnet and Opus only (Haiku stays 200k).

**Custom catalog:** copy `assets/vertex-models.example.json` to `~/.relay-ai/vertex-models.json` and edit. Override the config directory with `RELAY_AI_HOME`.

When the gateway is running:

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:17645/anthropic"
export ANTHROPIC_API_KEY="anything"
```

**Claude Code tip:** When routing through the gateway, unset native Vertex env vars so Claude Code doesn't bypass the proxy:

```bash
unset CLAUDE_CODE_USE_VERTEX ANTHROPIC_VERTEX_PROJECT_ID CLOUD_ML_REGION
```

## Antigravity CLI and IDE support

Relay AI can launch the Antigravity CLI and Antigravity IDE through a local Cloud Code gateway. This lets Antigravity's native model picker show Relay models from your configured providers.

```bash
relay-ai agy
relay-ai antigravity-ide
```

> ⚠️ **Do not use your main Google account with Antigravity support.**
>
> Antigravity still requires Google authentication before it will run. Relay AI routes Cloud Code generation through your local gateway, but the Antigravity CLI and IDE are still Google software and may contact Google for auth, telemetry, updates, or account checks.
>
> This kind of use is probably not what Google intended, may violate Google's terms of service, and could lead to account restrictions or bans. Use a throwaway Google account, a secondary account, or another account you can afford to lose. A free Google account should be enough for authentication. Seriously, don't risk your real Gmail, Workspace, YouTube, Drive, or business account for this.

Read the full setup and risk notes in **[docs/ANTIGRAVITY.md](docs/ANTIGRAVITY.md)** before launching either Antigravity surface.

## OAuth Providers

relay-ai supports OAuth-based subscription providers — sign in with your existing account rather than managing API keys. See **[docs/SUBSCRIPTION-OAUTH.md](docs/SUBSCRIPTION-OAUTH.md)** for setup and risk information.

### Standard OAuth (lower risk)

Device code flows for existing subscriptions:

```bash
relay-ai providers auth github-copilot   # GitHub Copilot
relay-ai providers auth openai-oauth     # ChatGPT Plus / Pro
relay-ai providers auth xai-oauth        # xAI SuperGrok
```

### ⛔ Subscription Token Extraction (serious account risk)

> **These providers extract OAuth tokens from your paid subscriptions and use them to power other tools. This almost certainly violates the Terms of Service of Anthropic and Google. Account bans are a known, documented consequence. relay-ai and its authors take no responsibility for suspended accounts, lost subscriptions, or any other outcome. You proceed entirely at your own risk.**

```bash
relay-ai providers auth claude-code    # Anthropic Claude Pro / Max
relay-ai providers auth antigravity    # Google Cloud Code Assist
```

**Claude Code OAuth:** Anthropic actively enforces against this usage. Bans and subscription suspensions have been reported. Anthropic took legal action against OpenCode in March 2026 for doing this exact thing.

**Antigravity OAuth:** Google has issued account bans for similar usage. A Google ban is not limited to Cloud Code — it affects Gmail, Drive, YouTube, Workspace, and every service on the account. **⛔ Use a throwaway Google account only. Never your primary Google account.**

Full details, risk disclosure, and technical documentation: **[docs/SUBSCRIPTION-OAUTH.md](docs/SUBSCRIPTION-OAUTH.md)**

### Codex CLI (`relay-ai codex`)

Launch [OpenAI Codex CLI](https://developers.openai.com/codex/cli) with registry providers. Requires `npm install -g @openai/codex`.

```bash
relay-ai providers add    # Anthropic, xAI, OpenAI, etc.
relay-ai codex            # pick provider + model → Codex TUI
```

### Claude Desktop app (`relay-ai claude-app`)

Launch **Claude Desktop** (macOS or Windows) with registry providers:

```bash
relay-ai claude-app
```

This command automates the "Third-Party Inference" (Developer Mode) setup. It temporarily configures Claude Desktop to point at a local gateway, launches the app, and routes traffic to your chosen provider.

- **Keep the terminal open:** The proxy runs in the foreground.
- **Ctrl+C to restore:** When you're done, press `Ctrl+C` in the terminal to automatically restore Claude Desktop to its normal Anthropic cloud mode.
- **Cleanup:** If the terminal crashes, run `relay-ai claude-app --restore`.

For manual network setups (e.g., remote cloud desktop), you can still use `relay-ai server`. See the full [Claude Desktop Setup Guide](docs/CLAUDE_DESKTOP_SETUP.md).

relay-ai writes a **temporary** profile (`~/.codex/relay-ai-launch.config.toml`) and removes it when Codex exits. After a crash: `relay-ai codex --restore`.

**Sandbox / network:** `relay-ai codex` defaults to **`danger-full-access`** (profile + `-s` flag) so shell tools like `curl`, `nlm`, and npm can reach the network. Override for one session:

```bash
relay-ai codex -s workspace-write
```

Pass Codex flags directly after `relay-ai codex` — you do **not** need `--` before `-s`. Codex’s `--dangerously-bypass-approvals-and-sandbox` also passes through if you need it.

Full details: **[docs/CODEX.md](docs/CODEX.md)** — CLI + desktop app, configs, restore, sandbox, routing.

For agent / alef-agent integration (boot flags, NDJSON, JSONL): **[docs/AI-AGENTS.md](docs/AI-AGENTS.md)** and `relay-ai --ai`.

### Codex desktop app (`relay-ai codex-app`)

Launch the **Codex app** (macOS or Windows) with registry providers:

```bash
relay-ai codex-app
```

Patches `~/.codex/config.toml` with backup; **Ctrl+C** in the relay-ai terminal restores your config. The app keeps Codex's built-in `openai` provider active so existing conversation history remains visible, and routes the selected model through a foreground local proxy. Preview config without writing: `relay-ai codex-app --config`. Recovery: `relay-ai codex-app --restore`.

See **[docs/CODEX.md](docs/CODEX.md)** for CLI vs app differences, file ownership, and troubleshooting.

**Reasoning effort:** Capable models show Codex's native reasoning picker (low/medium/high, etc.). relay-ai maps your choice to each provider's SDK options and preserves existing `model_reasoning_effort` in Codex config. Claude Code `/effort` and the `relay-ai server` gateway use the same mapping — see the [reasoning section in docs/CODEX.md](docs/CODEX.md#reasoning-effort).

### Google Gemini CLI (`relay-ai gemini`)

Launch the [Google Gemini CLI](https://www.npmjs.com/package/@google/gemini-cli) with registry providers.

```bash
relay-ai gemini
```

Pick provider → pick model → Gemini prompt loop opens. Non-interactive tasks with streaming NDJSON are also fully supported:

```bash
relay-ai gemini --provider google --model gemini-2.5-flash -p "Review this file" -o stream-json
```

For agent / alef-agent integration (boot flags, NDJSON): **[docs/AI-AGENTS.md](docs/AI-AGENTS.md)** and `relay-ai --ai`.

## How it works

### OpenCode Zen / Go filtering

When OpenCode Zen is in your registry, `subscriptionFilter` controls which Zen models appear (`free` = free tier only; default = all Zen models). Add or change Zen via `relay-ai providers`.

### Environment isolation

When you launch, relay-ai builds a clean child environment:

1. Removes 17 conflicting env vars from the child process (Vertex AI, Bedrock, AWS, Foundry, stale Anthropic config)
2. Sets `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_MODEL` for the session
3. Passes `--model <selected>` to Claude Code as a backup override

When Claude Code exits (normal exit, Ctrl+C, terminal close), your shell is unchanged. No cleanup step. No restore needed.

**Caveat: Claude Code persists the model.** relay-ai doesn't edit `~/.claude/settings.json`, but Claude Code saves the model you launched with (via `--model` and `ANTHROPIC_MODEL`). A later bare `claude` launch may still show that model, e.g. `anthropic-opencode-go__deepseek-v4-flash` from a prior relay-ai session. To get back to a first-party default, run `claude --model sonnet` (or your preferred Claude model), or remove the `"model"` key from `~/.claude/settings.json`. If you used the favorites switch menu, Claude Code may also cache the gateway catalog at `~/.claude/cache/gateway-models.json`. Delete that file if `/model` shows stale entries from a dead proxy.

### Model compatibility

OpenCode exposes models through different API formats. relay-ai handles them when it can:

| Model format | Examples | How it works | Label |
|---|---|---|---|
| Anthropic native | Claude, Qwen, MiniMax (Go) | Direct connection | *(none)* |
| OpenAI chat completions | DeepSeek, Kimi, MiMo, GLM, Grok, GPT-4o (OpenCode OpenAI provider) | SDK adapter proxy (Vercel AI SDK) | `via proxy` |
| OpenAI Responses API | GPT-5.4+, GPT-5.5, Codex, o-series (OpenCode OpenAI provider only) | Same proxy; SDK picks Responses API | `via proxy` |
| Gemini native | Gemini (OpenCode Google provider) | SDK adapter, Gemini native API | `via proxy` |
| Other SDK providers | Cerebras, Perplexity, Bedrock, Vertex, Together AI, etc. | Whatever `api.npm` OpenCode assigns | `via proxy` |
| Not in cloud wizard | GPT, Gemini on OpenCode Zen/Go | Use an OpenCode-configured provider instead (OpenAI/Google in OpenCode config) | `not yet supported` |

The SDK adapter proxy starts on a random local port for proxy-routed models and stops when Claude Code exits. Each `relay-ai claude` session gets its own port, so multiple terminals are fine. (`relay-ai server` uses fixed port `17645`. One server instance per machine.)

### Provider notes

**Mistral (free tier):** Rate limits are tight. Expect HTTP 429 during tool-heavy sessions. Claude Code retries with backoff. That's Mistral throttling, not a proxy bug.

**OpenAI (OpenCode-configured provider):** Configure OpenAI in [OpenCode](https://opencode.ai) with your API key, then pick the OpenAI provider at launch. Newer GPT models use OpenAI's Responses API. The SDK picks `responses` vs `chat` from the model ID. OpenCode catalog IDs can differ from API IDs (e.g. `gpt-5.5-fast` maps to upstream `gpt-5.5`). If you see "model not available", run `relay-ai claude --trace` and check `~/.relay-ai/logs/claude-debug.log`.

`CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` is set for direct (non-proxy) routes only. Proxy sessions keep tool-search betas.

### API key storage

relay-ai uses [`@napi-rs/keyring`](https://www.npmjs.com/package/@napi-rs/keyring) for the OS credential store. On later runs it checks silently. Key found? Wizard skips the prompt.

| Platform | Credential store | Notes |
|----------|-----------------|-------|
| macOS | macOS Keychain | Optional `~/.zshrc` auto-load line for system-wide availability |
| Windows | Windows Credential Manager | `setx` available as plaintext alternative |
| Linux (desktop) | Secret Service API (GNOME Keyring, KWallet) | Needs a running keyring daemon |
| Linux (headless) | Not available | Falls back to shell profile or session-only |

If the native module fails to load, credential store options are skipped and you get shell profile / session-only storage.

## Configuration

**Provider registry** (no secrets in this file):

```text
~/.relay-ai/providers.json
```

Manage with `relay-ai providers`. API keys are stored in the OS keychain (`keyring:provider:<id>`).

**App preferences** — favorites, last provider/model, server settings, optional server password:

```text
~/.relay-ai/config.json
```

Override the config directory:

```bash
export RELAY_AI_HOME="/path/to/your/relay-ai-home"
```

The OpenCode API key (for Zen/Go) and per-provider keys are stored separately, based on what you chose during setup (Keychain, credential store, or shell profile).

## Troubleshooting

See **[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)** for common issues — especially **“Not logged in”** after accidentally choosing **No** on Claude Code’s custom API key prompt.

## Upgrading from opencode-starter

If you used the old **opencode-starter** CLI, relay-ai migrates automatically on first run:

- Config moves from `~/.opencode-starter/` → `~/.relay-ai/`
- Legacy Keychain / credential-store entries are read and re-saved under `relay-ai`
- The CLI command is now `relay-ai` (not `opencode-starter`)
- Launch Claude Code with `relay-ai claude` (bare `relay-ai` prints help)

The deprecated `OPENCODE_STARTER_HOME` env var still works as a fallback for `RELAY_AI_HOME`.

## Contributing

Private beta right now. Issues and PRs welcome on GitHub.

## Disclaimer

This project and its creator have **no affiliation** with OpenCode, Anthropic, Claude, Google, GitHub, OpenAI, xAI, or any other vendor named or integrated here. Trademarks belong to their respective owners.

relay-ai was built for **education and research**, and mostly for fun. It routes inference through services you configure yourself (OpenCode Zen/Go, OpenCode-configured providers, Vertex AI, and gateways you run locally). Use at your own risk.

**Regarding subscription OAuth providers (Claude Code, Antigravity):** These features extract OAuth tokens from paid subscriptions in ways the service providers did not intend. Using them almost certainly violates the Terms of Service of Anthropic and Google. relay-ai and its authors take **no responsibility whatsoever** for:

- Account suspensions, bans, or terminations by Anthropic, Google, or any other provider
- Loss of paid subscriptions (Claude Pro / Max, Google One AI, etc.)
- Loss of access to services tied to a banned account (Gmail, Drive, YouTube, Workspace, etc.)
- Legal action by service providers
- Any other consequence of using these features

By using the `claude-code` or `antigravity` OAuth providers, you accept sole responsibility for all consequences.

## Vibe Coding Alert

Full transparency: this project was vibe coded with AI coding assistants. If you're an experienced developer, you might look at parts of this codebase and wince. That's okay.

The goal was to scratch an itch: launch Claude Code and Claude Desktop (Cowork + Code) against OpenCode backends and Vertex without fighting env vars, proxies, and model discovery. The code works. It's not corporate polish.

If something makes you cringe, open an issue or PR. Human expertise is irreplaceable. For the tone and spirit of this section, see [notebooklm-mcp-cli](https://github.com/jacob-bd/notebooklm-mcp-cli) on the same GitHub org.

## License

MIT
