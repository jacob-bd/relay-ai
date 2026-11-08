# Relay Free Pool

> **Experimental.** The pool has been exercised end to end in Claude Code, Codex CLI, the
> ChatGPT/Codex app, Claude Desktop, the Antigravity CLI, the Antigravity app and the Antigravity IDE.
> It is still new: behavior, limits and settings can change between releases. Please report problems.

Relay Free Pool is one virtual model, **Relay Free Pool**, backed by the free models you add. Relay tries
them in the priority order you set. If a member fails before any output has been sent, Relay tries the
next one. The pool never uses a model outside your list, and it never runs tools itself.

Part A below is for users. Part B is for developers who need to change the pool safely.

---

# A. Using the pool

## Add, order and test members

Open **Free Pool** in `relay-ai ui`, or use the CLI. The page lists every free model Relay can use, with
its provider account, context size, price, a Test button and **+ Add to pool**. Hidden models and models
below the 128K context floor are left out. Search and the context
filter narrow the candidate list. Two accounts of the same provider are separate entries even when they
offer the same model.

| UI action | CLI command |
| --- | --- |
| Free models and total | `relay-ai pool candidates` |
| Search and context filter | `relay-ai pool candidates --search kimi --min-context 128000` |
| Readiness and provider details | `relay-ai pool status` |
| Saved membership and receipts | `relay-ai pool list` |
| Turn the pool on or off | `relay-ai pool enable` / `relay-ai pool disable` |
| + Add to pool | `relay-ai pool add <provider-account> <model>` |
| Remove | `relay-ai pool remove <provider-account> <model>` |
| Priority up / down | `relay-ai pool move <provider-account> <model> up` / `down` |
| Test | `relay-ai pool test <provider-account> <model>` |
| Recheck saved members | `relay-ai pool verify` (add `--reasoning` to also recheck effort) |
| Advanced: measure context | `relay-ai pool context <provider-account> <model>` |
| Advanced: set context | `relay-ai pool context <provider-account> <model> 128000` |
| Advanced: reset context | `relay-ai pool context <provider-account> <model> reset` |
| Advanced: reasoning | `relay-ai pool reasoning <provider-account> <model>` |
| Hide / unhide in provider lists | `relay-ai pool hide <provider-account> <model>` / `unhide` |
| Pool effort | `relay-ai pool effort auto` (also `low`, `medium`, `high`) |

Use the exact account and model ids that `candidates` prints. Adding, removing, reordering, enabling,
refreshing the list and launching never send a request. Only Test, `verify`, reasoning checks and
real pooled traffic do.

Only models Relay judges free are candidates: a zero price for input and output, the user's own
local or LAN endpoint, or a provider whose free access has no billing path (Nvidia's developer access).
If a gateway lists no price, or lists prices but does not charge your key, use **Mark free** on the
Providers page. That mark is your own risk call, is stored with the provider, and still requires a
passing Test before the model routes. Community free-provider lists are leads, not guarantees; check each
provider's terms before relying on it.

## What a Test proves

A Test sends **one small inference request**: at most 1024 output tokens, no retries, no tool execution
and no follow-up loop. It asks for a short reply and one harmless structured tool call. A valid tool
call proves the model can answer and use tools even when it writes no introductory text. A text-only
answer can show that the model responds, but it does not make the model pool-ready.

The result is saved as a **receipt**. A receipt records the member, the exact endpoint configuration,
the context window, whether tools passed, the effort levels that were verified, and that routing is
billing-safe. A passing receipt makes the member **Ready** on the Free Pool page.

Receipts are stored in `~/.relay-ai/config.json` under `freePool.receipts` (override the home folder with
`RELAY_AI_HOME`). They **do not expire with time**. A receipt stays valid until the member's endpoint
changes or the member is removed. The endpoint revision covers the provider account, auth reference, npm
package, base URL, upstream model id and static headers, so changing any of those, or moving to another
account, invalidates the old Test. A failed Test clears the saved receipt, and the model stops routing
until it passes again. There is no background retest.

`relay-ai pool verify` rechecks saved members and skips ones that are already Ready, so its printed
count is the upper bound of requests it may send. `relay-ai pool verify --reasoning` does not skip Ready
members and adds up to four effort checks per member. Prefer a single Test when allowances are tight.

> The 0.20.0 CLI help, the end of `relay-ai pool verify`, and the Free Pool page help still print an older
"24 hours" note in a few places. Routing does not enforce an expiry; the receipt rules in this document
describe what the code does.

Optional checks cost extra requests and say so before running:

- **Measure context**: one extra request that asks for an oversized output so the server reports its
  real limit. Some servers do not report one. A rejection can still consume quota. It is available for
  custom endpoints and free models, not built-in paid models.
- **Check reasoning**: one capability request plus up to four small checks (at most five requests). Only
  levels that passed are recorded. Antigravity does not need a passing effort level because it always
  has an Auto row that sends no effort.
- **Set or reset context**: no inference. A value you type always wins over a later measurement.

## Priority order is strict

Members are tried in exactly the order shown, from the top. There is no round-robin balancing and no
preference for the model with the largest context window. The order is your quality ranking.

Relay considered round-robin balancing and decided against it as the default. Balancing helps replicas
of one model, while pool members are different models: rotating between them mid-conversation changes
the style and the reasoning, and it costs the provider's prompt cache on every switch. Rotating between
providers that serve the **same** model is a possible future option; balancing different models is not.

## Disabled members

A member the provider says is gone stays in the list, marked **Disabled** with the reason. It is skipped
by every launcher, a red banner appears on the Free Pool page, and a red line prints at launch and at the
top of `relay-ai pool log`. Only a passing Test (UI, `relay-ai pool test`, or `relay-ai pool verify`)
clears it.

Disabling happens only on an explicit verdict:

- the model does not exist, was deprecated, retired, decommissioned or shut down;
- its free access or promotion ended;
- the account's plan does not include it; or
- a bare 404 or 410 with no explanation arrives twice, the second time from the recovery probe after the
  first failure's cooldown ended.

Nothing else disables a member. A 429, a server error, a timeout, a generic 400 or 422 rejection, a
"does not support tools" answer, a 401, or exhausted credits (402) only cool the member down. Repeated
generic failures never disable it automatically.

## Effort and reasoning

A reasoning level is sent only when the member's saved Test verified that exact level. Otherwise the
field is omitted and the provider applies its own default. The pool effort choice (`auto`, `low`,
`medium`, `high`) applies when the tool does not send a level of its own; a level the tool sends still
has to be verified for that member.

Antigravity has no effort control, so the pool appears there as one row per effort level that **every**
eligible member verified, or as a single **Relay Free Pool** row that sends no effort at all.

## Tools and context

Relay sends at most 128 tools to a pool member. The client executes tools; Relay never executes a tool
inside the proxy, and pool requests carry no executable tool definitions.

Each request is checked against each member's own context window. The window shown to the client is the
largest verified member's window minus a 10 percent reserve (at least 4096 tokens), so one small member
never caps a pool of large models. A member too small for a given request is passed over for that request
(no failure, no attempt used). If the request is larger than every available member's window, the call
fails with "No eligible free pool members" and the log names each member's reason.

## Starting a session on the pool

Turn the pool on once with **Add Relay Free Pool to my launches** or `relay-ai pool enable`. After that
it is offered in every supported launch, next to the model you picked and your favorites. It is never
selected for you.

| Tool | How the pool appears |
| --- | --- |
| Claude Code | **🏊 Relay Free Pool** under Favorites Catalog, and as an extra model in a switching session. `relay-ai claude --pool` starts directly on it, Relay models only. |
| Codex CLI | **🏊 Relay Free Pool** in the provider list. Picking it opens the session on the pool inside Native + Relay or your favorites; `relay-ai codex --pool` starts a pool-only session. |
| ChatGPT/Codex app | An extra model in the catalog, or the model the session opens on. |
| Claude Desktop | An extra model after your chosen model and favorites, or the model the session opens on. |
| Antigravity CLI, app and IDE | **🏊 Relay Free Pool** in the launcher, its effort rows reserved first in the catalog. |
| Relay API gateway (`relay-ai server`, Docker Admin UI) | While the gateway is running, **Relay Free Pool** (`relay-free-pool`) appears in `GET /anthropic/v1/models` and `GET /openai/v1/models` and answers on both `/anthropic/v1/messages` and `/openai/v1/chat/completions`. Anthropic traffic uses the Claude pool runtime; OpenAI Chat Completions uses the Core pool model. The gateway reads the pool settings when it starts, so restart it after enabling the pool or changing its members. |
| Embedded apps (Relay Core) | **Relay Free Pool** is listed by `listRelayModels()` as `relay-free-pool::relay-free-pool`, and `createRelayModel()` returns a model that fails over across your members. Pool settings are read on every call; cooldown state and the activity log (target `core`) are shared with the CLI launchers. Pass a `sessionId` to keep a conversation on the member that last answered it. See "Relay Free Pool (experimental)" in [CORE.md](CORE.md). |

A pool launch needs at least one member with a passing receipt for that tool. Antigravity additionally
refuses members below its 136K context floor (128K of input plus an 8K output budget).

## Watching requests

`relay-ai pool log` shows the model that answered last and then a line only when something happens: a
failover, a switch of the answering model, or a request nobody answered. Normal requests are counted but
not printed. `relay-ai pool log -f` keeps watching, `-v` prints one line per request, and a number sets
how many events to show (default 20). The **Pool Activity** page in `relay-ai ui` shows the same; tick
**Show every request** for all of it. `relay claude --trace` also writes attempt lines to the proxy debug
log.

An example of a session that failed over once and then stayed on the second model:

```
Current model: deepseek/direct/deepseek-v4-flash-free since 14:25:03
14:25:03  ✓ deepseek/direct/deepseek-v4-flash-free answered in 2.4s  · switched from kilo/reflection/beam-free
      ✗ kilo/reflection/beam-free failed: rate limit (429)
          free-models-per-day exceeded (HTTP 429)
      (12 earlier requests answered normally)
```

The backend's own text is shown after the arrow, with credentials redacted and the text capped. Logs stay
on this computer at `~/.relay-ai/logs/pool-activity.jsonl` and never contain prompts or responses.

## Simulating a failure

The quickest check needs no names. With a session running, run `relay-ai pool fail`. It forces whichever
member answered last to fail. Send a message and the next member answers; run it again to walk further
down the list. `relay-ai pool force-fail off` clears everything.

To name members yourself, run `relay-ai pool force-fail <provider>/<model> ...` (several ids allowed,
`--minutes N` up to 60; the default is 10 minutes). A forced member fails **before any request is sent**,
appears as `simulated failure (test switch)` in the log, records a one-minute cooldown, and the next
member answers. A session started with the same build reads the switch on every request. You can also
fix the list when a tool starts with `RELAY_POOL_FORCE_FAIL="kilo/reflection/beam-free"`. Clearing the
switch restores normal behavior immediately.

## What to expect during a failover

- Relay tries at most **8 members per request**, within a **60 second** total budget. A member gets
  **20 seconds** to produce its first content, and **20 seconds** between events after that.
- Failover happens only before output is committed, meaning before the first text, reasoning or tool-call
  event is passed to the client. Once that happens the request is committed and is never replayed.
- If a member fails after output has started, the client receives an error for that turn. The failure is
  logged and the member is demoted. No other member is tried for that turn, because replaying would
  duplicate work the client may already have acted on. The next turn uses the remaining members.
- A failed member is moved back in line. Server errors and timeouts cool it for 60 seconds, access
  errors (401/403/404) for 5 minutes, unknown errors for 30 seconds, doubling on repeats up to 10
  minutes. A rate limit uses a longer ladder (2 minutes, 10 minutes, 1 hour, 6 hours, 24 hours) or the
  provider's own `Retry-After`.
- A rate limit or exhausted credit applies to the **whole provider account**, so the other pool models on
  that account wait too. Other failures only demote the model that failed.
- A rejected request (400/422) or an oversized one never demotes anything; Relay just moves on.
- Cancelling a request stops the failover. Cancellation never counts against a member.

## Known limitations

- **Experimental.** Free models differ in quality and can be slow, rate-limited or withdrawn without
  notice.
- **Strict order, no balancing.** A quota or rate limit moves traffic to the next member rather than
  spreading it, and a low-priority member is never used while higher ones are healthy.
- **No failover after the first byte.** A stream that dies mid-answer ends that turn with an error.
- **Receipts do not expire.** A member that passed once keeps showing Ready until it is tested again, even
  if the provider changes something behind the same endpoint.
- **History for Codex lives in Relay's memory.** It lasts one hour and is lost when Relay exits. A
  conversation that resumes with `previous_response_id` after Relay restarted cannot continue on the
  pool; start a new thread.
- **Restart sessions started before upgrading.** The shared health file now carries `quota` and
  `disabled` entries. An older Relay process that reads them can treat the file as corrupt.
- **Windows paths are unverified** for the pool's app launches.

---

# B. Inside the pool

The shared code is in `src/pool/`. Each tool has a thin adapter; the eligibility rules, attempt loop,
health store and receipts are shared.

| File | Responsibility |
| --- | --- |
| `dispatch.ts` | Cheap admission, forced-failure switch, session pinning, the "No eligible free pool members" message |
| `attempt.ts` | `runPoolAttempts`: limits, buffering, commit, cleanup, attempt accounting |
| `lazy-route.ts` | Defers expensive per-member preparation to the moment of the attempt |
| `errors.ts` | Failure classification, retry decision, disable verdicts |
| `health.ts` | `PoolHealthStore`: cooldowns, recovery claims, disabled entries, locking |
| `capabilities.ts` | Endpoint revision, receipt validation, context estimate |
| `enroll.ts`, `probe.ts`, `verify.ts` | Test, enrollment, optional effort checks |
| `catalog.ts` | The advertised pool model (window and effort ladder) |
| `sdk-route.ts` | One provider call through the Vercel AI SDK, with health recording |
| `claude-*.ts`, `codex-*.ts`, `antigravity*.ts` | Per-tool translation, launch and protocol adapters |
| `activity.ts`, `command.ts`, `force-fail.ts`, `disabled.ts` | Log, CLI, test switch, disabled-member notices |

## Routing

`dispatchFreePool` receives the saved members in user order and the routes the adapter prepared.
`evaluatePoolMembers` walks `pool.members` in that order and returns a verdict for every one, even
ineligible ones. No sorting happens anywhere: there is no context-size preference, no cost preference
and no balancing. That is deliberate. Balanced rotation makes sense for replicas of one model; these are
different models, so a switch changes behavior and loses provider-side prompt cache.

The session pin is the one exception to "first eligible wins". `PoolSessionRoutes` remembers the member
that answered a conversation scope and moves it to the front for the next request, for up to an hour.
This keeps a conversation on one model while it works. It only reorders members the request is already
allowed to use.

## Attempts, commit and failure

`runPoolAttempts` owns the only retry loop. Per request: `MAX_POOL_ATTEMPTS = 8`, `firstContentMs =
20_000`, `idleMs = 20_000`, `totalMs = 60_000`, `bufferBytes = 65_536`, `cleanupMs = 1_000`.

Events are buffered until something meaningful arrives (text or reasoning with content, tool input or a
completed tool call, or a valid finish). At that point the attempt is **committed**: the buffered events
are yielded to the client and the attempt can no longer be replaced. If the buffer exceeds 64 KB before
that, the member fails as `provisional-buffer-limit`.

An attempt must end in a `finish` with reason `stop`, `tool-calls` or `length`; a bare end of stream,
an invalid finish, an error event, a timeout or a cleanup failure that cannot close the transport is a
failure. A timeout caused by the shared 60 second budget rather than the member's own allowance does not
count against the member and records no cooldown.

After a failure that follows commit, the attempt throws `PoolAttemptError('attempt-failed', true, ...)`.
The dispatcher never loops again in that case. The provider call is closed with a bounded `return()` so
Relay does not leave the upstream streaming, and the failure is logged and recorded. A consumer
(socket or formatter) that throws is not a provider failure: it is rethrown without cooling the member
and without a second provider call.

## Lazy preparation

Every adapter builds one `PoolRoute` per saved member. The cheap checks run up front:

- the provider and model still exist in the registry and use a supported transport;
- a receipt exists for the member, and its `endpointRevision` matches the current configuration;
- the model is still verified free and the receipt covers this target (`claude`, `codex`,
  `antigravity`, `core`). Test results saved before a target existed need no re-test: the parser adds `antigravity` and `core`.

Everything expensive is deferred to `admit()`, which `runPoolAttempts` calls only when the request
actually reaches that member: reading the disabled entry and cooldown, resolving the provider credential,
building the SDK language model, translating and trimming the request, checking the context fit, and
choosing the effort level. A member skipped at admission **does not use an attempt**: the counter counts
only routes whose `open()` ran.

If no member is admitted, the error starts with
`No eligible free pool members: <provider>/<model>: <reason>; ...`. Reasons are short fixed strings
(`cooling down after a failure`, `no credential`, `request too large for its context window`,
`DISABLED: ...`), never upstream text.

## Receipts

`poolEndpointRevision` hashes `[providerId, authRef, npm, baseURL, upstreamModelId, sorted headers]`.
A receipt only matches the exact revision it was created for, which is why changing an account, base
URL, headers or the upstream model id silently retires old evidence. A Test writes a receipt with the
targets, tool result, context window and source, maximum output tokens and the effort levels that
answered. `receiptInForce` ignores `expiresAt`; the field is kept for saved-data compatibility only.
A receipt is cache, never authority: `parsePoolReceipt` rejects malformed values, and a failed Test
removes the entry.

`relay-ai pool verify` walks saved members, skips ones the UI would show as Ready (unless `--reasoning`
is given), and replaces receipts for the members it rechecks. `verifyUiPoolMember` is the shared UI and
CLI Test path. A passing Test also clears the member's disabled entry.

## Health and cooldowns

`PoolHealthStore` uses `<RELAY_AI_HOME>/pool/health.json` (default `~/.relay-ai/pool/health.json`),
shared by every tool and process. It holds no prompts, responses, headers or credentials, and it is
written through a lock file with an atomic rename.

Scopes:

- `model:<provider>/<model>` for one model on one account;
- `account:<provider>` for the whole provider account, used by 429 and 402;
- `endpoint:<provider>/<revision>/<model>` for disabled entries and cooling checks.

Entry reasons are `rate-limit`, `quota`, `transient`, `access`, `unknown` and `disabled`. A success
clears a member's non-disabled entry. Short cooldowns are 60 seconds for transient failures, 5 minutes for
access failures and 30 seconds for unknown ones, doubling on repeats up to 10 minutes. Rate limits and
quota use the 2 minute, 10 minute, 1 hour, 6 hour, 24 hour ladder unless the provider sends `Retry-After`.
Context, invalid-request and cancellation failures are never written.

When a cooldown expires, `acquire()` grants exactly one cross-process **recovery claim**. A claim held by
a live pid is never taken over, however old it is; a claim whose pid is gone can be reclaimed. A
successful recovery deletes the entry, a failed one raises the ladder, and a cancellation drops the claim
without changing the rung. If a claim is superseded by a concurrent failure, a later success only
releases the claim and leaves the newer cooldown in place. An unreadable health file fails closed with
`PoolHealthStateCorruptError`; it is never rewritten.

A disabled entry lasts until a Test clears it (the stored deadline is far in the future). Nothing else,
including a successful request, can soften it.

## What disables a member

`errors.ts` classifies one failure into a `PoolFailure`. `poolFailure` reads the status and the first
2000 characters of the provider's message. Disabling notes come only from `disablingNote`, and only for
statuses in `VERDICT_STATUSES` (400, 402, 403, 404, 410): `PROMO_PATTERN` (the model's free access or
promotion ended, or it is not in the plan) or `GONE_PATTERN` (the model does not exist, was deprecated,
retired, decommissioned or shut down). A bare 404 or 410 is `missing`; it cools like an access failure and
turns into `disabled` only if the next failure arrives after that cooldown, which is the recovery probe's
second opinion. A 401 is always `access`, a 402 is `quota`, and a generic 400 or 422 is `invalid`. None
of those disable anything.

`retryPoolFailure` returns true for everything except cancellation. A member-specific rejection says
nothing about the next member, so any pre-commit failure moves on, within the attempt and time budgets.

## Effort

`poolMemberEffort(requested, receipt)` is the single rule: `auto` or an unverified level returns `null`
and the adapter omits the field; a verified level is passed through. Codex additionally refuses a route
whose translation would inject an effort (`translatedEffortClaim`), so an omission never silently becomes
a different level. Claude's version omits `output_config.effort`; Codex's omits `reasoning.effort`.

The advertised ladder (`poolCatalogEntry`) is the intersection of every ready receipt's levels, so a
client only sees a level every member can honor.

## Tools and context

`POOL_MAX_TOOLS = 128` is applied in every adapter (Codex, Claude and the Antigravity gateway). Codex
lists its own core tools first, so the cap drops MCP tools before core ones. `sdkPoolRoute` refuses any
tool definition with an `execute` function: Relay formats tools for the client and never runs them. The
Test tool is inert for the same reason.

`estimatePoolRequestTokens` serializes the translated request, removes binary and image payloads, and
uses UTF-8 bytes divided by 2, plus 4096 tokens per image and half the size of non-image binary. That is
conservative, not a tokenizer. `poolRequestFitsWindow` adds the output reservation and a margin of
`max(4096, 10% of the window)`. The advertised window is the largest ready member's window minus the
same reserve, floored at 1024. A provider that still rejects the request for size fails before commit
and the pool moves on.

## Per-tool adapters

**Claude Code** (`claude-runtime.ts`, `claude-prepare.ts`). Each member gets its own translation with the
Anthropic SDK adapter. A global `ClaudePoolSignatures` map records which route produced each thinking
signature and tool-call id, keyed by route (`provider`, `revision`, `model`). History is sanitized per
attempt: reasoning parts from another route are dropped, `providerOptions` are stripped, and a signature
or tool id is restored only when this route produced it. This prevents one member's opaque signature
from being sent to another, which Gemini and Anthropic both reject. `ClaudeHistoryEmbargo` suppresses an
identical request that is already in flight (same client session plus full-body hash) and blocks an
identical retry after a post-commit failure. It is duplicate suppression, not turn identity.

**Codex CLI and app** (`codex-runtime.ts`, `codex-prepare.ts`, `continuation.ts`, `codex-retry.ts`).
Requests are Responses API shaped. `PoolContinuationStore` keeps the resolved history Relay owns for
`previous_response_id`: 1 hour TTL, at most 2000 entries, 2000 items and 4 MB per snapshot, 128 MB total,
least recently used evicted first. A `previous_response_id` without owned history is refused with
`unsupported-continuation`, rather than rebuilt from whatever the client sent. Call ids keep their route
of origin, so a switch strips foreign signatures and reasoning. `CodexRetryGuard` keys a request by the
client turn id plus a hash of the translated body: an identical in-flight retry is `busy`, an identical
success is replayed from memory, and an identical post-commit failure stays blocked for its TTL.
`PoolSessionRoutes` pins the conversation to the answering member. Remote compaction is requested with a
`compaction_trigger` input item; the member is given no tools and a summary instruction, its text is held
until it finishes, and Codex receives a single compaction item. The stored history for that turn is the
summary, so later turns continue from it.

Claude and Codex both expose the pool through their ordinary catalogs. When the pool is enabled,
`additivePoolPreferences` adds one catalog entry built from `codexPoolCatalogModel` / `poolCatalogEntry`,
with the advertised window and only the common verified effort levels. A stale member never hides the
pool while another verified member remains.

**Antigravity** (`antigravity.ts`, `antigravity-runtime.ts`, `cloud-code-gateway.ts`). The catalog has
no effort control, so `buildAntigravityPoolRoutes` emits one row per offered common level, plus an **Auto**
row that sends nothing, and each row carries its same-effort member routes. Rows are hyphen-only ids
(the IDE hides ids containing underscores) and are reserved first in the catalog before favorites'
effort variants. Members below `ANTIGRAVITY_MIN_CONTEXT_WINDOW` (128000 input plus 8192 output, 136192
total) are excluded. The gateway runs every pool row through the shared coordinator: `prepareAntigravityPoolRoutes`
per member, then `dispatchFreePool`. Non-streaming gateway replies can replace a member after its output
because nothing has been written to the client yet; streaming replies cannot, for the same commit rule as
the other tools.

**Claude Desktop and the ChatGPT app** use the same Claude pool runtime and Codex pool runtime. Claude
Desktop adds the pool after your chosen model and favorites, or first when the session starts on it; the
app uses the additive catalog entry in mixed mode.

## Observability

`recordPoolActivity` appends one JSON line per attempt outcome to
`~/.relay-ai/logs/pool-activity.jsonl`, capped at 256 KB and trimmed to the newest 500 lines. An entry holds
the time, target, `served` / `failed` / `gave-up`, a request id that ties concurrent attempts together,
the member, a fixed reason, a redacted detail capped at 200 characters, and a duration. It never holds
prompts or keys. `readPoolActivity` reads the newest lines; `followPoolActivity` tails the file and
restarts if it shrinks; `groupPoolActivity` and `PoolEventFilter` turn attempts into per-request summaries
and then into event lines.

`relay-ai pool log` prints the current answering model and the events since, `-v` prints every request,
and `-f` follows. The Free Pool page reads the same file through the UI API. `--trace` adds attempt,
failure and answer lines to the proxy's debug log.

For failure tests, `force-fail.ts` reads `RELAY_POOL_FORCE_FAIL` and `~/.relay-ai/pool-force-fail.json`
on every request. A forced member is wrapped with an `open()` that records a 60 second transient cooldown
and then throws a 429-shaped error, so the coordinator's normal path produces the usual log entry without
any network call. The file form expires (default 10 minutes, maximum 60) so a test cannot be left on by
accident.

## Changing it safely

- Keep routing order deterministic. Do not sort members or add balancing without changing the product
  decision and its documentation.
- Keep admission cheap. Anything that resolves a credential, builds a model or translates a request
  belongs inside `admit()`.
- Keep every failure classified in `pool/errors.ts`. Anything new that is retryable belongs in
  `retryPoolFailure`; anything that disables belongs in `GONE_PATTERN` or `PROMO_PATTERN`, and only for
  the verdict statuses.
- Keep receipt matching tied to `poolEndpointRevision`. A new credential or endpoint input must be added
  there or old evidence will keep routing to a different endpoint.
- Keep the per-route health scopes intact. A 429 that only cools one model re-enters the same account
  rate limit on its sibling.
- Keep the client as the only tool executor. Pool requests must never carry executable tools.
- The pool's tests live in `tests/pool-*.test.ts`, plus `tests/codex-pool-start.test.ts`,
  `tests/antigravity-pool-runtime.test.ts`, `tests/server-router-pool.test.ts` and
  `tests/ui-api-pool.test.ts`. The interactive launchers and the browser UI are verified manually.
