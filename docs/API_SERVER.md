# relay-ai API Server Guide

The `relay-ai server` command starts a local gateway server that acts as a bridge between various LLM backends (OpenCode Zen, OpenCode Go, Local Providers, or Vertex AI) and client applications/tools. It exposes a unified API supporting both Anthropic-compatible and OpenAI-compatible requests on the same port.

---

## 1. Starting the Server

To launch the gateway server in the foreground, run:

```bash
relay-ai server
```

If you want to use the Vertex AI gateway (which uses Google Application Default Credentials via `gcloud ADC`), run:

```bash
relay-ai server --vertex
```

### Startup Log Output Example
When the server starts, it will guide you through configuration steps (e.g., password setup, choosing which providers to expose, filtering by favorites) and print startup logs similar to:

```text
Relay AI server running
  Anthropic:  http://127.0.0.1:17645/anthropic
  OpenAI:     http://127.0.0.1:17645/openai/v1
  Network (en0):
    Anthropic:  http://192.168.68.70:17645/anthropic
    OpenAI:     http://192.168.68.70:17645/openai/v1
  Network (en7):
    Anthropic:  http://192.168.68.6:17645/anthropic
    OpenAI:     http://192.168.68.6:17645/openai/v1
  API key:    saved, rotate with `relay-ai server` → Configure & start
  Catalog:    favorite models only

Model catalog:

  Anthropic
    claude-haiku-4-5-20251001
      anthropic: claude-haiku-4-5-20251001
      openai:    claude-haiku-4-5-20251001

  DeepSeek
    deepseek-v4-pro
      anthropic: anthropic-deepseek__deepseek-v4-pro
      openai:    deepseek-v4-pro

  Google Gemini
    gemini-3.1-flash-lite
      anthropic: anthropic-google__gemini-3.1-flash-lite
      openai:    gemini-3.1-flash-lite
    gemini-3.1-pro-preview
      anthropic: anthropic-google__gemini-3.1-pro-preview
      openai:    gemini-3.1-pro-preview
    gemini-3.5-flash
      anthropic: anthropic-google__gemini-3.5-flash
      openai:    gemini-3.5-flash

  Nvidia
    minimaxai/minimax-m2.7
      anthropic: anthropic-nvidia__minimaxai/minimax-m2.7
      openai:    minimaxai/minimax-m2.7
    minimaxai/minimax-m3
      anthropic: anthropic-nvidia__minimaxai/minimax-m3
      openai:    minimaxai/minimax-m3

  OpenCode Go
    Kimi K2.7 Code
      anthropic: anthropic-go__kimi-k2.7-code
      openai:    kimi-k2.7-code
    MiMo V2.5 Pro
      anthropic: anthropic-go__mimo-v2.5-pro
      openai:    mimo-v2.5-pro
    MiniMax M3 (3x usage)
      anthropic: anthropic-go__minimax-m3
      openai:    minimax-m3
    Qwen3.7 Plus
      anthropic: anthropic-go__qwen3.7-plus
      openai:    qwen3.7-plus

  OpenCode Zen
    Big Pickle
      anthropic: anthropic-zen__big-pickle
      openai:    big-pickle
    MiMo V2.5 Free
      anthropic: anthropic-zen__mimo-v2.5-free
      openai:    mimo-v2.5-free

  OpenRouter
    Z.ai: GLM 5.2
      anthropic: anthropic-openrouter__z-ai/glm-5.2
      openai:    z-ai/glm-5.2

  xAI Grok (SuperGrok)
    grok-4.3
      anthropic: anthropic-xai-oauth__grok-4.3
      openai:    grok-4.3
    grok-build-0.1
      anthropic: anthropic-xai-oauth__grok-build-0.1
      openai:    grok-build-0.1
```

Each model in the catalog is printed with two identifiers:
- **`anthropic:`**: Use this identifier if your client tool expects Anthropic-format requests (e.g. Anthropic SDK or Claude Code).
- **`openai:`**: Use this identifier if your client tool expects OpenAI-format requests (e.g. OpenAI SDK or general OpenAI-compatible extensions).

---

## 2. Configuring Clients

### [THE AI Counsel](https://github.com/jacob-bd/the-ai-counsel)

[THE AI Counsel](https://github.com/jacob-bd/the-ai-counsel) can be easily configured to use the local or network-accessible `relay-ai` gateway.

1. Open **THE AI Counsel** settings panel.
2. Scroll to the **LLM API Keys** section.
3. Locate **Custom OpenAI-Compatible Endpoint**:
   - **Display Name**: Give your server connection any descriptive name you want (e.g., `Relay AI Server`).
   - **Base URL**:
     * **Local connection (same machine)**: Set to `http://127.0.0.1:17645/openai/v1`
     * **Remote/Network connection (other machine)**: Set to `http://<IP_ADDRESS>:17645/openai/v1` using one of the local network IP addresses printed by the server on startup (e.g., `http://192.168.68.6:17645/openai/v1`).
   - **API Key**: Optional. Enter the server password if password protection is enabled, or leave empty if the server runs without a password.
4. Click **Connect** to query and fetch all models available on the gateway.

![THE AI Counsel Settings](/Users/jbendavi/dev_projects/relay-ai/docs/ai-counsel-setup.png)

---

### Cursor

Cursor's **Override OpenAI Base URL** lets you point chat at a custom OpenAI-compatible endpoint. The gateway speaks that format at `/openai/v1`, so you can route Cursor through Relay AI with one important caveat: **Cursor forbids private-network URLs.**

Cursor builds prompts on its cloud backend, then calls your Base URL from there. Any address it can't reach from the public internet is rejected with:

```
Provider returned error: Access to private networks is forbidden
```

This applies to `127.0.0.1`, `localhost`, and LAN IPs like `192.168.x` / `10.x` — **even when `relay-ai server` is running on the same machine.** A public HTTPS URL is required.

The simplest way to get one is a **Cloudflare quick tunnel** (free, no account, no signup). It gives your local gateway a temporary public `https://*.trycloudflare.com` URL.

#### 1. Install `cloudflared` (one time)

```bash
brew install cloudflared
```

#### 2. Start the Relay AI server

```bash
relay-ai server
```

Keep this terminal open. Note the **OpenAI ID** of a model from the startup catalog (the `openai:` line, e.g. `z-ai/glm-5.2`).

#### 3. Open a Cloudflare tunnel to the gateway

In a second terminal:

```bash
cloudflared tunnel --url http://127.0.0.1:17645
```

The output prints a box like:

```
+--------------------------------------------------------------------------------------------+
|  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
|  https://strikes-models-rat-latin.trycloudflare.com                                        |
+--------------------------------------------------------------------------------------------+
```

Use that hostname. **Leave this terminal open too** — closing it kills the URL, and a new run usually gives you a different hostname.

#### 4. Configure Cursor

**Settings → Models → OpenAI API Key panel:**

| Field | Value |
|---|---|
| OpenAI API Key | Enable it and paste any non-empty string (e.g. `relay-local`). In local mode the gateway accepts any value; in network mode use the server password. |
| Override OpenAI Base URL | `https://<your-tunnel>.trycloudflare.com/openai/v1` |
| Add custom model | The exact **OpenAI ID** from the server catalog (e.g. `z-ai/glm-5.2`). Don't reuse a name that collides with a built-in Cursor model (`gpt-4o`, `gpt-5.5`, …) — Cursor will route those through its own backend. |

Cursor appends `/chat/completions` (and `/models`, etc.) to the Base URL automatically, so the `/openai/v1` suffix is required — without it, requests hit `https://<tunnel>/chat/completions` and get a 404.

#### Built-in Cursor models vs Relay (you can't mix)

**Override OpenAI Base URL is global.** While it (and the OpenAI API Key toggle) are enabled, Cursor often routes built-in / Cursor-hosted models through your custom endpoint too. Those models then fail with errors like:

```
The custom API does not support this model
```

or

```
This model does not support custom API keys
```

This is a **known Cursor limitation**, not a Relay AI bug. You cannot use Relay custom models and Cursor’s built-in models in the same session without toggling:

| Goal | What to do |
|---|---|
| Use a Relay / custom model | Keep **OpenAI API Key** + **Override OpenAI Base URL** enabled |
| Switch back to a built-in Cursor model | Turn **off** the OpenAI API Key toggle (and/or Override) |

Tip: disable only the **OpenAI API Key** toggle (`Cmd+Shift+0` / `Ctrl+Shift+0`) — Cursor usually keeps the key and Base URL saved so you don’t have to re-paste them when you turn it back on.

#### 5. Test

1. Open a chat in **Ask** mode (Agent mode sometimes sends a Responses-API-shaped body that the gateway doesn't accept — see Troubleshooting below).
2. Select your custom model.
3. Send a simple prompt like `Reply with exactly: pong`.

If Cursor errors with an empty body or format complaints, switch **Settings → Network → HTTP Compatibility Mode → HTTP/1.1** and retry.

#### Troubleshooting

- **`Access to private networks is forbidden`** — Base URL still points at a private IP. Use the `trycloudflare.com` URL from step 3 (or any public HTTPS reverse proxy you control).
- **404 on chat** — Base URL is missing `/openai/v1`, or the model id doesn't match a server catalog `openai:` id.
- **Cursor ignores the custom model** — its name collides with a built-in. Use a free/idiosyncratic model id, or a name not in Cursor's list.
- **Built-in Cursor model fails while Override is on** (`custom API does not support this model` / `does not support custom API keys`) — expected. Turn off the OpenAI API Key / Override toggle before using Cursor-hosted models; turn it back on for Relay models. See [Built-in Cursor models vs Relay](#built-in-cursor-models-vs-relay-you-cant-mix).
- **Agent mode fails but Ask mode works** — Cursor is sending a Responses-API body (`input` instead of `messages`) to `/chat/completions`. Use Ask mode; this is a Cursor-side bug, not a gateway issue.
- **Tunnel errors about `region2` / QUIC** — usually harmless; as long as one tunnel connection registers (`Registered tunnel connection connIndex=0 … status`), the URL works.
- **URL changes after restarting `cloudflared`** — quick tunnels aren't stable. Update the Base URL in Cursor, or set up a named tunnel if you need a fixed hostname.
- **`Empty provider response` / `Bad Request`** — fixed in v0.6.2. If you still see this on an older version, upgrade: the OpenAI-format gateway path had several gaps not present on the Anthropic-format path (`relay-ai claude`/`codex`/`antigravity`) — dropped reasoning content, dropped consolidated tool calls, unmapped `finish_reason` values, silently-swallowed stream errors, and array-shaped assistant message content losing its text on multi-turn conversations. Use `relay-ai server --trace` (or the Admin UI's debug log) to see the exact upstream error if a similar issue recurs with a different provider.

---

## 3. Docker / containers

**Primary product:** Server + Admin UI — not full desktop Relay AI.

```bash
cp .env.docker.example .env   # set RELAY_AI_SERVER_PASSWORD (required)
docker compose up --build
# Admin UI:  http://127.0.0.1:8787
# Gateway:   http://127.0.0.1:17645/...  after Start Server in the UI
```

| Piece | Detail |
|-------|--------|
| UI | Port **8787** (`RELAY_AI_UI_HOST_PORT`); hides Apps & Launch / Antigravity |
| Gateway | Port **17645** inside container; host publish via `RELAY_AI_GATEWAY_HOST_PORT` |
| Auth | `RELAY_AI_SERVER_PASSWORD` as `Bearer` / `x-api-key` |
| Secrets | Volume `RELAY_AI_HOME=/data` — `secrets.json` when keyring unavailable |
| Headless | `docker compose --profile headless up server` |

**AI assistants:** follow the “For AI assistants” section in **[DOCKER.md](./DOCKER.md)** (questions to ask the user, exact checklist, what not to do).

Full guide: **[DOCKER.md](./DOCKER.md)**.

