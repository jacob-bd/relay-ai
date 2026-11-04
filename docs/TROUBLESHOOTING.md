# Troubleshooting relay-ai

Common issues when launching **Claude Code** through `relay-ai claude`. For Claude Desktop gateway setup, see [CLAUDE_DESKTOP_SETUP.md](./CLAUDE_DESKTOP_SETUP.md).

---

## “Not logged in · Please run /login” after picking a model

### What you see

Claude Code starts and shows the right model in the status bar (e.g. `moonshotai/kimi-k2.6`), but when you send a message you get:

```text
Not logged in · Please run /login
```

### Common cause: you chose **No** on the API key prompt

When Claude Code detects an `ANTHROPIC_API_KEY` in the session (relay-ai sets this for your chosen provider), it may ask:

```text
Detected a custom API key in your environment
Do you want to use this API key?
  1. Yes
  2. No (recommended)
```

**If you pick No**, Claude Code remembers that choice and refuses to use the key. relay-ai is routing through your provider correctly — Claude Code is blocking the key you rejected.

This is **not** a relay-ai bug and does not mean your Nvidia/Groq/Zen provider is misconfigured.

### Fix: approve the key in Claude Code’s config

Claude Code stores your answer in `~/.claude.json` under `customApiKeyResponses`.

1. Quit Claude Code if it’s still open.
2. Open `~/.claude.json` in a text editor.
3. Find the key suffix shown in the prompt (last part of the masked key, e.g. `iFYB03v8xy4E-xJEYpN8`).
4. Move that suffix from `rejected` to `approved`:

```json
"customApiKeyResponses": {
  "approved": [
    "anything",
    "iFYB03v8xy4E-xJEYpN8"
  ],
  "rejected": []
}
```

5. Save the file and run `relay-ai claude` again.

**Easier next time:** when the prompt appears, choose **Yes**. Claude Code usually remembers approved keys and won’t ask again for that key.

### If you use Claude Max / Pro subscription elsewhere

You may also have a real Anthropic API key in your shell (`~/.zshrc`, etc.). That’s fine for other tools. relay-ai replaces `ANTHROPIC_API_KEY` in the Claude Code child process with your **provider** key (OpenCode, Nvidia, Groq, …). If the prompt confuses you, pick **Yes** when launching through relay-ai.

---

## OpenCode Zen: `403 OpenCode's free tier can only be used from within OpenCode`

Free-tier models on OpenCode Zen (e.g. `big-pickle`, `mimo-v2.6-flash-free`, `muse-spark-1.3-contributor-free`, or any other `*-free` model) cannot be called from third-party tools, and Relay hides them from the Zen model list. OpenCode Go's free models (e.g. `minimax-m3.1-flash-free`) are not affected and work normally. On an older Relay build that still lists one, selecting it returns:

```text
API Error: 403 OpenCode's free tier can only be used from within OpenCode
```

### Cause

In mid-September 2026, OpenCode updated their Zen API gateway to block third-party tools, external agents, and alternative frontends from accessing zero-cost free-tier models. An OpenCode maintainer confirmed this policy change on GitHub ([Issue #49621](https://github.com/anomalyco/opencode/issues/49621#issuecomment-5723383322), [Issue #49580](https://github.com/anomalyco/opencode/issues/49580#issuecomment-5723289721)):

> *"You cannot use the free tier in other harnesses (this is only a limitation for the free tier nothing else)."*

### Solutions

1. **Update Relay**: current builds hide these ids from the Zen picker and catalog, so they cannot be selected in the first place.
2. **Use OpenCode Go**: OpenCode's $10/month Go subscription (`--provider go`) is fully supported and continues to work with external agents and Relay AI as normal, including its `*-free` models.
3. **Use paid OpenCode Zen models**: Metered/pay-as-you-go Zen models with active credits or billing are unaffected by this restriction and work normally.
4. **Use direct registry providers**: Instead of routing free models through Zen, add API keys directly for providers like Groq, Google AI Studio, DeepSeek, or Cerebras (`relay-ai providers add`).

---

## ClinePass: `403 ... only available via Cline product surfaces`

Cline's free-tier models (the `cline-free/*` entries in the ClinePass catalog) cannot be called from third-party tools — Cline restricts them to its own IDE extension and CLI. Current Relay builds probe the free bucket when the provider is added and on every model refresh, and hide the models that answer with this rejection, so they cannot be selected. On an older Relay build that still lists one, selecting it returns:

```text
API Error: 403 Error 403: cline-free/deepseek-v4.1-flash is only available via Cline product surfaces.
If you are using an old version of Cline, please update to the latest version
```

### Cause

Cline's documentation states that free model usage is **not supported through the Cline API** — free models are only available in the Cline IDE extension and CLI ([Cline Free Models](https://docs.cline.bot/getting-started/free-models)). Cline's gateway identifies official Cline clients by their request headers and rejects other callers for these models.

### Solutions

1. **Update Relay and refresh the provider**: run `relay-ai providers refresh cline-pass` (or the ↻ Refresh models option in a picker). The probe re-runs and drops the gated free models from every list.
2. **Use the paid ClinePass catalog**: `cline-pass/*` subscription models are unaffected and work normally — all of them passed the live test matrix in [Issue #80](https://github.com/jacob-bd/relay-ai/issues/80).
3. **Use Cline's own app for free models**: install the Cline IDE extension or CLI and sign in with the same account.

---

## Custom endpoint: certificate error when adding or testing

### What you see

Adding a custom provider, refreshing it or testing a model fails with a certificate message (for example `unable to get local issuer certificate`), although the same URL opens fine in your browser.

### Cause

The server uses a certificate from a company or internal certificate authority. Your computer trusts it; Node, which Relay runs on, only trusts its own bundled list.

### Fix

Run `relay-ai providers trust-certs on`, or tick **Trust this computer's certificates (advanced)** on the custom-provider form in `relay-ai ui`, then retry. Turn it off with `relay-ai providers trust-certs off`. It needs Node 22.19 or newer; on older Node, start Relay with `NODE_USE_SYSTEM_CA=1`. Expired certificates and hostname mismatches are different problems and are not fixed by this. Details: [Custom endpoints](PROVIDERS.md#custom-endpoints).

## Model Test: "This provider's endpoint doesn't serve this model"

The gateway lists the model but does not serve it on this endpoint. This is common when one gateway is added twice, once as an OpenAI-compatible and once as an Anthropic-compatible provider, and its Claude-style endpoint only carries some models. Use the model from the other entry and hide it on this one (eye icon). Relay converts protocols for every tool, so the OpenAI-compatible entry also works in Claude Code.

"Your plan doesn't include this model." means the server refused it for your subscription. Use a model your plan includes, or hide this one.

## Provider works in `relay-ai models` but not in `providers list`

Zen and Go are **cloud builtins**: they appear when you have an OpenCode API key, even if they aren’t saved in `~/.relay-ai/providers.json`. `relay-ai providers list` shows them with `· cloud builtin`. Imported BYOK providers (Anthropic, Nvidia, Groq, …) come from the registry file.

---

## OpenCode import saved placeholder API keys

If you ran `relay-ai providers import` before v0.1.x and see refresh failures for Anthropic (`anything`) or Vertex (`a`), those came from **OpenCode's config**, not Claude Desktop.

**Current behavior:** import validates keys before Keychain save:

- Placeholders like `anything`, `a`, `ollama` → **not saved** (models still imported)
- Real keys → probed against the provider API before save
- Vertex / Bedrock / Azure → key not saved (gcloud/AWS auth)

**To clean up an old placeholder in Keychain:** re-run import (choose **Use imported** for each provider) or remove the provider and import again:

```bash
relay-ai providers import
```

---

## `--trace` for proxy / API errors

If a model fails mid-session (not the login prompt above):

```bash
relay-ai claude --trace
```

After exit, relay-ai prints errors from `~/.relay-ai/logs/claude-debug.log` (secrets redacted in the summary). The proxy also logs to `~/.relay-ai/logs/proxy-debug.log` when `--trace` is set.

---

## Mixed Anthropic + Relay mode (`--http-proxy`): favorites missing from `/model`

### What you see

Claude Code starts on your normal Anthropic login, but `/model` only shows Anthropic models — saved Relay favorites never appear.

### What should happen (v0.7.2+)

In `--http-proxy` mode, Relay seeds Claude Code's gateway models cache and merges favorites into model discovery so they show in the normal `/model` picker next to Anthropic models.

### Quick checks

1. Confirm you launched with mixed mode (`relay-ai claude --http-proxy` or answered **Yes** to keep normal Claude models).
2. Confirm favorites exist and are compatible: `relay-ai models`.
3. If `/model` still looks stale from an older session, delete `~/.claude/cache/gateway-models.json` and relaunch with `relay-ai claude --http-proxy`.
4. If your shell already sets a non-local `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY`, this mode exits on purpose (proxy chaining is not supported yet). Clear those for the session and retry.

---

## Docker / Server + Admin UI

Container deploy, ports, LAN advertise IPs, `secrets.json`, and Compose troubleshooting live in **[DOCKER.md](./DOCKER.md)**. Quick checks:

```bash
docker compose ps
docker compose logs -f ui
```

---

## Still stuck?

1. `relay-ai providers list` — confirm the provider is there and enabled.
2. `relay-ai claude --dry-run` — preview provider, model, and endpoint without launching.
3. Open a GitHub issue with the provider name, model id, and (redacted) error text.
