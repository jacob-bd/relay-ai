# opencode-starter

> A launcher toolkit for AI coding tools powered by [OpenCode](https://opencode.ai) backends.

opencode-starter is an interactive CLI wizard that configures and launches AI coding tools — starting with Claude Code — using OpenCode Zen or Go as the API backend. Built to be extensible: future tools (Codex, Aider, and others) will be added over time.

## Features

- **Backend selector** — choose OpenCode Zen (66+ models, free tier) or OpenCode Go (17 models, subscription)
- **Subscription-aware** — tells the wizard what you have access to (free / Zen / Go / both), filters models accordingly
- **Free models highlighted** — green `(free)` label makes it easy to spot zero-cost options
- **Protocol transparency** — models that use server-side translation are labeled `(translated)` so you know what you're picking
- **Clean environment isolation** — removes conflicting env vars (Vertex AI, Bedrock, AWS, Foundry) before launch; **never modifies `~/.claude/settings.json`**
- **Secure key storage** — stores your API key in the OS credential store (macOS Keychain, Windows Credential Manager, Linux Secret Service) or your shell profile — your choice
- **Cross-platform** — macOS, Windows, and Linux (Ubuntu, Fedora, and other distros with GNOME Keyring or KWallet)
- **Dry run mode** — preview exactly what would be run without launching anything
- **Preference memory** — remembers your last backend and model, pre-selects them next time

## Supported tools

| Tool | Status |
|------|--------|
| Claude Code | ✅ Supported |
| Codex | 🔜 Planned |

## Prerequisites

- Node.js 18+
- One of the supported AI coding tools installed (e.g. [Claude Code](https://www.npmjs.com/package/@anthropic-ai/claude-code))
- An [OpenCode API key](https://opencode.ai/settings/keys)

## Installation

```bash
npm install -g opencode-starter
```

## Setup

Get your API key at [opencode.ai/settings/keys](https://opencode.ai/settings/keys).

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
opencode-starter
```

On first run, the wizard asks about your OpenCode subscription so it can show the right models. This is saved and skipped on subsequent runs.

### Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Run the full wizard but preview the launch command instead of executing |
| `--setup` | Re-configure your subscription tier |
| `--help` | Show usage |
| `--version` | Show version |

Pass extra flags to the underlying tool after `--`:

```bash
opencode-starter -- --print "hello"
opencode-starter -- --dangerously-skip-permissions
opencode-starter --dry-run -- --print "test"
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

Run `opencode-starter --setup` at any time to change your tier.

### Environment isolation

When launched, opencode-starter builds a clean child environment:

1. Removes 17 conflicting env vars from the child process (Vertex AI, Bedrock, AWS, Foundry, stale Anthropic config)
2. Sets `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_MODEL` for the session
3. Passes `--model <selected>` to the tool as a belt-and-suspenders override

When the tool exits — for any reason (normal exit, Ctrl+C, terminal close) — everything returns to your normal environment. **No cleanup step, no restore needed.**

### Model compatibility

OpenCode Zen and Go expose all models via the Anthropic Messages API (`/v1/messages`), with protocol translation handled server-side. Models are labeled:

- **No label** — natively Anthropic protocol (Claude, Qwen Plus, MiniMax M3)
- **(translated)** — protocol translated by OpenCode (DeepSeek, GLM, Kimi, GPT, Gemini, etc.)

For translated models, `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` is automatically set to prevent beta header rejection from the translation layer.

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

Your last backend and model selection are saved to `~/.config/opencode-starter/config.json` and pre-selected as defaults on the next run.

## Contributing

This project is in private beta. Contributions and feedback welcome — open an issue or PR on GitHub.

## License

MIT
