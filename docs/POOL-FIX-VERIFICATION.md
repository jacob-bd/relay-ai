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

## Reproduction commands

    npx vitest run tests/pool-review-regressions.test.ts tests/pool-context.test.ts tests/pool-continuation.test.ts tests/pool-codex-runtime.test.ts tests/pool-codex-response.test.ts tests/pool-health.test.ts
    npm test
    npm run typecheck
    npm run build
    node dist/cli.js --version
    git diff --check
