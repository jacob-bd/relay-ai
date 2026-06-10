# Claude Desktop setup

Point **Claude Desktop** at an **Relay AI** gateway on your machine. You get OpenCode Zen, Go, and your OpenCode-configured providers (Groq, Mistral, OpenAI, Gemini, Ollama, etc.) in Desktop's model picker, with a catalog size you control.

**What's available:** With third-party inference, Desktop gives you **Cowork** and **Code** only. The regular **Chat** tab (claude.ai-style chat inside the app) is not available in this mode.

Anthropic calls this **third-party inference** in the Developer menu. Configure the gateway, launch Claude Desktop, pick a model, then use Cowork or Code.

For Anthropic's upstream docs, see [Installation and setup](https://claude.com/docs/cowork/3p/installation) and [Configuration reference](https://claude.com/docs/cowork/3p/configuration).

## Contents

- [What you get](#what-you-get)
- [Known limitations](#known-limitations)
- [Prerequisites](#prerequisites)
- [Step 1: Start the Relay AI server](#step-1-start-the-relay-ai-server)
- [Step 2: Enable Developer Mode](#step-2-enable-developer-mode)
- [Step 3: Configure third-party inference](#step-3-configure-third-party-inference)
- [Step 4: Use Claude Desktop](#step-4-use-claude-desktop)
- [Gateway values cheat sheet](#gateway-values-cheat-sheet)
- [Restore Claude Desktop to Anthropic's servers](#restore-claude-desktop-to-anthropics-servers)
- [Disable Developer Mode](#disable-developer-mode)
- [Troubleshooting](#troubleshooting)
- [Official references](#official-references)

---

## What you get

| Piece | Role |
| --- | --- |
| `relay-ai server` | Local OpenCode gateway on port **17645** — Zen, Go, and OpenCode-configured providers |
| `relay-ai server --vertex` | Local Vertex gateway on port **17645** — Claude on Google Vertex AI via gcloud ADC |
| Claude Desktop gateway config | Desktop sends inference to your machine instead of only claude.ai |
| Server wizard filters | Exposed providers, optional favorites-only catalog, discovery id masking |
| **Cowork** tab | Agentic sessions (files, research, multi-step tasks) against your gateway models |
| **Code** tab | Claude Code inside Desktop, against your gateway models |

**Not included:** Chat (the standard claude.ai chat UI in Desktop). If you need that, sign in to Claude Desktop normally without a custom gateway, or use claude.ai in the browser.

Billing runs through your OpenCode / OpenCode-configured provider keys. Keep the server terminal open while you use Desktop.

---

## Known limitations

These are Anthropic product constraints, not relay-ai bugs. Gateway users should plan around them.

| Feature | With Relay AI gateway (3P) | With Anthropic 1P (normal sign-in) |
| --- | --- | --- |
| **Chat tab** | Not available | Available |
| **Cowork / Code** | Available | Available (with subscription) |
| **Claude in Chrome** (browser extension) | **Not available** | Requires **Pro, Max, Team, or Enterprise** |

### Claude in Chrome does not work with the gateway

**Claude in Chrome** is Anthropic's Chrome extension for browser automation (navigate sites, fill forms, integrate with Claude Code). It is **not compatible** with third-party inference — including a Relay AI gateway on `127.0.0.1`.

Anthropic's [Claude Code + Chrome docs](https://code.claude.com/docs/en/chrome) state:

- Chrome integration requires **a direct Anthropic plan (Pro, Max, Team, or Enterprise)**.
- It is **not available** through third-party providers (Bedrock, Vertex, Foundry, or a custom gateway).
- If you use Claude exclusively through a gateway, you need a **separate claude.ai paid account** to use Claude in Chrome — and that extension routes through **Anthropic's servers**, not your gateway.

**API-only billing does not help.** Console/API keys are separate from claude.ai subscriptions. Claude in Chrome is not unlocked by API credits alone.

**What gateway users can do instead:**

- Use **Cowork and Code** inside Claude Desktop against the Relay AI server (this guide).
- Use **Claude Code in the terminal** with `relay-ai claude` and your chosen backend.
- For browser automation, use other tools (e.g. dedicated browser MCP, Playwright) — not Claude in Chrome tied to this gateway.

To use Claude in Chrome, [restore 1P mode](#restore-claude-desktop-to-anthropics-servers) and sign in with a paid claude.ai plan.

---

## Prerequisites

1. **Relay AI** installed (`npm install -g relay-ai`).
2. **OpenCode API key** configured at least once (for `relay-ai server` only — not required for `--vertex`):
   ```bash
   relay-ai claude --setup   # subscription tier, if not set
   relay-ai claude           # stores key in Keychain / credential store
   ```
3. **Latest Claude Desktop** from [claude.com/download](https://claude.com/download). Older builds may not show the third-party inference UI.
4. *(Optional, OpenCode server only)* **OpenCode CLI** with providers configured. Whatever you've set up in OpenCode (Groq, Mistral, OpenAI, Gemini, Ollama, etc.) appears in the server catalog automatically.
5. *(Optional)* **Favorites** via `relay-ai models` to cap the catalog at up to 20 models.
6. *(Vertex server only)* **Google Cloud SDK** with `gcloud auth application-default login`, plus a GCP project with Vertex AI and Claude partner models enabled.

---

## Step 1: Start the Relay AI server

In a terminal, start the gateway and **leave it running**:

```bash
relay-ai server
```

For **Claude on Google Vertex AI** instead of OpenCode backends:

```bash
gcloud auth application-default login
export ANTHROPIC_VERTEX_PROJECT_ID="your-gcp-project"
relay-ai server --vertex
```

Same port, same Desktop configuration below. No OpenCode API key required. Default models: `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-haiku-4-5`. See [README — Vertex gateway](../README.md#vertex-gateway-relay-ai-server---vertex) for aliases, custom catalogs, and Claude Code env tips.

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
Relay AI server running
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
| **Gateway API key** | Any non-empty string (e.g. `relay-ai`) |
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

1. Make sure `relay-ai server` is still running in a terminal
2. Open the **Cowork** or **Code** tab (Chat won't be there)
3. Open the model picker. You should see models from your gateway
4. Pick a model and start a session

If discovery worked in Step 3's **Test model discovery**, you're done. No extra launch step.

Some Anthropic docs describe a sign-in screen option for enterprise deployments that skip Anthropic accounts entirely. Most people setting this up at home never see that. If you don't see it, ignore it.

---

## Gateway values cheat sheet

| Setting | Local Relay AI server |
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

To stop routing through Relay AI and return to normal Claude Desktop (Anthropic sign-in, Chat tab, claude.ai inference):

### Verified revert (macOS, Claude Desktop 1.11847.5)

Tested end-to-end. Three on-disk changes plus a relaunch:

| What | Why |
| --- | --- |
| Remove `Claude-3p/configLibrary/` | Drops the gateway config (`inferenceProvider: gateway`) that keeps Desktop in 3P mode |
| Set `"allowDevTools": false` | Hides the **Developer** menu — current Claude Desktop has **Enable** Developer Mode in the UI but no **Disable** toggle |
| Set `"deploymentMode": "1p"` | Pins first-party mode in the standard `Claude/` data folder |

**Before you start:** fully quit Claude Desktop (`Cmd+Q` on macOS — not just close the window). Back up the folders below if you want an undo path.

#### Step 1 — Remove the gateway config

**macOS:**

```bash
rm -rf ~/Library/Application\ Support/Claude-3p/configLibrary/
```

**Windows (PowerShell):**

```powershell
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Claude-3p\configLibrary"
```

This deletes the applied third-party inference profile (e.g. `inferenceGatewayBaseUrl: http://127.0.0.1:17645/anthropic`). It does **not** delete Cowork session history under `Claude-3p/` or `~/Claude/`.

#### Step 2 — Disable Developer Mode (manual)

Claude Desktop v1.11847.5 stores Developer Mode in `developer_settings.json` under the **standard** (1P) data folder — not `Claude-3p/`:

**macOS:** `~/Library/Application Support/Claude/developer_settings.json`

**Windows:** `%APPDATA%\Claude\developer_settings.json`

Set:

```json
{
  "allowDevTools": false
}
```

If the file does not exist, create it with that content.

#### Step 3 — Pin first-party deployment mode

Add `"deploymentMode": "1p"` to the standard config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Example (merge with any existing keys — do not delete your `preferences` block):

```json
{
  "preferences": { },
  "deploymentMode": "1p"
}
```

#### Step 4 — Relaunch

```bash
open -a Claude
```

Optional one-shot override if Desktop still picks up stale 3P state:

```bash
/Applications/Claude.app/Contents/MacOS/Claude --boot-1p-once
```

Stop the Relay AI server (`Ctrl+C` in its terminal) if you no longer need the gateway.

#### How to confirm it worked

- Normal **Chat** tab and Anthropic sign-in flow are back
- No **Cowork 3P \| Gateway** label in the bottom-left corner
- **Developer** menu is gone from the menu bar
- Logs write to `~/Library/Logs/Claude/main.log` (not `Claude-3p/main.log`) and show `claude.ai account active and logged in`

---

### Option A — In-app (if Developer menu is still available)

Open **Developer** → **Configure third-party inference**, clear or replace the gateway settings, and apply changes. Point **Connection** back at Anthropic's API or remove the gateway block entirely, depending on what the UI offers.

You may still need [Step 2 — Disable Developer Mode](#step-2--disable-developer-mode-manual) afterward — clearing the gateway does not hide the **Developer** menu on its own.

### Option B — Log out → Anthropic sign-in

In 3P mode, **Log out** (bottom-left) can surface the sign-in screen with an option to use Anthropic directly instead of Cowork on 3P. This path is easy to miss; the verified revert above is more reliable.

### Full reset (deletes local Desktop history)

Only if the steps above are not enough and you want to wipe everything under Anthropic's third-party inference data folder:

| Platform | Delete |
| --- | --- |
| macOS | `~/Library/Application Support/Claude-3p/` and optionally `~/Claude/` |
| Windows | `%LOCALAPPDATA%\Claude-3p\` and optionally `%USERPROFILE%\Claude\` |

**Warning:** Conversation history in that folder is not recoverable after deletion.

### Managed / enterprise profiles

If IT pushed a managed profile (Jamf, Intune, Group Policy), local edits in `configLibrary/` may be ignored or restored on launch. Talk to IT to remove or update the profile.

---

## Disable Developer Mode

Third-party inference setup requires **Help** → **Troubleshooting** → **Enable Developer Mode**, which reveals the **Developer** menu.

**There is no "Disable Developer Mode" menu item** in Claude Desktop v1.11847.5 (verified in the app bundle). To turn it off after reverting to Anthropic:

1. Fully quit Claude Desktop
2. Edit `developer_settings.json` in the **standard** `Claude/` folder (see paths above)
3. Set `"allowDevTools": false`
4. Relaunch

Once gateway config is removed, the **Developer** menu does not route traffic to your Relay AI server — but it stays visible until `allowDevTools` is set to `false`.

To re-enable later (e.g. for another gateway experiment): set `"allowDevTools": true` and relaunch, or use **Help** → **Troubleshooting** → **Enable Developer Mode** again.

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
| Server not running | Start `relay-ai server` and keep the terminal open |
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
- **Favorites-only:** Add models with `relay-ai models`, or turn favorites-only off
- **Subscription tier:** Run `relay-ai claude --setup`

### Models show up in `curl` but not in Desktop

Enable **Mask gateway model ids for discovery**, restart the server, relaunch Claude Desktop.

### `Missing OPENCODE_API_KEY` when starting the server

Only applies to `relay-ai server` (not `--vertex`). Run `relay-ai claude` once to store your key, or export `OPENCODE_API_KEY` before `relay-ai server`.

### `Missing subscription tier`

```bash
relay-ai claude --setup
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
| Relay AI server mode | [README — Server mode](../README.md#server-mode) |
| Relay AI Vertex gateway | [README — Vertex gateway](../README.md#vertex-gateway-relay-ai-server---vertex) |
