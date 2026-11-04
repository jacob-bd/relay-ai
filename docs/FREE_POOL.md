# Relay Free Pool

> **Experimental.** The pool is being tested with Claude Code first. Codex CLI, the ChatGPT/Codex app, the Claude desktop app and Antigravity are not yet verified, and behavior, limits and settings may change between releases. Expect rough edges; please report problems.

Relay Free Pool combines selected free models into one model in the normal tool switcher. Enable it once and Relay includes it in supported Claude, Codex and Antigravity launches. Favorites remain independent. Pool requests fall back only to eligible members. There are no separate pool launch buttons.

## UI and CLI equivalents

Open **Free Pool** in the UI. The table shows the total across configured providers, provider name pills, model type, context, pricing, Test, visibility, and **+** to add. Search and context filters narrow the list. Separate accounts remain separate entries even when they offer the same model.

| UI action | CLI command |
| --- | --- |
| Free models and total | `relay-ai pool candidates` |
| Search and context filter | `relay-ai pool candidates --search kimi --min-context 128000` |
| Refresh displayed list | Run `relay-ai pool candidates` again; no inference |
| Readiness and provider details | `relay-ai pool status` |
| Saved membership and receipts | `relay-ai pool list` |
| Enable / disable | `relay-ai pool enable` / `relay-ai pool disable` |
| + Add to Pool | `relay-ai pool add <provider-account> <model>` |
| Remove | `relay-ai pool remove <provider-account> <model>` |
| Priority up / down | `relay-ai pool move <provider-account> <model> up` / `down` |
| Test | `relay-ai pool test <provider-account> <model>` |
| Advanced: measure context | `relay-ai pool context <provider-account> <model>` |
| Advanced: set context | `relay-ai pool context <provider-account> <model> 128000` |
| Advanced: reset context | `relay-ai pool context <provider-account> <model> reset` |
| Advanced: reasoning | `relay-ai pool reasoning <provider-account> <model>` |
| Hide / unhide | `relay-ai pool hide <provider-account> <model>` / `unhide` |
| Reasoning effort | `relay-ai pool effort auto` (also low, medium, high) |

Use exact account and model IDs from `candidates`. `relay-ai pool --help` lists commands and request costs.

## Quota costs and readiness

**Test sends one small inference request**, at most 1024 output tokens, zero retries, no tool execution or follow-up tool loop. It asks for a short reply and a harmless structured tool call together. A valid tool call proves responsiveness even without introductory text. Results report response time and tool support. Text-only responses can pass responsiveness while remaining unverified for pool routing. Providers may count input tokens, reasoning or minimum charges too; even a short test can consume message allowance.

The same response supplies pool evidence without another verification request. Readiness also requires verified zero pricing (Nvidia's free developer access counts, because an account with no payment method can only be rate-limited, never charged; other provider-granted free access without a billing rule does not), supported transport, and a known context size. Unknown or estimated context needs measurement or a trusted manual value. Basic Test does not discover context or check reasoning levels.

**Advanced checks are optional** and display costs before running:

- Measure context: one extra request. An oversized output limit asks the server to report its context limit in a rejection. Some servers do not report it. Rejections may consume quota. Relay stops reading if text output begins.
- Check reasoning: one capability request plus up to four small reasoning checks, at most five total. Reasoning checks cap output at 32 tokens each with no retries. Only passing levels are recorded. Antigravity pool admission currently requires a passing reasoning-level check.
- Set/reset context: no inference. Manual values survive measurement.

Adding/removing models, changing priority or effort, enabling, refreshing the list, and launching never run tests. Results are cached for 24 hours and reused when a tested model is added later. Expiry stops routing that member until an explicit Test; there is no background retest. Failed explicit tests clear old readiness evidence.

`relay-ai pool verify` explicitly checks saved members and skips ready receipts. It prints the upper request count. `relay-ai pool verify --reasoning` explicitly adds reasoning checks. Prefer single-model Test when allowances are tight.

## Marking a model free yourself

Relay only pools models whose catalog reports a price of zero, so a gateway that lists no price
(or lists full prices but does not charge your key) is shown as "Unknown price" or "Paid".
On the Providers page, **Mark free** on a model row declares it free yourself. The model is then
eligible for the pool like any other free model: it still needs a successful **Test** before it
routes, and it can be unmarked at any time.

This is your own risk call. Relay cannot verify it, and nothing in an import or a refresh sets it.
If the provider bills you, that is on your account. The mark is stored beside the provider
(`freeModelIds`), so refreshing the model list never drops it.

### Where to look for free providers

These community lists are leads, not guarantees. Entries go stale, some need a card or phone
verification, and headline token totals add up per-provider caps nobody can use in full. Check
each provider's own terms before relying on it, then add it as a custom endpoint and mark the
models you trust:

- [awesome-freellm-apis](https://github.com/open-free-llm-api/awesome-freellm-apis)
- [Free-LLM](https://github.com/nejib1/Free-LLM)
- [FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi), a router that sells a paid catalog;
  Relay borrows its routing ideas only, not its provider or quota claims.

## Starting a session on the pool

- **Claude Code:** `relay claude` lists "🏊 Relay Free Pool" under *Favorites Catalog*.
- **Codex CLI:** `relay codex` lists the same entry. The session opens on the pool; with *Native + Relay*
  your normal Codex models and favorites sit beside it in `/model`, with *Relay models only* just your
  favorites do. With no favorites that mode is the pool alone. Codex requests are not yet written to
  `relay-ai pool log`.
- Other launchers do not offer the pool until each is confirmed working.

## Seeing which model answered, and checking failover

- `relay-ai pool log` shows the current model and a line only when something happens: a failover (a
  model failed before another answered), a switch of the answering model, or a request nobody could
  answer. Requests answered normally by the usual model print nothing; they are only counted.
  `relay-ai pool log -f` keeps watching; `-v` shows every request, one line each. Claude Code sends
  several requests at once, so lines are grouped per request. The Free Pool page shows the same under
  **Recent activity** (tick *Show every request* for all of them), and `relay claude --trace` adds
  detailed lines to the proxy debug log.
- The pool only moves to the next member when one fails, and a conversation stays with the member
  that last answered it. Seeing the same model reply across a long session is therefore normal.
- Quickest check: with a session running, run `relay-ai pool fail`. It forces whichever member answered
  last to fail (no names needed); send a message and the next member answers. Run it again to fail that
  one too and walk down the pool. `relay-ai pool force-fail off` clears everything.
- To prove failover works with your real members, or name the members yourself while a session is running:
  `relay-ai pool force-fail kilo/reflection/beam-free` (several ids allowed; `--minutes N` up to 60).
  It expires after 10 minutes by default, `relay-ai pool force-fail` shows what is active and
  `relay-ai pool force-fail off` clears it. Send a message and watch `relay-ai pool log -f`: the forced
  member shows as a failed "simulated failure (test switch)" and the next member answers. A session
  started with the same build reads the switch on every request. You can also fix the list when a tool
  starts with `RELAY_POOL_FORCE_FAIL="kilo/reflection/beam-free"`. Nothing is sent to a forced member and
  no cooldown is saved, so clearing the switch restores normal behavior immediately.

## What happens when a model fails

- Any failure before the model has written output moves the request to the next member (up to 8 per
  request, within a one-minute budget). A cancelled request stops.
- The failed member is demoted so it is not first in line next time: server errors and timeouts 60 s,
  access errors (401/403/404) 5 min, unknown errors 30 s, doubling on repeats up to 10 min. A rate
  limit uses the longer ladder (2 min, 10 min, 1 h, ...) or the provider's Retry-After.
- A rate limit applies to the whole provider account (free-tier limits are per account), so the other
  pool models on that account are skipped too. Other failures only demote the model that failed.
- A rejected request (400/422) or an oversized one never demotes anything; it just moves on.
- `relay-ai pool log`, the Free Pool page and the `--trace` log show every failure with its reason and
  the provider's own message (for example "free-models-per-day exceeded (HTTP 429)"), with credentials
  redacted and the text capped at 200 characters. They stay on this computer.
