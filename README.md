# opencode-starter

> A launcher toolkit for AI coding tools powered by [OpenCode](https://opencode.ai) backends.

opencode-starter is an interactive CLI wizard that configures and launches AI coding tools — starting with Claude Code — using OpenCode Zen or Go as the API backend. Built to be extensible: future tools (Codex, Aider, and others) will be added over time.

[![Watch the demo on YouTube](https://img.youtube.com/vi/kyeqlyF4WCQ/maxresdefault.jpg)](https://www.youtube.com/watch?v=kyeqlyF4WCQ)

## Features

- **Backend selector** — choose OpenCode Zen (free tier + subscription) or OpenCode Go (subscription)
- **Subscription-aware** — tells the wizard what you have access to (free / Zen / Go / both), filters models accordingly
- **Free models highlighted** — green `(free)` label makes it easy to spot zero-cost options
- **Built-in translation proxy** — models using OpenAI format are automatically routed through a local translation proxy so Claude Code talks to them in Anthropic format; labeled `(via proxy)` in the list
- **Clean environment isolation** — removes conflicting env vars (Vertex AI, Bedrock, AWS, Foundry) before launch; **never modifies `~/.claude/settings.json`**
- **Secure key storage** — stores your API key in the OS credential store (macOS Keychain, Windows Credential Manager, Linux Secret Service) or your shell profile — your choice
- **Cross-platform** — macOS, Windows, and Linux (Ubuntu, Fedora, and other distros with GNOME Keyring or KWallet)
- **Dry run mode** — preview exactly what would be run without launching anything
- **Preference memory** — remembers your last backend and model, pre-selects them next time

## Supported tools

| Tool | Command | Status |
|------|---------|--------|
| Claude Code | `opencode-starter claude` | ✅ Supported |
| API server | `opencode-starter server` | ✅ Supported |
| Codex | `opencode-starter codex` | 🔜 Planned |

## Prerequisites

- Node.js 18+
- One of the supported AI coding tools installed (e.g. [Claude Code](https://www.npmjs.com/package/@anthropic-ai/claude-code))
- An [OpenCode API key](https://opencode.ai/auth)

## Installation

```bash
# Install globally
npm install -g opencode-starter

# Upgrade to the latest version
npm update -g opencode-starter
```

## Setup

Get your API key at [opencode.ai/auth](https://opencode.ai/auth).

On first run, `opencode-starter` will prompt you for the key and ask where to save it. Options vary by OS:

| Platform | Secure storage | Plaintext fallback |
|----------|---------------|-------------------|
| macOS | Keychain (optional: + `~/.zshrc` auto-load) | Shell profile |
| Windows | Credential Manager | `setx` user env var |
| Linux (desktop) | Secret Service (GNOME Keyring / KWallet) | Shell profile |
| Linux (headless) | — | Shell profile |

The key is always active immediately in the current session regardless of which option you choose. No need to restart your terminal.

## Usage

```bash
opencode-starter claude
```

On first run, the wizard asks about your OpenCode subscription so it can show the right models. This is saved and skipped on subsequent runs.

Bare `opencode-starter` now prints help and migration guidance. It no longer launches Claude Code. Use `opencode-starter claude` for the Claude Code wizard and launcher.

### Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Run the full wizard but preview the launch command instead of executing |
| `--setup` | Re-configure your subscription tier |
| `--trace` | Write Claude Code debug logs to `/tmp/opencode-starter-debug.log` and show errors on exit |
| `--help` | Show usage |
| `--version` | Show version |

Starter flags go after the `claude` command:

```bash
opencode-starter claude --dry-run
opencode-starter claude --setup
opencode-starter claude --trace
```

Claude Code flags and session IDs pass through unchanged:

```bash
opencode-starter claude -c
opencode-starter claude --resume abc-123
opencode-starter claude abc-123
```

Use `--` when you want every following token passed directly to Claude Code:

```bash
opencode-starter claude -- --print "hello"
opencode-starter claude -- --dangerously-skip-permissions
opencode-starter claude --dry-run -- --print "test"
```

## Server mode

Run OpenCode Starter as a foreground API gateway:

```bash
opencode-starter server
```

The server asks whether to listen locally or on the network.

Local mode binds to `127.0.0.1`:

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:17645/anthropic"
export ANTHROPIC_API_KEY="anything"
```

Network mode binds to `0.0.0.0` and asks for a server password:

```bash
export ANTHROPIC_BASE_URL="http://<server-ip>:17645/anthropic"
export ANTHROPIC_API_KEY="<server-password>"
```

By default, the server password is kept in memory only. If you choose to save it, OpenCode Starter stores it in `~/.opencode-starter/config.json`.

The server also exposes OpenAI-compatible endpoints for OpenAI-format models:

```bash
export OPENAI_BASE_URL="http://127.0.0.1:17645/openai/v1"
export OPENAI_API_KEY="anything"
```

## How it works

### Subscription tiers

On first run, opencode-starter asks what you have access to:

| Tier | Backends available | Models shown |
|------|--------------------|--------------|
| Free only | Zen | Free Zen models only |
| Zen subscription | Zen | All Zen models (paid + free) |
| Go subscription | Zen + Go | All Go models + Zen free models |
| Both | Zen + Go | All models on both backends |

Run `opencode-starter claude --setup` at any time to change your tier.

### Environment isolation

When launched, opencode-starter builds a clean child environment:

1. Removes 17 conflicting env vars from the child process (Vertex AI, Bedrock, AWS, Foundry, stale Anthropic config)
2. Sets `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_MODEL` for the session
3. Passes `--model <selected>` to the tool as a belt-and-suspenders override

When the tool exits — for any reason (normal exit, Ctrl+C, terminal close) — everything returns to your normal environment. **No cleanup step, no restore needed.**

### Model compatibility

OpenCode exposes models through different API formats. opencode-starter handles them transparently when possible:

| Model format | Examples | How it works | Label |
|---|---|---|---|
| Anthropic native | Claude, Qwen, MiniMax (Go) | Direct connection | *(none)* |
| OpenAI chat completions | DeepSeek, Kimi, MiMo, GLM, Grok, GPT-4o (local OpenAI) | Local translation proxy → `/v1/chat/completions` | `via proxy` |
| OpenAI Responses API | GPT-5.4+, GPT-5.5, Codex, o-series (local OpenAI only) | Same proxy, auto-routes to `/v1/responses` | `via proxy` |
| Gemini native | Gemini (local Google provider) | Proxy uses Gemini native API, not OpenAI-compat | `via proxy` |
| Not in cloud wizard | GPT, Gemini on OpenCode Zen/Go | Use local provider instead (OpenAI/Google in OpenCode config) | `not yet supported` |

The translation proxy starts automatically on a random local port for proxy-routed models and stops when Claude Code exits.

### Provider notes

**Mistral (free tier):** API rate limits are tight. Expect HTTP 429 during tool-heavy sessions; Claude Code will retry with backoff. This is Mistral-side throttling, not a proxy bug.

**OpenAI (local provider):** Configure OpenAI in [OpenCode](https://opencode.ai) with your API key, then pick the OpenAI provider at launch. Newer GPT models use OpenAI's Responses API (`/v1/responses`), not chat completions — the proxy picks the endpoint from the model ID. If you see "model not available", check that (1) the model ID exists in your OpenAI account and (2) it isn't a Responses-only model being sent to the wrong endpoint (check `/tmp/opencode-proxy-debug.log` for `openai-responses:` vs `openai:` lines).

`CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` is set for direct (non-proxy) routes only. Local proxy sessions preserve tool-search betas.

### API key storage

opencode-starter uses [`@napi-rs/keyring`](https://www.npmjs.com/package/@napi-rs/keyring) to interface with the OS credential store. On subsequent runs it checks the credential store silently — if a key is found, the wizard skips the key prompt entirely.

| Platform | Credential store | Notes |
|----------|-----------------|-------|
| macOS | macOS Keychain | Optional `~/.zshrc` auto-load line makes the key available system-wide |
| Windows | Windows Credential Manager | `setx` available as a plaintext alternative |
| Linux (desktop) | Secret Service API (GNOME Keyring, KWallet) | Requires a running keyring daemon |
| Linux (headless) | Not available | Falls back to shell profile or session-only |

If the native module fails to load on an unsupported platform, the credential store options are silently skipped and only shell profile / session-only storage is offered.

### Preference persistence

Your last backend, model selection, subscription tier, model cache, and optional saved server password are saved to:

```text
~/.opencode-starter/config.json
```

The OpenCode API key is handled separately by the key storage option you choose during setup.

## Contributing

This project is in private beta. Contributions and feedback welcome — open an issue or PR on GitHub.

## License

MIT
