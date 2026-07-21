# Docker: Server + Admin UI

**Audience:** humans deploying Relay AI as an always-on API gateway, and AI assistants asked to “put Relay AI in Docker.”

This is **not** full desktop Relay AI. The container runs:

| Inside the container | On the user’s Mac/PC (host) |
|----------------------|-----------------------------|
| Admin UI (providers, favorites, Server tab) | Claude / Codex / Antigravity app launch |
| API gateway after **Start Server** | Point clients at the published host ports |

OS keychains do **not** work in containers. Credentials use env vars and `RELAY_AI_HOME/secrets.json` on a volume.

---

## For AI assistants (read this first)

### Goal

Deploy Relay AI’s **Server + Admin UI** from this repository with Docker Compose so the user can:

1. Open a browser admin UI
2. Add providers / API keys (or use `OPENCODE_API_KEY` for Zen/Go)
3. Start the gateway from the **Server** tab
4. Point Claude Desktop, Cursor, or other clients at the gateway URLs

### Files to use

| File | Role |
|------|------|
| [`Dockerfile`](../Dockerfile) | Multi-stage Node 22 image; default CMD `ui --server` |
| [`docker-compose.yml`](../docker-compose.yml) | `ui` service (default) + optional `server` headless profile |
| [`.env.docker.example`](../.env.docker.example) | Template for `.env` (copy → edit; never commit `.env`) |
| This doc | Full behavior, ports, secrets, troubleshooting |

### Questions to ask the user before deploying

Ask only what you do not already know. Prefer short multiple-choice.

1. **Where will Docker run?** Same machine they’ll open the browser on, or a remote NAS/VPS?
2. **Do they have an OpenCode API key** for Zen/Go free/paid cloud models? (`OPENCODE_API_KEY`) — optional if they’ll only add other providers in the UI.
3. **Gateway password** — invent a strong random password for `RELAY_AI_SERVER_PASSWORD` (required for network mode clients), or ask them for one. Never commit it.
4. **Any other provider API keys now?** e.g. Groq → `RELAY_AI_KEY_GROQ`. Can be added later in the UI.
5. **Host ports free?** Defaults **8787** (UI) and **17645** (gateway). If busy, set `RELAY_AI_UI_HOST_PORT` / `RELAY_AI_GATEWAY_HOST_PORT`.
6. **LAN access?** If they’ll open the UI from another device on Wi‑Fi, set `RELAY_AI_ADVERTISE_HOST` to the Docker host’s LAN IP (e.g. `192.168.1.10`).

### Exact deploy steps (AI checklist)

```bash
# 1. Clone or cd into the relay-ai repo root (must contain docker-compose.yml)
cd /path/to/relay-ai

# 2. Create env file (never commit .env)
cp .env.docker.example .env
# Edit .env — at minimum set RELAY_AI_SERVER_PASSWORD
# Optional: OPENCODE_API_KEY, RELAY_AI_ADVERTISE_HOST, RELAY_AI_KEY_*

# 3. Build and start Server + Admin UI
docker compose up --build -d

# 4. Confirm
docker compose ps
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/
```

Then tell the user:

- Admin UI: `http://127.0.0.1:<UI_HOST_PORT>` (default **8787**)
- After **Server → Start Server** in the UI:
  - Anthropic: `http://127.0.0.1:<GATEWAY_HOST_PORT>/anthropic`
  - OpenAI: `http://127.0.0.1:<GATEWAY_HOST_PORT>/openai/v1`
  - Auth header: `Authorization: Bearer <RELAY_AI_SERVER_PASSWORD>` or `x-api-key: <same>`
- URL cards in the UI show the **host-published** port and (when possible) the LAN IP — prefer those over guessing.

### What not to do

- Do **not** expect Claude Desktop / Codex app launch from inside the container.
- Do **not** bake secrets into the image or commit `.env`.
- Do **not** advertise container-only `172.x` bridge IPs to LAN clients.
- Do **not** assume port **17645** on the host if `RELAY_AI_GATEWAY_HOST_PORT` was remapped — read `docker compose ps` / UI URL cards.

---

## Quick start (humans)

```bash
cp .env.docker.example .env
# Edit .env — set RELAY_AI_SERVER_PASSWORD (and OPENCODE_API_KEY if using Zen/Go)

docker compose up --build
```

Open **http://127.0.0.1:8787**

1. **Providers & Keys** — add keys, or rely on auto-seeded Zen/Go when `OPENCODE_API_KEY` is set  
2. Optional: **Favorites**  
3. **Server** tab → **Start Server** (network mode in the container)  
4. Copy URLs / model IDs from the running panel (Copy works on LAN HTTP)

---

## What runs

Default Compose service `ui`:

- Command: `relay-ai ui --server` (`RELAY_AI_UI_MODE=server`)
- Binds UI on `0.0.0.0:8787` inside the container  
- Hides **Apps & Launch** and **Antigravity** (host-only features)  
- Starts the API gateway **in-process** when you click Start Server (same process; stops when the container stops)

Headless API only (no browser UI):

```bash
docker compose --profile headless up --build server
```

---

## Ports

| Inside container | Default host publish | Env override |
|------------------|----------------------|--------------|
| UI `8787` | `8787` | `RELAY_AI_UI_HOST_PORT` |
| Gateway `17645` | `17645` | `RELAY_AI_GATEWAY_HOST_PORT` |

The Node process **always listens on 17645 inside the container**. Clients on the host/LAN must use the **left-hand** publish port. Compose passes `RELAY_AI_GATEWAY_HOST_PORT` into the container so URL cards match.

Example remap when 17645 is taken on the host:

```bash
# .env
RELAY_AI_GATEWAY_HOST_PORT=17646
RELAY_AI_UI_HOST_PORT=18787
```

Then open `http://127.0.0.1:18787` and use gateway port **17646** in client Base URLs.

---

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `RELAY_AI_SERVER_PASSWORD` | Yes for network clients | Gateway password (`Bearer` / `x-api-key`) |
| `OPENCODE_API_KEY` | If using Zen/Go | Seeds Zen + Go providers when the volume is empty |
| `RELAY_AI_KEY_<ID>` | Optional | Per-provider key (`groq` → `RELAY_AI_KEY_GROQ`) |
| `RELAY_AI_HOME` | Set to `/data` in image | Config, `providers.json`, `secrets.json`, logs |
| `RELAY_AI_UI_MODE` | `server` in image | Admin UI mode |
| `RELAY_AI_UI_PORT` | Default `8787` | Listen port inside container |
| `RELAY_AI_UI_HOST_PORT` | Optional | Host → UI publish |
| `RELAY_AI_GATEWAY_HOST_PORT` | Optional | Host → gateway publish **and** advertised port in UI |
| `RELAY_AI_ADVERTISE_HOST` | Optional | LAN IP for URL cards (e.g. `192.168.1.10`) |
| `RELAY_AI_ADVERTISE_HOSTS` | Optional | Comma-separated list of advertise IPs |

Gateway password resolution: `--password` → `RELAY_AI_SERVER_PASSWORD` → saved password in volume.

### LAN IPs (not Docker `172.x`)

Containers only see bridge addresses. URL cards prefer:

1. `RELAY_AI_ADVERTISE_HOST` / `RELAY_AI_ADVERTISE_HOSTS`
2. Else the **Host** header from the browser (open the UI as `http://192.168.x.x:8787`)
3. Else container NICs (often useless `172.x`)

---

## Persistence & secrets

Volume: Compose named volume `relay-ai-data` → `/data` (`RELAY_AI_HOME`).

| Path | Contents |
|------|----------|
| `/data/config.json` | Preferences, server wizard defaults |
| `/data/providers.json` | Provider registry |
| `/data/secrets.json` | API keys + OAuth tokens when keyring is unavailable (`0600`) |
| `/data/logs/` | Trace / debug logs |

Device-code OAuth (GitHub Copilot, ChatGPT, xAI) works from the admin UI; tokens persist in `secrets.json`. Claude / Antigravity OAuth flows are not intended for this public admin UI.

---

## Pointing clients at the gateway

After Start Server:

| Client style | Base URL |
|--------------|----------|
| Anthropic-compatible | `http://<host>:<gateway-port>/anthropic` |
| OpenAI-compatible | `http://<host>:<gateway-port>/openai/v1` |

Auth: `Authorization: Bearer <password>` or `x-api-key: <password>`.

Same-machine Docker host: use `127.0.0.1` and the **published** gateway port.  
Another device on LAN: use the host LAN IP + published port (see advertise section).  
Cursor and some cloud IDEs block private Base URLs — use a tunnel; see [API_SERVER.md](./API_SERVER.md).

---

## Local test without Docker

```bash
relay-ai ui --server
# or: RELAY_AI_UI_MODE=server relay-ai ui
```

Binds `0.0.0.0:8787`, no browser auto-open, same hidden nav sections.

---

## Security

- Keep `.env` private (gitignored). Never bake keys into the image.
- Treat network mode as LAN-trusted unless you put TLS / a reverse proxy in front.
- Rotate `RELAY_AI_SERVER_PASSWORD` if it leaks.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| UI OK, gateway connection refused | Gateway not started, or wrong **host** port | Start Server in UI; check `docker compose ps` / URL cards |
| UI shows `172.x` only | No advertise host / opened UI via localhost only | Set `RELAY_AI_ADVERTISE_HOST` or open UI via LAN IP |
| Copy button fails on LAN | Old UI without clipboard fallback | Rebuild image / hard-refresh browser |
| Typing loses focus in Server form | Fixed in 0.6.0 (status poll); hard-refresh | Rebuild / refresh `app.js` |
| 401 on `/models` | Wrong password | Match `RELAY_AI_SERVER_PASSWORD` |
| No models | Empty providers | Set `OPENCODE_API_KEY` and/or add providers in UI |
| Apps / Antigravity missing | Expected | Use host CLI for app launch |
| Port already allocated | Host port conflict | Change `RELAY_AI_*_HOST_PORT` in `.env` |

```bash
docker compose logs -f ui
docker compose ps
curl -s http://127.0.0.1:${RELAY_AI_UI_HOST_PORT:-8787}/ | head
curl -s -H "x-api-key: $RELAY_AI_SERVER_PASSWORD" \
  http://127.0.0.1:${RELAY_AI_GATEWAY_HOST_PORT:-17645}/openai/v1/models
```

---

## Related docs

- [API_SERVER.md](./API_SERVER.md) — gateway API shapes, Claude Desktop, Cursor tunnel  
- [PROVIDERS.md](./PROVIDERS.md) — provider templates  
- [SUBSCRIPTION-OAUTH.md](./SUBSCRIPTION-OAUTH.md) — device-code OAuth  
- [AI-AGENTS.md](./AI-AGENTS.md) — non-interactive / agent launch (host CLI)
