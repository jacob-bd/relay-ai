# Antigravity CLI, app, and IDE

Relay AI launches Google's Antigravity CLI (`agy`), the standalone Antigravity app, and the Antigravity IDE against a local Cloud Code gateway, so Antigravity's own model picker lists models from your Relay providers.

```bash
relay-ai agy              # Antigravity CLI
relay-ai antigravity      # Antigravity app
relay-ai antigravity-ide  # Antigravity IDE
```

Add `--provider <id> --model <id>` to skip the picker, and `--trace` to write a debug log to `~/.relay-ai/logs/`.

## ⚠️ Use a throwaway Google account

Antigravity still requires Google sign-in before it runs. Relay routes generation through your local gateway, but Antigravity is Google software and may still contact Google for sign-in, telemetry, updates, or account checks.

This use is probably not what Google intended, may violate Google's terms of service, and could lead to account restrictions or bans. Use a secondary account you can afford to lose — a free Google account is enough. Do not use your main Gmail, Workspace, YouTube, Drive, or business account.

## What the model picker shows

Every entry names the provider it comes from, e.g. `gemini-3.8-flash (Relay - Google Gemini)`, so the same model from two providers is easy to tell apart.

**agy (the Antigravity CLI)** has an effort slider. Each model appears as one row, e.g. `GPT-6 Sol (Relay - OpenAI (ChatGPT))`, with agy's Low / Medium / High / Max slider for the levels the model supports. The slider has no XHigh position, so a model that supports XHigh also gets a separate `XHigh` row. `None` is not offered. agy opens on your launch model at Medium.

**Antigravity IDE and the Antigravity app** have no effort control, so Relay lists a model once per effort level:

- **The model you launch with** appears at every effort level it supports — for example `GPT-6 Sol None` through `GPT-6 Sol Max`.
- **Each of your favorites** (`relay-ai favorites`, the same list every other tool uses) appears at three levels: medium and the two above it, e.g. `GPT-6 Luna Medium / High / XHigh`. A model with fewer levels above medium is topped up from below (e.g. low / medium / high).
- **Models without adjustable effort** appear once, with no level in the name.

The list holds up to 50 entries, and effort levels count toward that. If your favorites don't all fit, Relay warns at launch and lists the ones left out; favorites at the end of your list are dropped first.

Effort levels come from [models.dev](https://models.dev), so new models get the right levels without a Relay update.

## Requirements

- Models need at least a 136K context window. Antigravity refuses to start a smaller model, so Relay hides them from the picker.
- On Windows, Antigravity is detected under `%LOCALAPPDATA%\Programs\`. On macOS, under `/Applications`, or wherever you point Relay with an app path override.
