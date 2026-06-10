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
relay-ai claude --trace
```

After exit, relay-ai prints errors from `~/.relay-ai/logs/claude-debug.log` (secrets redacted in the summary). The proxy also logs to `~/.relay-ai/logs/proxy-debug.log` when `--trace` is set.

---

## Still stuck?

1. `relay-ai providers list` — confirm the provider is there and enabled.
2. `relay-ai claude --dry-run` — preview provider, model, and endpoint without launching.
3. Open a GitHub issue with the provider name, model id, and (redacted) error text.
