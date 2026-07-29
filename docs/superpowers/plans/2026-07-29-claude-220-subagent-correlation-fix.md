# Claude 2.1.220 Subagent Correlation Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route Claude Code 2.1.220 child requests to the exact inherited or explicitly selected Relay model despite Claude's hardcoded local `Agent.model` validator.

**Architecture:** Keep catalog-aware partner guidance and internal selector normalization, but never return an unsupported exact Relay id in `Agent.model`. Register the resolved target under a random, short-lived token, append an opaque marker to the Agent prompt, and remove/consume that marker when Claude sends the child request. The registry is scoped to one running proxy/server, session-bound, bounded, and TTL-cleaned.

**Tech Stack:** TypeScript, Node.js HTTP, Vercel AI SDK v6, Vitest, Claude Code 2.1.220 black-box probe

## Runtime Evidence

- Claude Code 2.1.219 accepted an exact gateway id in `Agent.model`.
- Claude Code 2.1.220 rejects it locally against `sonnet|opus|haiku|fable`, even when the received tool schema contains Relay ids.
- Parent and child requests share `x-claude-code-session-id` and `metadata.user_id.session_id`.
- Child requests additionally carry `x-claude-code-agent-id`.
- The child request's first user turn contains the exact Agent `prompt`.

## Tasks

### Task 1: Add a bounded route-correlation registry

- [ ] Create failing `tests/subagent-route-registry.test.ts` coverage for token registration, session isolation, child-agent gating, marker removal, concurrent selections, TTL expiry, and capacity bounds.
- [ ] Implement `src/subagent-route-registry.ts` with cryptographically random tokens, five-minute TTL, and a bounded entry count.
- [ ] Export request session extraction with header-first and metadata fallback behavior.
- [ ] Run the focused test and typecheck.

### Task 2: Produce client-valid Agent inputs

- [ ] Add failing policy/adapter tests proving inherited and explicit partner selections omit `model`, native family selections use a legal family value, `fork` stays untouched, and every routed invocation receives a marker.
- [ ] Add an optional registration callback to request-scoped routing metadata.
- [ ] Normalize internally to the exact target, register it, append the marker to `prompt`, and emit only client-valid model values.
- [ ] Preserve existing behavior when no session-bound registrar is available.
- [ ] Run policy and SDK adapter tests.

### Task 3: Resolve correlated children in both gateways

- [ ] Add failing proxy and server integration tests for inherited, explicit favorite, concurrent-session, and recursive child routing.
- [ ] Instantiate one registry per running `startProxyCatalog` / `startServer`.
- [ ] Before ordinary model lookup, consume a valid marker only on an agent child request and route by its exact registered target.
- [ ] Strip the marker before SDK translation or native passthrough.
- [ ] Pass a session-bound registration callback only for SDK-backed partner requests.
- [ ] Run focused gateway tests and typecheck.

### Task 4: Verify the real runtime

- [ ] Run typecheck, build, full tests, and `git diff --check`.
- [ ] Run the local Claude Code 2.1.220 fake-provider probe.
- [ ] Verify omitted selection produces Qwen parent → Qwen child → Qwen parent.
- [ ] Verify explicit Grok selection produces Qwen parent → Grok child → Qwen parent.
- [ ] Remove temporary probe artifacts and verify clean `main`.

