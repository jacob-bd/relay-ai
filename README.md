# relay-ai

> Relay any model into any coding agent — launch tools, switch providers, and run local API gateways.

[![npm version](https://img.shields.io/npm/v/relay-ai)](https://www.npmjs.com/package/relay-ai)
[![License](https://img.shields.io/npm/l/relay-ai)](https://github.com/jacob-bd/relay-ai/blob/main/LICENSE)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?style=flat-square&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/jacobbd)

**relay-ai** is an interactive CLI wizard that sets up and launches AI coding tools. Today that means Claude Code. Tomorrow we'll add more.

You pick your backend: OpenCode Zen, OpenCode Go, or **OpenCode-configured providers** (the BYOK providers you've already set up in OpenCode: Groq, Mistral, OpenAI, Gemini, Ollama, and others). relay-ai reads that list from OpenCode at launch. It doesn't ship its own model catalog.

[![Watch the demo on YouTube](https://img.youtube.com/vi/kyeqlyF4WCQ/maxresdefault.jpg)](https://www.youtube.com/watch?v=kyeqlyF4WCQ)

## Features

- **Backend selector:** OpenCode Zen (free tier + subscription) or OpenCode Go (subscription)
- **Subscription-aware wizard:** You tell us what you have (free / Zen / Go / both), and we filter the model list
- **Free models highlighted:** Green `(free)` label on zero-cost Zen options
- **SDK adapter proxy:** Non-Anthropic OpenCode providers route through the Vercel AI SDK (same packages OpenCode uses), so Claude Code still speaks Anthropic format. Labeled `(via proxy)` in the picker
- **Clean environment isolation:** We strip 17 conflicting env vars (Vertex AI, Bedrock, AWS, Foundry, stale Anthropic config) from the child process only. We never touch `~/.claude/settings.json` (see caveat below)
- **Secure key storage:** Your OpenCode API key goes in the OS credential store (macOS Keychain, Windows Credential Manager, Linux Secret Service) or your shell profile. Your call
- **Cross-platform:** macOS, Windows, Linux (Ubuntu, Fedora, distros with GNOME Keyring or KWallet)
- **Dry run mode:** Walk through the full wizard and preview the launch command without starting anything
- **Preference memory:** Last backend, provider, and model are pre-selected next time
- **OpenCode provider import:** Any provider you've configured in [OpenCode](https://opencode.ai) shows up automatically. Add Cerebras, Perplexity, Bedrock, or a new provider in OpenCode, and it appears here on the next run
- **Favorite models:** Save up to 20 and switch mid-session with Claude Code's `/model` command
- **Smart model pickers:** Recent models per provider, search for large lists (>25), paginated browse (15 per page)

## Supported tools

| Tool | Command | Status |
|------|---------|--------|
| Claude Code | `relay-ai claude` | ✅ Supported |
| Favorite models | `relay-ai models` | ✅ Supported |
| API server | `relay-ai server` | ✅ Supported |
| Codex | `relay-ai codex` | 🔜 Planned |

## Prerequisites

- Node.js 18+
- A supported AI coding tool installed (e.g. [Claude Code](https://www.npmjs.com/package/@anthropic-ai/claude-code))
- An [OpenCode API key](https://opencode.ai/auth) for Zen/Go cloud backends
- [OpenCode CLI](https://opencode.ai) installed and configured if you want OpenCode-configured providers (optional). That's Groq, Mistral, OpenAI direct, Gemini, Ollama, Cerebras, Perplexity, and anything else you've wired up in OpenCode

**A note on naming:** When we say "OpenCode-configured providers," we mean providers imported from your OpenCode config. That's not the same thing as "I downloaded Llama and I'm running it locally." Ollama can be one of those providers if you've set it up in OpenCode, but most people are pointing at cloud APIs they've configured themselves.

## Installation

```bash
# Install globally
npm install -g relay-ai

# Upgrade to the latest version
npm update -g relay-ai
```

## Setup

Grab your API key at [opencode.ai/auth](https://opencode.ai/auth).

On first run, relay-ai asks for the key and where to save it. Options vary by OS:

| Platform | Secure storage | Plaintext fallback |
|----------|---------------|-------------------|
| macOS | Keychain (optional: + `~/.zshrc` auto-load) | Shell profile |
| Windows | Credential Manager | `setx` user env var |
| Linux (desktop) | Secret Service (GNOME Keyring / KWallet) | Shell profile |
| Linux (headless) | n/a | Shell profile |

The key is active in your current session right away, no matter which option you pick. No terminal restart needed.

## Usage

```bash
relay-ai claude
```

First run: the wizard asks about your OpenCode subscription so it can show the right models. We save that and skip it next time. If you've configured providers in OpenCode, you'll also pick between cloud Zen/Go and an OpenCode-configured provider.

Bare `relay-ai` prints help and migration guidance now. It doesn't launch Claude Code anymore. Use `relay-ai claude` for the wizard.

### Favorite models and mid-session switching

Save the models you bounce between:

```bash
relay-ai models
```

Add up to 20 favorites from Zen, Go, or any OpenCode-configured provider. When you have favorites, `relay-ai claude` starts a multi-route proxy automatically. Claude Code's `/model` command lists your starting model plus favorites. Switch live, no restart.

No favorites? Launch works like before: single model, no switch menu. `--dry-run` ignores saved favorites so you can preview a single-model launch.

### Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Run the full wizard but preview the launch command instead of executing |
| `--setup` | Re-configure your subscription tier |
| `--trace` | Write Claude Code debug logs to `/tmp/relay-ai-debug.log` and show errors on exit |
| `--help` | Show usage |
| `--version` | Show version |

Starter flags go after the `claude` command:

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

Use `--` when you want every following token passed directly to Claude Code:

```bash
relay-ai claude -- --print "hello"
relay-ai claude -- --dangerously-skip-permissions
relay-ai claude --dry-run -- --print "test"
```

## Server mode

> **Claude Desktop (Cowork + Code):** Gateway setup for Desktop's Cowork and Code tabs (not Chat). See [docs/CLAUDE_DESKTOP_SETUP.md](docs/CLAUDE_DESKTOP_SETUP.md).

Run relay-ai as a foreground API gateway:

```bash
relay-ai server
```

The wizard asks where to listen: this machine only, or your network.

**Local mode** binds to `127.0.0.1`:

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:17645/anthropic"
export ANTHROPIC_API_KEY="anything"
```

**Network mode** binds to `0.0.0.0` and asks for a server password:

```bash
export ANTHROPIC_BASE_URL="http://<server-ip>:17645/anthropic"
export ANTHROPIC_API_KEY="<server-password>"
```

By default the server password stays in memory only. If you choose to save it, relay-ai stores it in `~/.relay-ai/config.json`.

The server loads Zen/Go models plus whatever OpenCode-configured providers you've set up (same discovery as `claude`). The spinner tells you how many models came from OpenCode import.

OpenAI-format models also get an OpenAI-compatible endpoint:

```bash
export OPENAI_BASE_URL="http://127.0.0.1:17645/openai/v1"
export OPENAI_API_KEY="anything"
```

## How it works

### Subscription tiers

First run, relay-ai asks what you have access to:

| Tier | Backends available | Models shown |
|------|--------------------|--------------|
| Free only | Zen | Free Zen models only |
| Zen subscription | Zen | All Zen models (paid + free) |
| Go subscription | Zen + Go | All Go models + Zen free models |
| Both | Zen + Go | All models on both backends |

Run `relay-ai claude --setup` anytime to change your tier.

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

**OpenAI (OpenCode-configured provider):** Configure OpenAI in [OpenCode](https://opencode.ai) with your API key, then pick the OpenAI provider at launch. Newer GPT models use OpenAI's Responses API. The SDK picks `responses` vs `chat` from the model ID. OpenCode catalog IDs can differ from API IDs (e.g. `gpt-5.5-fast` maps to upstream `gpt-5.5`). If you see "model not available", check `/tmp/opencode-proxy-debug.log` for the `route=` and `sdk:` lines.

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

### Preference persistence

We save your last backend, provider, model, recent models per provider, favorite models, subscription tier, model cache, and optional server password to:

```text
~/.relay-ai/config.json
```

The OpenCode API key is stored separately, based on what you chose during setup.

## Contributing

Private beta right now. Issues and PRs welcome on GitHub.

## Disclaimer

This project and its creator have **no affiliation** with OpenCode, Anthropic, Claude, Google, or any other vendor named or integrated here. Trademarks belong to their respective owners.

relay-ai was built for **education and research**, and mostly for fun. It routes inference through services you configure yourself (OpenCode Zen/Go, OpenCode-configured providers, and gateways you run locally). Use at your own risk.

## Vibe Coding Alert

Full transparency: this project was vibe coded with AI coding assistants. If you're an experienced developer, you might look at parts of this codebase and wince. That's okay.

The goal was to scratch an itch: launch Claude Code and Claude Desktop (Cowork + Code) against OpenCode backends without fighting env vars, proxies, and model discovery. The code works. It's not corporate polish.

If something makes you cringe, open an issue or PR. Human expertise is irreplaceable. For the tone and spirit of this section, see [notebooklm-mcp-cli](https://github.com/jacob-bd/notebooklm-mcp-cli) on the same GitHub org.

## License

MIT
