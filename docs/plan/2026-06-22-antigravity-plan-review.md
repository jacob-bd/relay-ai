# Antigravity Plan Review

**Reviewed plan:** `docs/plan/2026-06-22-antigravity-support.md`

**Date:** June 22, 2026

**Reviewers:**

- Architecture and protocol feasibility
- Adversarial privacy and security
- TDD and validation completeness

**Combined verdict:** Request changes before implementation. The model injection, switching, and context prototype is credible, but the new signed-out privacy requirement introduces release-blocking feasibility and security work.

## Consensus release blockers

### 1. Add Task 0 before all production implementation

The signed-out feasibility gate is currently too late and depends on components scheduled earlier.

Task 0 must build only a disposable prototype:

- Minimal local `loadCodeAssist`
- Static Relay-only catalog
- One text-only synthetic generation response
- Empty IDE profile
- Isolated `agy` home/config/profile
- Native two-model switching and context check
- Endpoint inventory and network observation
- Gateway authentication/capability experiment

If either CLI or IDE cannot operate signed out, that surface must not ship under the privacy requirement.

### 2. Define the exact privacy guarantee

Choose one:

1. **Gateway-only guarantee:** Relay's local Cloud Code gateway never forwards Cloud Code requests or identity to Google. Antigravity may independently contact Google.
2. **Process-level guarantee:** The Antigravity process and descendants cannot contact Google. This requires OS-enforced outbound containment and must fail closed if containment is unavailable.

Passive network capture validates behavior but cannot enforce the stronger guarantee.

Do not describe either mode as anonymous, untraceable, ban-proof, or impossible to correlate.

### 3. Add CLI identity isolation

The plan isolates the IDE but not `agy`.

Required research and acceptance:

- Determine every profile/home/config/auth location read by `agy`.
- Launch with an empty isolated environment.
- Remove inherited Google credential/config variables.
- Verify it does not read the normal profile.
- Verify signed-out operation.
- Refuse launch when isolation cannot be established.

### 4. Remove production Google-forwarding contradictions

The production plan must consistently specify:

- Relay-only catalog
- No generic reverse-proxy primitive
- No Google Cloud Code upstream
- Google catalog IDs rejected locally
- Unknown endpoints fail closed

Authenticated Google passthrough belongs only in the historical prototype findings.

### 5. Define privacy-eligible Relay providers

Excluding Google Cloud Code traffic is insufficient if a Relay route itself targets Google.

The plan must decide how to handle:

- Google/Gemini/Vertex providers
- Google-owned API hosts
- Custom base URLs
- Redirects
- DNS aliases and IP changes
- Third-party services hosted on Google Cloud

At minimum, Google-owned providers and redirects must be excluded from privacy mode. If arbitrary endpoints remain allowed, narrow the guarantee accordingly.

### 6. Authenticate the local gateway

Loopback plus a random port is not authorization. The gateway holds provider credentials and can cause paid requests.

Investigate, in order:

- Per-session authorization header
- Unguessable capability path in `CLOUD_CODE_URL`
- Authenticated local IPC
- Strict Host, method, path, origin, and content-type validation

Also require body-size, concurrency, rate, and request-time limits.

If Antigravity cannot present a session capability, document the local-process attack and require explicit approval before shipping.

## Architecture amendments

- Rename “reverse proxy” to “local Cloud Code protocol gateway.”
- Remove generic upstream forwarding from production modules.
- Use a versioned local catalog fixture.
- Run a launch-time catalog smoke handshake with a timeout.
- Fail closed if the installed Antigravity version rejects the fixture.
- Initially ship text-only unless tools and multimodal behavior are proven with captured, redacted fixtures.
- Define direct IDE executable launch, unique managed-instance identity, lock ownership, gateway health checks, and stale-session recovery.
- Use an empty Relay-owned extensions directory. Disable sync and automatic extension installation/update.

## Threat model required before implementation

Protected assets:

- Prompts and conversation history
- Files and tool output
- Provider API keys
- Google identity tokens and cookies
- Device and installation identifiers
- Logs, crash dumps, and session state

Trust boundaries and adversaries:

- Google services
- Relay providers
- Custom provider endpoints
- Local malicious processes
- IDE extensions
- Workspaces and child processes
- Compromised or redirecting provider endpoints

Separate guarantees must be documented for:

- Gateway
- Profile
- Provider routing
- Antigravity process
- Operating-system containment

## Profile hardening requirements

- Fresh empty profile; do not copy the normal profile.
- Prefer ephemeral per-session profiles.
- Empty Relay-owned extensions directory.
- Disable sync and sign-in where possible.
- Owner verification.
- `0700` directories and restrictive files on Unix.
- No symlinks.
- Atomic no-follow creation.
- Path traversal and TOCTOU protection.
- Refuse launch when permissions cannot be established.
- Revalidate observed signed-out state during the session.
- Protect the normal profile with before/after hashes or sentinels in acceptance tests.

Scanning for known token files is only defense in depth; it cannot prove signed-out state.

## Required test additions

### Routing and isolation

- Unknown, empty, malformed, oversized, Unicode, slash-containing, and delimiter-containing catalog IDs.
- Provider A credentials can never reach provider B.
- Google provider routes and redirects are excluded.
- No outbound transport path to Google exists in the local gateway.
- Inbound OAuth headers and cookies are rejected and redacted.
- Both IDE endpoint controls are verified after startup by observing catalog and generation requests.

### Streaming

- UTF-8 split boundaries
- Multiline SSE data
- Fragmented tool arguments
- Malformed provider events
- Cancellation and client disconnect
- Exactly one terminal event
- Slow and never-ending provider streams
- Gateway shutdown while streaming

### Lifecycle

- `SIGINT`
- `SIGTERM`
- Child crash
- Launcher crash
- Detached/reused Electron process
- Already-dead child
- Stale PID/session files cannot terminate unrelated processes
- New sessions cannot reuse old route tables, capabilities, ports, or credentials

### Profile filesystem

- Successful writes create backups where required
- Atomic write failure preserves prior settings
- Numeric permission assertions
- Reset/restore behavior
- No normal-profile mutation
- No copied extensions or account state

### Diagnostics

- No route metadata through unauthenticated endpoints
- No request/response bodies by default
- Redact query parameters, file paths, project/request IDs, tool arguments, model content, provider responses, and environment values
- Uncaught exceptions cannot serialize API keys

## TDD plan improvements

Each task must include:

```text
Run: npx vitest run tests/<file>.test.ts -t "<behavior>"
Expected RED: <specific missing export or failed assertion>
Run after implementation: same command
Expected GREEN: 1 passed
Regression: npm test
```

Also:

- Add explicit `Consumes` and `Produces` interfaces between tasks.
- Move pure request and response adapters before gateway generation routing.
- Remove compression work unless the signed-out local protocol actually requires it.
- Confirm command names, platform scope, catalog scope, and profile location before parser tests lock them in.

## Recommended next action

Do not start normal implementation tasks.

First revise the main plan around:

1. The chosen privacy guarantee
2. Task 0 signed-out feasibility
3. CLI profile isolation
4. Relay-only local gateway
5. Provider privacy eligibility
6. Gateway authentication

Then execute Task 0 with temporary code and real-process tests before committing to the production architecture.
