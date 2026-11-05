# Relay Free Pool correctness fixes

Verified 2026-11-05. Scope: all eight confirmed issues from the pool review.

## Results

- Same six proof test files against an isolated copy of original HEAD source: **18 failed, 48 passed**.
- Same six files against fixed source: **66 passed**.
- Full repository suite: **286 files passed, 1 skipped; 3061 tests passed, 2 skipped**.
- TypeScript check and CLI/core builds passed. Built CLI reports package version 0.20.0.
- Git diff whitespace check passed.

The original-source check copied source and tests to a temporary directory, then replaced each changed pool source file with its HEAD content. It did not reset the working tree. No real provider credentials or user conversations were used; upstream integration tests use loopback HTTP fixtures and the installed SDK.

## Proof by issue

| Issue | Changed behavior | Regression proof |
| --- | --- | --- |
| History storage fails after terminal success | Store history before terminal success or executable tool completion reaches the client. Oversized history ends with failure, never success. | pool-review-regressions: post-terminal persistence. pool-codex-runtime: item overflow, byte overflow, tool output in both stream modes, immediate continuation inside terminal callback. |
| Extra 32-snapshot cap evicts live chat | One-hour default; 2000 snapshots; the 2000-item / 4MB limits stay per snapshot (as before). Total memory is bounded separately at 128MB, least recently used first, and the snapshot just stored is never evicted. Recently read branches are retained ahead of idle snapshots. | pool-continuation: retain across 40 other responses, entry-count and total-memory eviction, two ~1MB or 1,200-item sessions coexist. pool-codex-runtime: resume live branch after 40 other responses. |
| Claude tool cap omitted | Claude preparation supplies the same 128-tool cap as Codex. | pool-review-regressions: real preparation and installed SDK send exactly 128 of 300 tools to loopback upstream. |
| Screenshots counted as text | Reserve 4096 vision tokens per image part, wherever it sits (user turns and tool results), instead of counting Buffer JSON or base64 text; other binary is sized by bytes. Text and schemas retain bytes/2 estimation. | pool-context: 150KB Claude Buffer, Codex data URL and a tool-returned screenshot all fit 128K, including output/margin; original payloads remain unchanged. |
| Old recovery erases newer 429 | Persist superseded marker on an active claim when newer failure arrives. Success releases old claim while retaining newer failure. Failed settlement never shortens authoritative reset. | pool-review-regressions: successful recovery/newer reset. pool-health: both outcomes retain seven-day Retry-After. |
| Codex writes before failover decided | Hold formatter preamble until dispatch yields its committed stream. | pool-review-regressions: both member opens precede first write. pool-codex-response: zero writes when all attempts fail. |
| Coordinator timeouts never cool member | Coordinator-generated failures have a route health callback; cancellation and consumer errors do not enter that callback. | pool-review-regressions: real hanging HTTP upstream, first-content and post-content idle timeouts both persist cooldown. Existing attempt/cancellation/consumer tests remain passing. |
| Rejected finish marks recovery healthy | SDK wrapper and coordinator share valid-finish predicate. Coordinator validation errors persist failure health. | pool-review-regressions: installed SDK receives unrecognized finish, fallback answers, failed member retains transient cooldown and releases recovery claim. |

Test files named above are in tests/ with the .test.ts suffix.

## Preserved limits and verification boundary

Effort remains exact-receipt-only, otherwise omitted. Attempts remain capped at eight; first-content and idle limits remain 20 seconds; total remains 60 seconds; provisional buffer remains 64KB. No failover follows dispatched client output. Expired or capacity-evicted response IDs still fail closed rather than inventing history.

Image token accounting remains an estimate, not a provider-certified tokenizer bound. The tests prove the reported false screenshot exclusion is removed; they do not certify every image resolution or provider's vision accounting. Changes are verified locally, not claimed as a live test of every desktop client/provider combination.

## Second review (follow-up corrections)

An independent re-check of the fixes above, with probes run against both the original and the fixed source, found three defects. All are corrected and covered by tests.

| Defect | Correction | Proof |
| --- | --- | --- |
| The aggregate 2000-item / 4MB retention budgets were new global limits (they were per-snapshot limits). Two sessions with ~1MB histories, or 1,200 items each, evicted each other's history; the original code kept them. | Per-snapshot limits restored; separate 128MB total-memory bound, least recently used first. | pool-continuation: "sessions that run side by side". |
| A tool-returned screenshot was still estimated at ~150K tokens: tool-result images are nested, and only top-level image parts were rewritten. | The estimator walks the whole request, treating image parts anywhere as vision tokens and other binary by size. | pool-context: tool-returned image and PDF cases. |
| A timeout cut short by the shared 60s budget cooled a healthy member (a long answer, or a member started late). | The coordinator marks budget-bound timeouts and does not record them as member failures; a member's own first-content and idle limits still do. | pool-attempt: "a timeout caused by the shared budget is not blamed on the member". |

### Retry after a failed request

A failed request used to block an identical retry for 60 s even when nothing reached the client. Codex and Claude now release the guard when nothing was sent and no member produced an answer, so a client's automatic retry runs again (cooldowns recorded by the first try make it fail fast on the same members). Failures after content was sent, or after an answer was produced but could not be stored, still block an identical retry. Whether Codex's automatic retry resends an identical turn id and body is likely but not confirmed against a real Codex run.

## Antigravity pool on the shared coordinator

The Antigravity pool used to be its own loop in the Cloud Code gateway: members in order, a capture sink holding output until the first meaningful chunk, and no timeouts, cooldowns, finish validation, attempt cap, context check or cancellation. None of the Codex/Claude fixes reached it. It now runs on the same coordinator, health store and SDK route as the other two pools.

| Behaviour | Before | Now |
| --- | --- | --- |
| Hung member | Stalled the request until the socket gave up | 20 s first-content / 20 s idle / 60 s total limits, then failover |
| Cooldowns | None; a dead or rate-limited member was retried first on every request | Shared health store (same file as Codex/Claude): failures cool the member, 429 and 402 cool the account, a cooling member is skipped before it is even prepared |
| Finish | A stream with no finish, or a content-filter finish, counted as an answer | Missing or unusable finish is a member failure |
| Fresh evidence | Receipts were checked once at launch | Receipt freshness, billing safety and target are rechecked on every request |
| Context | An oversized request went to a small member and failed there | Same window check as the other pools (output reserve + margin) |
| Cancellation | A closed client left the provider call and any recovery claim running | The client closing the response aborts the attempt and releases the claim |
| Tool cap, tool choice | Not applied to pool members | At most 128 tools; forced tool choice reaches the member |
| After content was sent | Error line, no failover | Same, via the coordinator |
| Non-streaming | Member loop | Same coordinator; collected before anything is sent, so a member that fails mid-answer is replaced by the next one |

The Cloud Code formatter was extracted from the streaming handler into `writeCloudCodeStream` and is shared by concrete routes and the pool; concrete-route output is unchanged (all 63 existing gateway tests pass). Member evidence (`poolEvidence`: revision + receipt) is attached to each member route at launch. `src/antigravity/pool-failover.ts` and its test were removed.

Proof: `tests/antigravity-pool-runtime.test.ts` (16 cases). Twelve fail against the previous gateway: timeout plus cooldown (and the cooling member not being prepared), no failover after content, missing/unusable finish, the non-streaming path with the 429 account cooldown, client disconnect, expired receipt, context window, a row built by the real launch builder (with scopes shared with the other pools), a half-open recovery claim released on disconnect, a broken stream logged as given up rather than served, passed-over members logged once and only ahead of the answerer, and exhaustion reported correctly. The other four describe behaviour that was already correct and is preserved. A stream that breaks after content is closed with a visible error line, is logged as failed/gave-up (not served), and its reasoning is not remembered for echo. A cancelled request writes nothing to the closed socket.

Not applicable to Antigravity: Relay-owned history, signature provenance and the duplicate-request/retry guards (Cloud Code resends the whole history each turn and the formatter emits no route-bound signatures). Not live-tested: a real Antigravity session against real free providers.

## Saved tests no longer expire, and disabled members

**No time expiry.** A pool member's saved Test result used to lapse after 24 hours, which hid the whole pool until every member was re-tested. It now stays in force until the member's endpoint changes (account, base URL, model or headers are part of the match) or the member is removed. The `expiresAt` field is kept in saved data but ignored. Saved results from before Antigravity support are treated as usable there (a member that passed the text and tool Test can serve the Auto row).

**Disabled state.** A member the provider says is gone is switched off until the user tests it again. It is not removed: it stays in the pool list, shows as **Disabled** with the reason and "Test it again to re-enable", is skipped by Codex, Claude and Antigravity, and is reported in red when a launch starts and in the pool log. A passing Test (UI or CLI) clears it.

| Response | Result |
| --- | --- |
| 400/402/403/404/410 whose text says the model does not exist, was deprecated, decommissioned or retired, the free promotion/access ended, or it is not in the plan | **Disabled** |
| A bare 404 or 410 with no explanation | Cooled like an access failure; the **second** consecutive one disables (a success in between starts over) |
| 429, 5xx, timeouts, network errors, empty or truncated streams, bad finish | Cooldown with automatic recovery (unchanged) |
| 402 credits exhausted | Whole-account cooldown (unchanged) |
| 401/403 without a verdict in the text | Access cooldown (unchanged) |
| 400/422 request rejected, context too large, "does not support tools/temperature", "parameter deprecated" | Nothing: the request, not the model, was the problem |

Disabled is final until a Test clears it: later failures and healthy marks cannot soften it, it survives restarts, and it applies to that model on that endpoint only (sibling models and the account are untouched; changing the endpoint makes it a different member). Disabling applies only to explicit verdicts, never to repeated generic failures.

**Antigravity row reservation.** agy's slider lists every effort level of every favorite, which filled all 50 catalog slots and left the pool no row. The pool's rows are now built first and reserved.

Proof: `tests/pool-disabled.test.ts` (error classification including look-alike messages that must not disable, store behavior, view, launch warning, log rendering), the disabled case in `tests/antigravity-pool-runtime.test.ts` (disable, skip, loud log, re-enable by clearing), and the reservation case in `tests/antigravity-launch-routes.test.ts` (fails without the reservation).

## Reproduction commands

    npx vitest run tests/pool-review-regressions.test.ts tests/pool-context.test.ts tests/pool-continuation.test.ts tests/pool-codex-runtime.test.ts tests/pool-codex-response.test.ts tests/pool-health.test.ts
    npm test
    npm run typecheck
    npm run build
    node dist/cli.js --version
    git diff --check

## Third review

Verified 2026-11-05 against baseline commit 2392de0. Four parallel implementation agents handled independent groups; repetition/history/tool preparation shared one owner to avoid overlapping edits. The parent reviewed every source/test diff and resolved integration issues. No credentials or live provider sessions were used.

| Defect | Correction | Proof that fails on unfixed source |
| --- | --- | --- |
| 1. Repetition-generated completion bypasses history buffering | Start terminal buffering on formatter completion events as well as provider finish. Preserve event order and release executable tool completions only after history storage succeeds. | pool-round2-gaps: “buffers a formatter-synthesized completion so history failure cannot execute a tool batch”. |
| 2. Cancellation during health acquisition strands a recovery claim | Release a decision acquired after cancellation; an abort listener also releases a decision abandoned before iteration starts. Stream-owned settlement remains in the generator finally. | pool-round2-gaps: “releases a recovery claim that resolves after the client cancels”. |
| 3. Older foreign signatures return after another continuation | Store call-origin route keys with each history snapshot. Carry provenance through effort omission, and strip foreign SDK provider options after translation without mutating the shared signature registry. Claude pool preparation strips route-bound options from reasoning/tool calls generally while preserving text and paired call IDs. | pool-round2-gaps: “keeps an old route signature out of a later same-route turn after a failover”; pool-round2-route-fixes: “keeps call provenance through real Codex preparation after effort omission” and “strips foreign thinking and tool signatures from Claude pool history”. |
| 4. Claude production guard is never enabled | Claim a runtime-owned embargo using session id and canonical full-request fingerprint before preparation. Busy/blocked return 429 rate_limit_error. Pre-commit failures and cancellation release ownership; post-commit failures retain the embargo even when the error write throws. Only terminal failures expire. | pool-round2-gaps: “rejects an identical concurrent Claude request while the first is still in flight”; pool-claude-guard: all four regression cases. |
| 5. A later failure shortens an authoritative reset | Preserve the maximum of the existing unexpired deadline and the new deadline while continuing to increment failures. | pool-round2-gaps: “never lets a shorter concurrent failure replace an authoritative rate limit”; pool-health: “never shortens an unexpired deadline when a later failure has no reset”. Both exercise account scope with successive 429s. |
| 6. Forced tool choice becomes auto | Forward translated Claude toolChoice; translate Codex Responses tool_choice and pass it through the existing SDK parameter spread. | pool-round2-route-fixes: “passes a forced Claude tool choice through real preparation instead of auto” and “passes a forced Codex tool choice through real preparation”. Both capture loopback HTTP requests using the installed SDK. |
| 7. Exhausted-credit 402 receives a short model-only cooldown | Classify 402 as quota. Persist model and account cooldowns using the existing long rate-limit ladder (2 minutes, 10 minutes, 1 hour, 6 hours, 24 hours). Keep 401/403/404 classification and model scope unchanged. | pool-round2-route-fixes: “cools the whole account for exhausted credit and leaves access failures model-scoped”. |

### Exact results

- Initial isolated baseline, with the original five proof cases: pool suite **48 files, 297 passed, 5 failed**; full suite **288 files, 3071 passed, 5 failed, 2 skipped**.
- Identical final proof files against untouched 2392de0 source: **15 failed, 26 passed**. The 26 passing cases are existing pool-health tests. Every added regression case fails on baseline, including the final real-preparation Codex tool-choice case. This is equivalent to reverting all seven fixes in an isolated copy; the working tree was never reset.
- Final fixed pool suite: **50 files, 312 passed, 0 failed**.
- Final fixed full suite: **290 files, 3086 passed, 0 failed, 2 skipped**.
- Typecheck passed. CLI/core build passed. Built CLI version: **0.20.0**. Git diff whitespace check passed.
- Changes are uncommitted. No push or publish was performed. Generated distribution bundles were rebuilt as required by the repository.

### Preserved behavior and verification limits

Effort remains exact-receipt-only; the 128-tool cap, eight-attempt cap, 20-second first-content/idle limits, 60-second total deadline, 64KB provisional buffer, one-hour history TTL, per-snapshot 2000-item/4MB limits and 128MB total history limit are unchanged. Provenance metadata counts toward stored snapshot memory.

Signature suppression and request shapes are verified locally. Rejection of a foreign Anthropic signature by a destination Google/OpenAI provider was NOT live-tested, and this document makes no claim that it was. Claude signatures are suppressed generally because Claude request history lacks trustworthy per-block route provenance. Provider-specific acceptance after that suppression and all four desktop/CLI clients together remain unverified live.

401/403/404 still use the existing access classification and model-only cooldown. A 401 or account-level 403 can also affect sibling models, but changing that policy was explicitly outside this fix request; 403 and 404 are not reliably account-wide failures. Admission denials consuming attempt slots, tool-cap prioritization, context-estimate changes, missing-SDK preparation failures, and cooling-pool HTTP status changes were not expanded into this patch.

### Third review correction: preserve Claude same-member signatures

The earlier unconditional Claude signature suppression was a regression: it removed a proven producer's own signatures too. This follow-up replaces only that suppression and adds pool-output provenance tracking. Other third-review fixes remain unchanged.

Design alternatives evaluated:

- Encoding the full route in the tool id would survive restart, but adds account/endpoint/model bytes to IDs that already carry inline signature suffixes. Existing encodeToolUseId supports both __ts__ and legacy ::ts:: decoding, and can inline up to 256 signature bytes; adding more would worsen cross-provider ID constraints.
- Chosen: a pool-only, process-local map with a one-hour TTL, at most 1000 entries and at most 4MB of signature metadata. Signed pool calls get unique call_ plus 32 hexadecimal-character IDs (37 characters, alphanumeric/underscore only). No route or signature is placed in those IDs. Unsigned calls retain their existing IDs. The mapping is populated from the selected route's response stream before the formatter writes it, including nonstream aggregation. Non-pool proxy/server paths and shared encode/split helpers are unchanged.

ID constraints were checked against the installed SDK types and current Anthropic/OpenAI references: https://platform.claude.com/docs/en/api/http/messages and https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create . These references do not expose a uniform tool-call-id limit for every provider/API variant; no universal 64-character claim is made here. Generated signed-call IDs use a conservative 37-character bound, without adding route/signature suffix bytes, and do not grow with signature size. Actual upstream acceptance is not live-tested.

Preparation restores a signature only when its stored route key exactly matches account, endpoint revision and model. A destination sharing the same SDK package is insufficient. Thinking signatures use a SHA-256 lookup of the exact signature observed in pool output; ambiguous signatures observed from different routes are denied. Native Anthropic reasoning metadata is restored for proven native destinations. Google and OpenAI/openai-compatible reasoning retain their existing translated options only when the same exact producer is proven.

Unknown, expired, evicted and pre-pool signature provenance is stripped, including legacy inline suffixes. This can reject a current tool turn that requires an expired signature. We prefer that failure over forwarding opaque private state to an unproven member. Newly produced, retained current calls preserve their own signatures; no assumption about the last answering member assigns ownership to older calls. A restart loses local provenance deliberately.

Regression proof: tests/pool-claude-signatures.test.ts has five tests: same Gemini producer over consecutive tool turns (streaming and nonstream output); A versus B and changed endpoint; native Anthropic thinking versus foreign members/packages; unknown/expired provenance alongside a retained current call; and A -> B -> A. All pass. Restoring just the pre-follow-up claude-prepare.ts and claude-runtime.ts from the uncommitted round-three tree makes all five fail (0 passed); both files were restored to the corrected version immediately afterward. The original foreign-history test remains passing.

Counts for this exact checkout and npm test command:

- Before follow-up: 3086 passed, 2 skipped, 0 failed, reproducing the earlier report. The two skips are Windows .cmd shim tests in codex-process.test.ts.
- After follow-up: 3091 passed, 2 skipped, 0 failed. Pool suite: 317 passed, 0 failed (previously 312).
- The user's 3092 passed / 4 skipped measurement could not be reproduced. It represents eight additional collected cases relative to this baseline; its source or invocation is unavailable, so it is not attributed to an implementation change or silently treated as the baseline.
- Typecheck, build, built CLI version 0.20.0 and git diff --check pass.

Real Gemini/Anthropic acceptance, live OpenAI reasoning-state acceptance, and actual desktop-client replay were NOT tested. Local tests prove emitted provenance, real preparation behavior, stable paired IDs and route isolation. This supersedes the earlier blanket-suppression limitation in the Third review section.

## Lazy preparation

Each pool member is now prepared only when the coordinator is about to try it (`src/pool/lazy-route.ts`,
`admit` in `src/pool/attempt.ts`). Cheap checks (registry lookup, saved Test result, free status) still run up
front. Translating the history, the disabled/cooldown reads, key lookup, model build and the context-fit check
run at admission. A member skipped at admission (too large, cooling down, disabled, no credential) uses no
attempt, so with `MAX_POOL_ATTEMPTS = 8` a ninth member can still be tried. If every member is skipped the
error still starts with "No eligible free pool members".

Measured (7 members, ~450 KB history, 40 tools, real config): preparation before dispatch went from about
5 ms to under 1 ms for Claude and Codex; the first member's own preparation now happens during dispatch, and
later members cost nothing unless an earlier one fails. Tests: `tests/pool-lazy-prepare.test.ts` (the two
count tests fail on the previous commit; the attempt-budget tests fail if a skipped member consumes an attempt).
Full suite 3,157 passed, 4 skipped, 0 failed.
