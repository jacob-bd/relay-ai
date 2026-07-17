# AI agents & non-interactive launch

relay-ai is built so **AI agents** (scripts, CI, alef-agent, Cursor subagents, etc.) can launch Claude Code, OpenAI Codex, or Google Gemini CLI against your provider registry **without interactive wizards**, with **clean machine-readable stdout** when needed.

For the full machine-readable reference (including your live provider/model list), run:

```bash
relay-ai --ai
relay-ai --ai --install    # install SKILL.md to agent skill dirs
```

---

## Quick reference

| Goal | Command |
|------|---------|
| Agent reference | `relay-ai --ai` |
| Install agent skill | `relay-ai --ai --install` |
| Claude one-shot (text) | `relay-ai claude --provider <id> --model <id> -p "prompt"` |
| Claude NDJSON stream | `relay-ai claude --provider <id> --model <id> -p "…" --output-format stream-json` |
| Codex one-shot (text) | `relay-ai codex --provider <id> --model <id> exec "prompt"` |
| Codex JSONL events | `relay-ai codex --provider <id> --model <id> exec --json "prompt"` |
| Gemini one-shot (text) | `relay-ai gemini --provider <id> --model <id> -p "prompt"` |
| Gemini NDJSON stream | `relay-ai gemini --provider <id> --model <id> -p "…" -o stream-json` |
| Model slug | `--model zen__deepseek-v4-flash-free` (= `--provider zen --model deepseek-v4-flash-free`) |
| List providers/models | `relay-ai providers list` or read `~/.relay-ai/providers.json` |

---

## Boot flags (`--provider` / `--model`)

relay-ai consumes these flags **before** spawning Claude or Codex. They are **not** passed to the child.

| Flag | Purpose |
|------|---------|
| `--provider <id>` | Registry provider id (`groq`, `google`, `zen`, `go`, …) |
| `--model <id>` | Model id from that provider's cache |
| `--model <provider>__<model-id>` | Slug form — provider embedded in model string |
| `--http-proxy` | Claude only: keep native Anthropic auth/models and add the selected Relay model plus compatible favorites |

### When the wizard is skipped

**Claude (`relay-ai claude`):**

- Both `--provider` and `--model` are set, **or**
- Print mode (`-p` / `--print`) and saved preferences exist from a prior interactive launch

**Codex (`relay-ai codex`):**

- Both `--provider` and `--model` are set, **or**
- Non-interactive args (`exec` subcommand or positional prompt) and saved prefs exist

**Gemini (`relay-ai gemini`):**

- Both `--provider` and `--model` are set, **or**
- Non-interactive args (`-p` / `--prompt`, `-i` / `--prompt-interactive`, or positional query) and saved prefs exist

In CI / headless loops, **always pass `--provider` and `--model`** — do not rely on saved prefs alone.

Exception: `relay-ai claude --http-proxy` can intentionally omit both flags when the goal is to start on native Claude and expose compatible saved favorites. If the environment already uses a non-local `HTTP_PROXY`, `HTTPS_PROXY`, or `ALL_PROXY`, this mode exits instead of replacing it; proxy chaining is not supported yet.

### Examples

```bash
# Claude — explicit boot
relay-ai claude --provider groq --model llama-3.3-70b-versatile -p "Summarize README.md"

# Claude — use Kimi alongside the normal Anthropic models
relay-ai claude --http-proxy --provider moonshot --model kimi-k3 -p "Review this diff"

# Claude — slug
relay-ai claude --model zen__deepseek-v4-flash-free -p "Review this diff"

# Codex — explicit boot
relay-ai codex --provider openai --model gpt-5.4 exec "implement feature X"

# Codex — slug
relay-ai codex --model zen__deepseek-v4-flash-free exec "fix the test"

# Gemini — explicit boot
relay-ai gemini --provider google --model gemini-2.5-flash -p "Review this file"

# Gemini — slug
relay-ai gemini --model zen__deepseek-v4-flash-free -p "Refactor the module"
```

---

## Clean stdout for NDJSON / JSONL (alef-agent)

When an agent parses **every line on stdout as JSON**, relay-ai must not print boot UI (intro, spinner, proxy banners) on stdout.

relay-ai detects machine-readable mode and **suppresses all boot UI on stdout**. Messages still go to **stderr**.

| Agent | Trigger | Child output |
|-------|---------|--------------|
| Claude | `-p` + `--output-format stream-json` or `json` | NDJSON (one JSON object per line) |
| Claude | `-p` + `--input-format stream-json` | NDJSON |
| Codex | `exec --json` | JSONL event stream |
| Gemini | `-p` + `-o stream-json` or `json` | NDJSON |

**Claude `--verbose`:** required by Claude Code for `stream-json` in print mode. relay-ai **auto-adds `--verbose`** when missing.

**Verify clean stdout:**

```bash
relay-ai claude --provider zen --model deepseek-v4-flash-free \
  -p "PONG" --output-format stream-json 2>/dev/null \
  | node -e "process.stdin.on('data',d=>d.toString().split('\n').filter(Boolean).forEach(l=>JSON.parse(l))); console.log('ok')"

relay-ai codex --provider zen --model deepseek-v4-flash-free \
  exec --json "PONG" 2>/dev/null \
  | node -e "process.stdin.on('data',d=>d.toString().split('\n').filter(Boolean).forEach(l=>JSON.parse(l))); console.log('ok')"

relay-ai gemini --provider zen --model deepseek-v4-flash-free \
  -p "PONG" -o stream-json 2>/dev/null \
  | node -e "process.stdin.on('data',d=>d.toString().split('\n').filter(Boolean).forEach(l=>JSON.parse(l))); console.log('ok')"
```

Interactive TTY launches (`relay-ai claude` with no `-p`) still show the normal human UI on stdout.

---

## Codex sandbox (network for shell tools)

`relay-ai codex` defaults to **`danger-full-access`**:

1. Written into the temporary launch profile (`sandbox = "danger-full-access"`)
2. Passed on spawn as `-s danger-full-access` (needed on macOS even when in profile)

This lets Codex shell tools reach the network (`curl`, `nlm`, npm, MCP CLIs).

**Override for one session:**

```bash
relay-ai codex -s workspace-write exec "task"
```

**Bypass sandbox and approvals entirely** (pass-through Codex flag):

```bash
relay-ai codex --dangerously-bypass-approvals-and-sandbox exec "task"
```

`relay-ai codex-app` (desktop app) does **not** change your personal `~/.codex/config.toml` sandbox — edit that file yourself if needed.

See also [docs/CODEX.md](CODEX.md#sandbox-and-network-cli).

---

## Provider discovery

**Machine-readable catalog (recommended for agents):**

```text
~/.relay-ai/providers.json
  → providers[].id
  → providers[].modelsCache.models[].id
  → providers[].enabled
```

**Refresh stale model lists:**

```bash
relay-ai providers refresh-models
relay-ai providers refresh-models groq
```

**Built-in cloud providers** (not in `providers.json`):

| id | Requires |
|----|----------|
| `zen` | `OPENCODE_API_KEY` |
| `go` | `OPENCODE_API_KEY` |

**Preview without launching:**

```bash
relay-ai claude --dry-run --provider groq --model llama-3.3-70b-versatile
relay-ai codex --config --provider zen --model deepseek-v4-flash-free
```

---

## Tool calling & MCP

**Claude Code** — pass tool flags **after** relay-ai boot flags (they go to Claude):

```bash
relay-ai claude --provider google --model gemini-2.5-flash \
  -p "How many notebooks?" \
  --output-format stream-json \
  --allowed-tools mcp__notebooklm-mcp__notebook_list
```

**Codex** — MCP servers come from your Codex config (`~/.codex/config.toml`), not from relay-ai. With default `danger-full-access`, network-blocked MCP/CLI errors from the sandbox should be resolved; MCP must still be configured in Codex itself.

---

## Multi-model agent loops

```bash
for model in llama-3.3-70b-versatile mixtral-8x7b-32768; do
  relay-ai claude --provider groq --model "$model" -p "Same prompt for all models"
done

for model in deepseek-v4-flash-free qwen3.6-plus-free; do
  relay-ai codex --provider zen --model "$model" exec --json "Same task"
done

for model in gemini-2.5-flash gemini-2.5-pro; do
  relay-ai gemini --provider google --model "$model" -p "Same task"
done
```

By default, boot flags use **single-model Relay-only launch** (favorites catalog is skipped) — better for one-shot agent jobs. Claude's `--http-proxy` flag is the exception: it adds the selected compatible model and compatible saved favorites to the mixed Anthropic + Relay session.

---

## Zen / Go cloud providers

For Claude `-p` and Codex `exec` against OpenCode Zen or Go:

- Pass `--provider zen` or `--provider go` explicitly in agent configs
- Ensure `OPENCODE_API_KEY` is in the environment or OS keychain (relay-ai resolves it before launch)

---

## Codex proxy notes (DeepSeek / reasoning models)

Non-OpenAI models routed through relay-ai's Codex proxy use the Responses API adapter. **Reasoning content** from thinking models (e.g. DeepSeek) is round-tripped on tool loops so turn 2+ does not fail with missing `reasoning_content`.

---

## Alef-agent integration

alef-agent shells out to CLI backends and parses **NDJSON/JSONL on stdout**. Use relay-ai as the **wrapper executable** with boot flags prepended.

### Recommended spawn configs

**Claude backend (stream-json):**

```bash
relay-ai claude \
  --provider <provider-id> \
  --model <model-id> \
  -p "<prompt>" \
  --output-format stream-json \
  [--verbose] \
  [additional claude flags: --max-turns, --permission-mode, --allowed-tools, …]
```

**Codex backend (exec --json):**

```bash
relay-ai codex \
  --provider <provider-id> \
  --model <model-id> \
  exec --json "<prompt>" \
  [additional codex flags]
```

**Gemini backend (stream-json):**

```bash
relay-ai gemini \
  --provider <provider-id> \
  --model <model-id> \
  -p "<prompt>" \
  -o stream-json \
  [additional gemini flags]
```

### alef-agent checklist

1. **Executable:** `relay-ai` (must be on `PATH`; `npm link` after dev builds)
2. **Always set** `--provider` + `--model` (or slug on `--model`) in backend config
3. **Claude:** use `--output-format stream-json`; relay-ai adds `--verbose` if needed
4. **Codex:** use `exec --json` (not `-p` — in Codex, `-p` means profile)
5. **Gemini:** use `-o stream-json` or `-o json` with `-p`
6. **Parse stdout only** — relay-ai boot/errors on stderr in machine-readable mode
7. **Codex network:** default sandbox is already full access; no extra `-s` needed
8. **Discovery:** run `relay-ai --ai` or read `providers.json` to populate alef model lists
9. **Skill:** `relay-ai --ai --install` drops `relay-ai-cli/SKILL.md` into `~/.agents/skills/` and other agent skill dirs

### Stdout contract (summary)

```
stderr  → relay-ai boot/errors (safe to log, ignore for parsing)
stdout  → child NDJSON/JSONL only (when stream-json / exec --json)
exit    → relay-ai exit code (non-zero on launch/config errors)
```

The full Alef section is also embedded at the bottom of `relay-ai --ai` output.

---

## Agent rules of thumb

**Do:**

- Run `relay-ai --ai` when unsure
- Use `--provider` + `--model` for every headless invocation
- Use Claude `-p` / Codex `exec` for one-shots that must exit
- Read `providers.json` for authoritative model ids
- Send machine-readable flags so stdout stays parseable

**Don't:**

- Rely on interactive wizards in CI or agent loops
- Pass `--provider` / `--model` to Claude, Codex, or Gemini directly — relay-ai consumes them
- Use Codex `-p` for print mode (it's `--profile` in Codex)
- Expect favorites catalog in print/exec mode — use explicit boot flags
- Edit `~/.claude/settings.json`, `~/.gemini/config/config.json`, or `~/.codex/config.toml` from relay-ai — it uses env + temporary overlays

---

## Troubleshooting (agents)

| Symptom | Fix |
|---------|-----|
| JSON parse error on first stdout lines | Missing `--output-format stream-json` (Claude) or `exec --json` (Codex) |
| `Print mode requires --provider and --model` | Add boot flags or run interactive once to save prefs |
| `requires an interactive terminal` (Codex) | Add `--provider` and `--model` |
| Zen/Go "Not logged in" | Set `OPENCODE_API_KEY`; use `--provider zen` explicitly |
| Codex shell network blocked | Should be default now; try `relay-ai codex --config` and confirm `sandbox = "danger-full-access"` |
| DeepSeek tool loop 400 | Update relay-ai — reasoning round-trip fix in Codex proxy |
| Stale overlay after crash | `relay-ai codex --restore` |

See [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) for general relay-ai issues.
