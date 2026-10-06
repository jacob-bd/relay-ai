# Antigravity CLI, app, and IDE

Relay AI launches Google's Antigravity CLI (`agy`), the standalone Antigravity app, and the Antigravity IDE against a local Cloud Code gateway, so Antigravity's own model picker lists models from your Relay providers.

```bash
relay-ai agy              # Antigravity CLI
relay-ai antigravity      # Antigravity app
relay-ai antigravity-ide  # Antigravity IDE
```

Add `--provider <id> --model <id>` to skip the picker, and `--trace` to write a debug log to `~/.relay-ai/logs/` (it includes each request's model and settings, so you can confirm which effort level a message used).

The IDE and the app open on the model you launched with: Relay clears their remembered last pick before each launch. For the app that pick lives in `~/.gemini/antigravity/antigravity_state.pbtxt`, which the app shares with non-Relay use, so your regular Antigravity app also forgets its last pick once.

## ⚠️ Use a throwaway Google account

Antigravity still requires Google sign-in before it runs. Relay routes generation through your local gateway, but Antigravity is Google software and may still contact Google for sign-in, telemetry, updates, or account checks.

This use is probably not what Google intended, may violate Google's terms of service, and could lead to account restrictions or bans. Use a secondary account you can afford to lose — a free Google account is enough. Do not use your main Gmail, Workspace, YouTube, Drive, or business account.

Relay also detects Gemini Enterprise (work) logins before launch and warns with a confirmation prompt (`Proceed with the enterprise account?`, default No) to prevent accidental usage policy violations on company accounts.

## What the model picker shows

Every entry names the provider it comes from, e.g. `gemini-3.8-flash (Relay - Google Gemini)`, so the same model from two providers is easy to tell apart.

**agy (the Antigravity CLI)** has an effort slider. Each model appears as one row, e.g. `GPT-6 Sol (Relay - OpenAI (ChatGPT))`, with agy's Low / Medium / High / Max slider for the levels the model supports. The slider has no XHigh position, so a model that supports XHigh also gets a separate `XHigh` row. `None` is not offered. agy opens on your launch model at Medium.

**The Antigravity app** folds effort into a submenu, like it does for Google's own models. Each model with adjustable effort is one row, e.g. `GPT-6 Sol (Relay - OpenAI (ChatGPT))`, with a Low / Medium / High submenu on hover. XHigh and Max, where the model supports them, are separate rows (`GPT-6 Sol XHigh`, `GPT-6 Sol Max`). `None` is not offered. The app opens on your launch model.

**Antigravity IDE** lists a model once per effort level instead of a submenu — the IDE's submenu is hidden once the model list is long enough to scroll, so a plain row per level is the one that always works:

- **The model you launch with** appears at every effort level it supports — for example `GPT-6 Sol None` through `GPT-6 Sol Max`.
- **Each of your favorites** (`relay-ai favorites`, the same list every other tool uses) appears at three levels: medium and the two above it, e.g. `GPT-6 Luna Medium / High / XHigh`. A model with fewer levels above medium is topped up from below (e.g. low / medium / high).
- **Models without adjustable effort** appear once, with no level in the name.

The list holds up to 50 entries, and effort levels count toward that. If your favorites don't all fit, Relay warns at launch and lists the ones left out; favorites at the end of your list are dropped first.

Effort levels come from [models.dev](https://models.dev), so new models get the right levels without a Relay update.

## Requirements

- Models need at least a 136K context window. Antigravity refuses to start a smaller model, so Relay hides them from the picker.
- On Windows, Antigravity is detected under `%LOCALAPPDATA%\Programs\`. On macOS, under `/Applications`, or wherever you point Relay with an app path override.
