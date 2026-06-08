# Claude Desktop setup

Point **Claude Desktop** at an **OpenCode Starter** gateway on your machine. You get OpenCode Zen, Go, and your OpenCode-configured providers (Groq, Mistral, OpenAI, Gemini, Ollama, etc.) in Desktop's model picker, with a catalog size you control.

**What's available:** With third-party inference, Desktop gives you **Cowork** and **Code** only. The regular **Chat** tab (claude.ai-style chat inside the app) is not available in this mode.

Anthropic calls this **third-party inference** in the Developer menu. Configure the gateway, launch Claude Desktop, pick a model, then use Cowork or Code.

For Anthropic's upstream docs, see [Installation and setup](https://claude.com/docs/cowork/3p/installation) and [Configuration reference](https://claude.com/docs/cowork/3p/configuration).

## Contents

- [What you get](#what-you-get)
- [Prerequisites](#prerequisites)
- [Step 1: Start the OpenCode Starter server](#step-1-start-the-opencode-starter-server)
- [Step 2: Enable Developer Mode](#step-2-enable-developer-mode)
- [Step 3: Configure third-party inference](#step-3-configure-third-party-inference)
- [Step 4: Use Claude Desktop](#step-4-use-claude-desktop)
- [Gateway values cheat sheet](#gateway-values-cheat-sheet)
- [Restore Claude Desktop to Anthropic's servers](#restore-claude-desktop-to-anthropics-servers)
- [Troubleshooting](#troubleshooting)
- [Official references](#official-references)

---

## What you get

| Piece | Role |
| --- | --- |
| `opencode-starter server` | Local gateway on port **17645**. Anthropic Messages API + model discovery |
| Claude Desktop gateway config | Desktop sends inference to your machine instead of only claude.ai |
| Server wizard filters | Exposed providers, optional favorites-only catalog, discovery id masking |
| **Cowork** tab | Agentic sessions (files, research, multi-step tasks) against your gateway models |
| **Code** tab | Claude Code inside Desktop, against your gateway models |

**Not included:** Chat (the standard claude.ai chat UI in Desktop). If you need that, sign in to Claude Desktop normally without a custom gateway, or use claude.ai in the browser.

Billing runs through your OpenCode / OpenCode-configured provider keys. Keep the server terminal open while you use Desktop.

---

## Prerequisites

1. **OpenCode Starter** installed (`npm install -g opencode-starter`).
2. **OpenCode API key** configured at least once:
   ```bash
   opencode-starter claude --setup   # subscription tier, if not set
   opencode-starter claude           # stores key in Keychain / credential store
   ```
3. **Latest Claude Desktop** from [claude.com/download](https://claude.com/download). Older builds may not show the third-party inference UI.
4. *(Optional)* **OpenCode CLI** with providers configured. Whatever you've set up in OpenCode (Groq, Mistral, OpenAI, Gemini, Ollama, etc.) appears in the server catalog automatically.
5. *(Optional)* **Favorites** via `opencode-starter models` to cap the catalog at up to 20 models.

---

## Step 1: Start the OpenCode Starter server

In a terminal, start the gateway and **leave it running**:

```bash
opencode-starter server
```

First-time wizard recommendations:

| Prompt | Recommendation |
| --- | --- |
| **Configure & start** vs **Start with saved settings** | *Configure & start* the first time |
| **Exposed providers** | Add only what you want in Desktop (Zen, Go, OpenAI, etc.) |
| **Mask gateway model ids for discovery?** | **Yes**. Claude Desktop filters competitor names in gateway model ids. Masking keeps discovery working while display names stay readable |
| **Expose only favorite models?** | Optional |
| **Listen mode** | **Local only** (`127.0.0.1`) when Desktop runs on the same machine |

When the server is up:

```text
OpenCode Starter server running
  Anthropic:  http://127.0.0.1:17645/anthropic
  OpenAI:     http://127.0.0.1:17645/openai
  API key:    any non-empty value
```

Quick health check (optional):

```bash
curl -s http://127.0.0.1:17645/health
curl -s http://127.0.0.1:17645/anthropic/v1/models | head
```

---

## Step 2: Enable Developer Mode

Third-party inference lives behind **Developer Mode**.

### macOS

From the **menu bar**:

1. **Help** → **Troubleshooting** → **Enable Developer Mode**
2. The app may relaunch. That's normal.

### Windows

From the **application menu (☰)**:

1. **Help** → **Troubleshooting** → **Enable Developer Mode**
2. The app may relaunch. That's normal.

A **Developer** menu appears in the menu bar (macOS) or application menu (Windows).

Anthropic's docs say to configure this from the login screen before signing in. In practice, if you already use Claude Desktop, enable Developer Mode from the menu and move on. You don't need a separate "start mode" button after configuration.

---

## Step 3: Configure third-party inference

1. **Developer** → **Configure third-party inference**
2. Open the **Connection** section in the left sidebar
3. Set:

| Field | Value |
| --- | --- |
| **Inference provider** | **Gateway** (Anthropic-compatible) |
| **Gateway base URL** | `http://127.0.0.1:17645/anthropic` |
| **Gateway API key** | Any non-empty string (e.g. `opencode-starter`) |
| **Gateway auth scheme** | `bearer` |

**Do not append `/v1` to the base URL.** Claude Desktop adds API paths itself (`/v1/models`, `/v1/messages`). A URL like `.../anthropic/v1` breaks discovery and inference.

4. Leave **model discovery** enabled (default)
5. Hit **Test connection** and **Test model discovery** if those buttons are there
6. Click **Apply locally**. The app saves config and relaunches

Config lands here:

| Platform | Path |
| --- | --- |
| macOS | `~/Library/Application Support/Claude-3p/configLibrary/` |
| Windows | `%LOCALAPPDATA%\Claude-3p\configLibrary\` |

The `Claude-3p` folder name is Anthropic's on-disk layout for third-party inference. You can ignore it day to day.

---

## Step 4: Use Claude Desktop

After **Apply locally**, open Claude Desktop like you normally would.

1. Make sure `opencode-starter server` is still running in a terminal
2. Open the **Cowork** or **Code** tab (Chat won't be there)
3. Open the model picker. You should see models from your gateway
4. Pick a model and start a session

If discovery worked in Step 3's **Test model discovery**, you're done. No extra launch step.

Some Anthropic docs describe a sign-in screen option for enterprise deployments that skip Anthropic accounts entirely. Most people setting this up at home never see that. If you don't see it, ignore it.

---

## Gateway values cheat sheet

| Setting | Local OpenCode Starter server |
| --- | --- |
| Provider | Gateway (Anthropic-compatible) |
| Base URL | `http://127.0.0.1:17645/anthropic` |
| API key | Any non-empty value (local mode has no server password) |
| Auth scheme | `bearer` |
| Discovery (internal) | `GET http://127.0.0.1:17645/anthropic/v1/models` |
| Messages (internal) | `POST http://127.0.0.1:17645/anthropic/v1/messages` |

### Network mode (another device on your LAN)

| Setting | Value |
| --- | --- |
| Base URL | `http://<server-ip>:17645/anthropic` |
| API key | The **server password** printed when the server started |

---

## Restore Claude Desktop to Anthropic's servers

To stop routing through OpenCode Starter and go back to Anthropic's default inference:

### Option A: Remove the gateway configuration

1. **Fully quit** Claude Desktop (not just close the window)
2. Delete the local config library:

   **macOS:**
   ```bash
   rm -rf ~/Library/Application\ Support/Claude-3p/configLibrary/
   ```

   **Windows (PowerShell):**
   ```powershell
   Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Claude-3p\configLibrary"
   ```

3. Relaunch Claude Desktop. Inference goes back to Anthropic's servers.
4. Stop the OpenCode Starter server (`Ctrl+C`) if you don't need it anymore.

### Option B: Change it in the app

Open **Developer** → **Configure third-party inference**, clear or replace the gateway settings, and **Apply locally**. Point Connection back at Anthropic's API or remove the gateway block entirely, depending on what the UI offers.

### Full reset (deletes local Desktop history)

Only if you want to wipe everything under Anthropic's third-party inference data folder:

| Platform | Delete |
| --- | --- |
| macOS | `~/Library/Application Support/Claude-3p/` and optionally `~/Claude/` |
| Windows | `%LOCALAPPDATA%\Claude-3p\` and optionally `%USERPROFILE%\Claude\` |

**Warning:** Conversation history in that folder is not recoverable after deletion.

### Developer Mode

No need to "disable" Developer Mode. Once gateway config is gone, Desktop uses Anthropic's servers again. The Developer menu may stay visible. That alone doesn't route traffic to your gateway.

### Managed / enterprise profiles

If IT pushed a managed profile (Jamf, Intune, Group Policy), local edits in `configLibrary/` may be ignored. Talk to IT to remove or update the profile.

---

## Troubleshooting

### Gateway config doesn't seem to apply

- Confirm **Connection** uses **Gateway** with a valid base URL and API key
- Config is read at launch. Fully quit and reopen Claude Desktop after **Apply locally**
- **Help** → **Troubleshooting** → **Copy Managed Configuration Report** shows what the app loaded (secrets redacted)
- Logs:
  - macOS: `~/Library/Logs/Claude-3p/main.log`
  - Windows: `%LOCALAPPDATA%\Claude-3p\Logs\main.log`

### Test connection or Test model discovery fails

| Check | Action |
| --- | --- |
| Server not running | Start `opencode-starter server` and keep the terminal open |
| Wrong base URL | `http://127.0.0.1:17645/anthropic`, no `/v1` suffix |
| Empty API key | Any non-empty string for local mode |
| Network mode | Base URL uses the server's LAN IP; API key matches the server password |
| Firewall | Allow local connections to port `17645` |

```bash
curl -s http://127.0.0.1:17645/health
curl -s -H "Authorization: Bearer test" http://127.0.0.1:17645/anthropic/v1/models
```

### Model picker shows 0 models or fewer than expected

- **Discovery id masking:** Answer **Yes** in the server wizard. Claude Desktop hides models whose gateway ids contain competitor vendor strings
- **Provider filter:** Re-run the wizard and add the providers you need
- **Favorites-only:** Add models with `opencode-starter models`, or turn favorites-only off
- **Subscription tier:** Run `opencode-starter claude --setup`

### Models show up in `curl` but not in Desktop

Enable **Mask gateway model ids for discovery**, restart the server, relaunch Claude Desktop.

### `Missing OPENCODE_API_KEY` when starting the server

Run `opencode-starter claude` once to store your key, or export `OPENCODE_API_KEY` before `opencode-starter server`.

### `Missing subscription tier`

```bash
opencode-starter claude --setup
```

### Authentication errors from the gateway (401)

- **Local mode:** Any non-empty bearer token works
- **Network mode:** Gateway API key in Desktop must match the server password exactly

### Generate a diagnostic report

**Help** → **Troubleshooting** → **Generate Diagnostic Report**. Share the saved folder if you need help. No conversation content in the report.

---

## Official references

| Topic | Link |
| --- | --- |
| Third-party inference overview | [claude.com/docs/cowork/3p/overview](https://claude.com/docs/cowork/3p/overview) |
| Installation and setup | [claude.com/docs/cowork/3p/installation](https://claude.com/docs/cowork/3p/installation) |
| Configuration reference | [claude.com/docs/cowork/3p/configuration](https://claude.com/docs/cowork/3p/configuration) |
| User identity and local data | [claude.com/docs/cowork/3p/data-storage](https://claude.com/docs/cowork/3p/data-storage) |
| Claude Desktop download | [claude.com/download](https://claude.com/download) |
| OpenCode Starter server mode | [README — Server mode](../README.md#server-mode) |
