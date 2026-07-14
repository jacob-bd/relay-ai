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
relay-ai claude --trace               # Relay gateway mode
relay-ai claude --http-proxy --trace  # transparent Anthropic HTTP proxy mode
```

After exit, relay-ai prints errors from Claude Code's debug log (secrets redacted in the summary). In HTTP-proxy session mode, both that log and the translated-model adapter debug log get unique files under `~/.relay-ai/logs/sessions/`; their exact paths are printed at startup. Other launch modes retain their command-specific debug paths under `~/.relay-ai/logs/`.

`relay-ai claude --http-proxy` always writes a separate privacy-minimal request/lifecycle log under `~/.relay-ai/logs/sessions/`; `--trace` is not required. The startup message prints its exact path. Every Anthropic passthrough and translated `/v1/messages` request gets a correlated request ID, upstream status, timing/progress records, and a terminal completion, failure, or client-disconnect event. Session-level start/stop records include the relay PID and listening port.

- `response_failed` with `errorType: "ECONNREFUSED"` means relay reached the local listener but its upstream connection was refused.
- No request record at the failure time, combined with a dead recorded proxy port, means Claude could not reach relay itself.
- `proxy_started` without `proxy_stopped` means the relay process did not complete normal cleanup. `SIGKILL` and machine termination cannot log their own cause.

To find the session file for a known proxy port, run `rg '"port":58972' ~/.relay-ai/logs/sessions` (replace the port as needed).

For OpenAI OAuth WebSocket continuation/cache investigations, restart the standalone server with `--ws-diagnostics` (for example, `relay-ai server --http-proxy --ws-diagnostics`). The printed per-process JSONL path contains sanitized request envelopes, correlated `ws_head_decision` events, `ws_response_usage` token counters, and `ws_response_error` failure metadata. Head decisions include whether relay continued a head, created one for a history mismatch, promoted a nursery head after reuse, isolated a parallel request, or evicted a nursery/established idle head. Error diagnostics distinguish upstream response events, socket errors/closes, and failed upgrades, while recording only hashes and byte lengths—not error-message or close-reason text. Nursery and established heads use independent LRUs: up to 8 short-lived nursery heads plus 32 established heads. TTL clocks start when a response stream finishes and remain suspended while that socket is processing another request. Credential-bearing headers are redacted and conversation fields are represented only by types, lengths, and hashes. Disable the flag after capturing the sessions you need.

---

## Still stuck?

1. `relay-ai providers list` — confirm the provider is there and enabled.
2. `relay-ai claude --dry-run` — preview provider, model, and endpoint without launching.
3. Open a GitHub issue with the provider name, model id, and (redacted) error text.
