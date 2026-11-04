# Relay Free Pool

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

**Test sends one small inference request**, at most 256 output tokens, zero retries, no tool execution or follow-up tool loop. It asks for a short reply and a harmless structured tool call together. A valid tool call proves responsiveness even without introductory text. Results report response time and tool support. Text-only responses can pass responsiveness while remaining unverified for pool routing. Providers may count input tokens, reasoning or minimum charges too; even a short test can consume message allowance.

The same response supplies pool evidence without another verification request. Readiness also requires verified zero pricing, supported transport, and a known context size. Unknown or estimated context needs measurement or a trusted manual value. Basic Test does not discover context or check reasoning levels.

**Advanced checks are optional** and display costs before running:

- Measure context: one extra request. An oversized output limit asks the server to report its context limit in a rejection. Some servers do not report it. Rejections may consume quota. Relay stops reading if text output begins.
- Check reasoning: one capability request plus up to four small reasoning checks, at most five total. Reasoning checks cap output at 32 tokens each with no retries. Only passing levels are recorded. Antigravity pool admission currently requires a passing reasoning-level check.
- Set/reset context: no inference. Manual values survive measurement.

Adding/removing models, changing priority or effort, enabling, refreshing the list, and launching never run tests. Results are cached for 24 hours and reused when a tested model is added later. Expiry stops routing that member until an explicit Test; there is no background retest. Failed explicit tests clear old readiness evidence.

`relay-ai pool verify` explicitly checks saved members and skips ready receipts. It prints the upper request count. `relay-ai pool verify --reasoning` explicitly adds reasoning checks. Prefer single-model Test when allowances are tight.
