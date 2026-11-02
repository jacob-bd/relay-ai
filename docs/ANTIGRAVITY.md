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

## Antigravity IDE Profiles

By default, Relay AI launches Antigravity IDE with an **isolated profile** at `~/.relay-ai/antigravity/profile`. This ensures:

- Your normal IDE settings and extensions are never modified.
- You can sign into a secondary/throwaway Google account in the Relay instance while keeping your main account in your regular Antigravity IDE.
- Existing chats and extensions remain in your regular profile and are not visible in the isolated profile.

### Using your existing IDE profile (`--use-existing-profile`)

If you want to use Relay models directly inside your regular Antigravity IDE setup with your existing chats, extensions, and signed-in account:

```bash
relay-ai antigravity-ide --use-existing-profile
```

When launched with this flag:

1. Relay detects if Antigravity IDE is running, closes it gracefully, and waits for all processes to exit before patching.
2. Relay temporarily switches the model catalog to Relay's catalog and points `jetski.cloudCodeUrl` in your profile settings to the local Relay Cloud Code gateway.
3. Close the IDE when you are done, or press Ctrl+C. Ctrl+C asks first: choose **Yes, close Antigravity IDE and restore config**, or **No, keep session running** to leave the session as is. On exit, Relay closes the IDE, restores your normal configuration, prints a confirmation, and leaves the IDE closed.

The IDE keeps the Google account already signed into your normal profile. Model requests go through your configured Relay providers. The separate profile lets you use a secondary account as a precaution; it doesn't guarantee protection from account restrictions or bans.

Save your work before launching. Relay may force-close the target instance if graceful shutdown doesn't complete. During the session, the picker shows Relay's catalog rather than Google's native catalog. Relay preserves unrelated settings you edit, and restores the original gateway setting and remembered model selection. Custom user-data directories, extension directories, and named IDE profiles can't be combined with this flag.

If an existing-profile session crashes or is terminated unexpectedly, restore normal settings with:

```bash
relay-ai antigravity-ide --restore
```

Relay also checks for interrupted sessions before the next IDE launch. Recovery closes the affected IDE and leaves it closed. If restoration fails, Relay retains its recovery files so you can fix the reported problem and retry. A second Relay session can't modify the same normal profile while the first is active.

If an interruption happens while acquiring the recovery lock itself, Relay may report a retained `.reclaim` guard file. Confirm the other recovery process has exited before removing only the guard file named in the error, then retry `--restore`. Keep the backup and recovery record.

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

## MCP servers

Antigravity loads your configured MCP servers itself. Relay has no MCP endpoint and does not start or terminate them. Relay does tell Antigravity to keep that loading off the turn path, so a message is not held while tool schemas are prepared. Before 0.18.0 every turn waited a fixed ~18 seconds on the "Initializing MCP servers" step, even when nothing had changed; that wait is gone.

If the first response after launch still feels slow, it is usually a server process starting or a remote transport timing out. Antigravity's own log at `~/Library/Logs/Antigravity/language_server.log` names the server involved. Every tool from every connected server is sent to the model on each request, so removing servers you do not use also reduces prompt size.

## Requirements

- Models need at least a 136K context window. Antigravity refuses to start a smaller model, so Relay hides them from the picker.
- On Windows, Antigravity is detected under `%LOCALAPPDATA%\Programs\`. On macOS, under `/Applications`, or wherever you point Relay with an app path override.
