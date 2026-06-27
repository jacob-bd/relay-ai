# Plan: Add Subscription OAuth Providers (Claude Code, Antigravity, Agy)

**Date:** 2026-06-25
**Status:** Draft
**Author:** Jacob + Claude

## Overview

Add three new OAuth providers to relay-ai that authenticate using **existing subscription tokens** from installed AI coding tools. Unlike the current providers (OpenAI, xAI, GitHub Copilot) which use the user's own API key or free-tier account, these providers extract session tokens from paid/free subscriptions — the same approach OmniRoute uses for its "free tokens" aggregation.

### Providers to Add

| Provider | OAuth Flow | Token Source | Account Risk |
|----------|-----------|-------------|--------------|
| **Claude Code** | Authorization Code + PKCE | Anthropic Claude subscription | **Yes — may violate Anthropic ToS** |
| **Antigravity** | Authorization Code + PKCE | Google Cloud Code Assist | **Yes — may violate Google ToS** |
| **Agy** | Authorization Code + PKCE (alias of Antigravity) | Same Google Cloud Code Assist | **Yes — same risk as Antigravity** |

### Why This Matters

These providers let users route inference from their existing subscriptions (Claude Pro, Antigravity free tier, etc.) through relay-ai's gateway — meaning any supported coding tool (Codex, Gemini CLI, other Claude Code sessions) can use those subscription tokens. This is the core mechanism behind OmniRoute's "free token aggregation."

---

## ⚠️ Account Risk Warning (Mandatory UX)

### The Risk

All three providers extract and reuse subscription OAuth tokens in ways the original service providers almost certainly did not intend:

- **Claude Code OAuth:** Anthropic issues these tokens for use with Claude Code specifically. Routing them through a third-party proxy to power other tools (Codex, Gemini CLI) **violates** the Claude Code Terms of Service. Anthropic has **actively enforced** this — they validate request shape server-side, have sent legal requests to projects reusing tokens, and users have reported account bans. Anthropic could revoke the token, suspend the account, or ban the user.

- **Antigravity / Agy OAuth:** Google issues these tokens for Cloud Code Assist. Using them outside Antigravity's native interface, especially to power non-Google tools, likely violates Google's Terms of Service. Google could restrict or ban the Google account — and unlike a throwaway API key, a Google account ban affects Gmail, Drive, YouTube, Workspace, and everything tied to that account.

### Required Warning UX

Before completing OAuth for any of these three providers, relay-ai **must** display a blocking confirmation prompt. The user must explicitly type `yes` (not just press Enter) to proceed.

#### Claude Code Warning Text

```
╔══════════════════════════════════════════════════════════════════╗
║  ⚠️  ACCOUNT RISK WARNING — Claude Code OAuth                  ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  This will authenticate using your Anthropic account and         ║
║  extract your Claude Code session tokens.                        ║
║                                                                  ║
║  Routing these tokens through relay-ai to power other tools      ║
║  (Codex, Gemini CLI, etc.) may violate Anthropic's Terms of      ║
║  Service. Possible consequences:                                 ║
║                                                                  ║
║    • Token revocation                                            ║
║    • Account suspension or permanent ban                         ║
║    • Loss of Claude Pro/Max subscription                         ║
║                                                                  ║
║  relay-ai and its authors are not affiliated with Anthropic      ║
║  and cannot protect you from enforcement actions.                ║
║                                                                  ║
║  Use at your own risk.                                           ║
╚══════════════════════════════════════════════════════════════════╝

Type "yes" to proceed, or anything else to cancel:
```

#### Antigravity / Agy Warning Text

```
╔══════════════════════════════════════════════════════════════════╗
║  ⚠️  ACCOUNT RISK WARNING — Antigravity / Google OAuth          ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  This will authenticate using your Google account and extract    ║
║  Cloud Code Assist session tokens.                               ║
║                                                                  ║
║  Routing these tokens through relay-ai to power non-Google       ║
║  tools may violate Google's Terms of Service. Possible           ║
║  consequences:                                                   ║
║                                                                  ║
║    • Token revocation                                            ║
║    • Google account restrictions or ban                          ║
║    • Loss of access to Gmail, Drive, YouTube, Workspace,         ║
║      and ALL services tied to this Google account                ║
║                                                                  ║
║  DO NOT use your primary Google account.                         ║
║  Use a throwaway or secondary account you can afford to lose.    ║
║                                                                  ║
║  relay-ai and its authors are not affiliated with Google         ║
║  and cannot protect you from enforcement actions.                ║
╚══════════════════════════════════════════════════════════════════╝

Type "yes" to proceed, or anything else to cancel:
```

### Warning Persistence

- The warning must show **every time** the user initiates the OAuth flow, not just the first time. No "don't show again" option.
- The warning must also appear in `relay-ai providers list` output next to these providers (a short one-line risk note).
- The `--ai` / agent output should include a `riskLevel: "subscription-oauth"` field so alef-agent can surface the warning to Telegram users.

---

## Technical Implementation

### Phase 1: Claude Code OAuth Provider

#### 1.1 New File: `src/oauth/claude-code.ts`

Implements Anthropic's Authorization Code + PKCE flow:

**OAuth Endpoints:**
- Authorize: `https://claude.ai/oauth/authorize`
- Token: `https://api.anthropic.com/v1/oauth/token`
- Redirect: `https://platform.claude.com/oauth/code/callback`
- Bootstrap: `https://api.anthropic.com/api/claude_cli/bootstrap`

**Scopes:**
```
org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers
```

**Flow:**
1. Generate PKCE verifier + challenge (S256) — reuse existing `src/oauth/pkce.ts`
2. Open browser to Anthropic authorize URL with PKCE params and `prompt=login` (forces fresh auth, prevents session takeover that invalidates other refresh tokens)
3. Start local HTTP callback server on a random port to receive the redirect
4. Exchange authorization code for access + refresh tokens via POST to token URL
5. (Optional) Call bootstrap endpoint (`GET /api/claude_cli/bootstrap` with `anthropic-beta: oauth-2025-04-20` header) to extract account info (email, org, plan tier) — best-effort, non-blocking
6. Store tokens via existing keyring mechanism (`keyring:provider:claude-code`)

**Token Refresh:**
- Access tokens are short-lived; refresh via standard OAuth refresh_token grant to `https://api.anthropic.com/v1/oauth/token`
- Add `claude-code` case to `refreshStoredOAuthCredential()` in `src/oauth/refresh.ts`

**Client ID Resolution:**
- OmniRoute uses `resolvePublicCred("claude_id")` — the client ID is embedded/obfuscated in their binary
- We need to determine the public client ID. Options:
  - Extract from Claude Code's own binary (`npm show @anthropic-ai/claude-code` → inspect bundle)
  - Extract from OmniRoute's published npm package
  - Use a relay-ai-specific OAuth app registration (cleaner but requires Anthropic partnership)
- **Decision needed:** Which approach? Extracting from Claude Code's bundle is reverse engineering.

**Proxy Integration:**
- The access token goes to `ANTHROPIC_API_KEY` (it's a bearer token that works with the standard Messages API)
- No SDK adapter needed — Claude tokens are native Anthropic format
- Set `ANTHROPIC_BASE_URL` to `https://api.anthropic.com` (direct, no proxy layer)

#### 1.2 Estimated Files Changed

| File | Change |
|------|--------|
| `src/oauth/claude-code.ts` | **New** — OAuth flow implementation |
| `src/oauth/types.ts` | Add `'claude-code'` to `NATIVE_OAUTH_PROVIDER_IDS` |
| `src/oauth/refresh.ts` | Add `claude-code` case to `refreshStoredOAuthCredential()` |
| `src/registry/provider-auth.ts` | Add Claude Code to auth flow dispatcher |
| `src/registry/builtins.ts` | Add Claude Code provider template |
| `src/providers-command.ts` | Wire up `auth claude-code` subcommand |
| `src/proxy.ts` or `src/proxy-shared.ts` | Handle bearer token passthrough for Claude OAuth tokens |
| `src/ui.ts` | Add warning prompt helper |

### Phase 2: Antigravity OAuth Provider

#### 2.1 New File: `src/oauth/antigravity-oauth.ts`

Implements Google's Authorization Code + PKCE flow for Cloud Code Assist:

**OAuth Endpoints:**
- Authorize: `https://accounts.google.com/o/oauth2/v2/auth`
- Token: `https://oauth2.googleapis.com/token`
- User Info: `https://www.googleapis.com/oauth2/v1/userinfo?alt=json`

**Scopes:**
```
openid
https://www.googleapis.com/auth/cloud-platform
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
https://www.googleapis.com/auth/cclog
https://www.googleapis.com/auth/experimentsandconfigs
```

**Flow:**
1. Generate PKCE verifier + challenge (S256)
2. Open browser to Google authorize URL with `access_type=offline` and `prompt=consent`
3. Start local HTTP callback server to receive redirect
4. Exchange authorization code for access + refresh tokens
5. Post-exchange bootstrap:
   a. Fetch user info from Google (email, profile)
   b. POST to Cloud Code Assist `loadCodeAssist` endpoint to get project ID and tier
   c. POST to `onboardUser` endpoint (poll up to 10 times, 5s interval) until `result.done === true`
6. Store tokens + project ID via keyring

**Client ID + Secret Resolution:**
- Same problem as Claude Code — OmniRoute obfuscates via `resolvePublicCred("antigravity_id")`
- The client secret is also needed (Google OAuth for installed apps uses a "public" client secret)
- Options: extract from Antigravity CLI binary, extract from OmniRoute, or register a new Google OAuth app

**Cloud Code Assist Base URLs:**
- Multiple endpoints for failover (imported as `ANTIGRAVITY_BASE_URLS` in OmniRoute)
- Need to determine the actual base URLs — likely `https://codeassist.googleapis.com` or similar
- The `v1internal` API version suggests these are undocumented internal APIs

**Proxy Integration:**
- Antigravity tokens are Google OAuth tokens scoped to Cloud Code Assist
- Requests go to the Cloud Code Assist API (not standard Vertex/Gemini)
- Need to build a translation layer: Anthropic Messages API format ↔ Cloud Code Assist generateContent format
- relay-ai already has this translation in `src/antigravity/` — the Cloud Code gateway

#### 2.2 Relationship to Existing Antigravity Support

relay-ai already supports Antigravity via `relay-ai agy` and `relay-ai antigravity-ide`. That flow:
1. User authenticates with Google in Antigravity CLI/IDE natively
2. relay-ai runs a local Cloud Code gateway that intercepts model requests
3. Requests route to relay-ai's configured providers instead

The **new** OAuth flow is the reverse:
1. relay-ai authenticates with Google directly (extracting Cloud Code Assist tokens)
2. Other tools (Claude Code, Codex) can route through relay-ai's gateway
3. Requests go to Google's Cloud Code Assist API using the extracted tokens

These are complementary, not conflicting.

### Phase 3: Agy OAuth Provider

#### 3.1 Implementation

Agy is a **pure alias** of Antigravity — identical OAuth client ID, scopes, endpoints, and flow. The only difference is the registry label.

```typescript
// src/oauth/agy-oauth.ts
export { runAntigravityOAuthFlow as runAgyOAuthFlow } from './antigravity-oauth.js';
export { refreshAntigravityToken as refreshAgyToken } from './antigravity-oauth.js';
```

Or, more likely, handle both in a single file with a `providerId` parameter:

```typescript
// src/oauth/antigravity-oauth.ts
export async function runAntigravityOAuthFlow(
  providerId: 'antigravity' | 'agy',
  onAuthUrl: (url: string) => void,
): Promise<{ tokens: OAuthTokenResponse; projectId?: string; email?: string }> {
  // identical flow for both
}
```

Register both `antigravity` and `agy` in `NATIVE_OAUTH_PROVIDER_IDS`. Both show the same Google account warning.

---

## Open Questions (Need Decisions)

### Q1: Client ID Source — RESOLVED (2026-06-26)

Extracted from OmniRoute's MIT-licensed `open-sse/utils/publicCreds.ts`. These are XOR-masked embedded defaults (mask: `"omniroute-public-v1"`) that decode to the public PKCE client credentials shipped in the respective CLI binaries. Google [explicitly documents](https://developers.google.com/identity/protocols/oauth2/native-app) that OAuth client_id/secret for installed apps using PKCE are publicly distributed and must not be treated as secrets.

| Provider | Credential | Value |
|----------|-----------|-------|
| **Claude Code** | Client ID | `9d1c250a-e61b-44d9-88ed-5944d1962f5e` |
| **Antigravity** | Client ID | Public Antigravity desktop OAuth client ID; runtime override: `ANTIGRAVITY_OAUTH_CLIENT_ID` |
| **Antigravity** | Client Secret | Public Antigravity desktop OAuth client secret; runtime override: `ANTIGRAVITY_OAUTH_CLIENT_SECRET` |

**Approach:** Ship as embedded defaults with env var overrides (`CLAUDE_OAUTH_CLIENT_ID`, `ANTIGRAVITY_OAUTH_CLIENT_ID`, `ANTIGRAVITY_OAUTH_CLIENT_SECRET`) for when providers rotate IDs. Same pattern OmniRoute uses.

### Q2: Cloud Code Assist API Endpoints — RESOLVED

Extracted from OmniRoute's MIT-licensed source (`open-sse/config/antigravityUpstream.ts`):

**Base URLs (failover order per OmniRoute's `antigravityUpstream.ts`):**
1. `https://daily-cloudcode-pa.googleapis.com` (daily/dev — listed first in OmniRoute)
2. `https://cloudcode-pa.googleapis.com` (production)
3. `https://daily-cloudcode-pa.sandbox.googleapis.com` (sandbox)

**API Paths:**
| Endpoint | Path | Method | Purpose |
|----------|------|--------|---------|
| Bootstrap | `/v1internal:loadCodeAssist` | POST | Required before anything — binds project context to OAuth token |
| Onboard | `/v1internal:onboardUser` | POST | Activates Code Assist; poll up to 10x at 5s intervals until `result.done === true` |
| Inference | `/v1internal:streamGenerateContent?alt=sse` | POST | Always use streaming — non-streaming returns 400 on some models |
| Models | `/v1internal:models` | GET | Model discovery (requires prior `loadCodeAssist` call or returns 404) |
| Available models | `/v1internal:fetchAvailableModels` | GET | Available model catalog |

No open question — endpoints are known.

### Q3: Token Storage Scope

Should subscription OAuth tokens share the same keyring namespace as API key providers?

**Recommendation:** Yes — use `keyring:provider:<id>` with `id` being `claude-code` or `antigravity`. The stored credential shape (`StoredOAuthCredential`) needs one extension: add `providerData?: Record<string, unknown>` to store Antigravity's `projectId` and `tier` alongside the tokens (see Review Finding BLOCKER 2).

### Q4: Provider Listing UX

How should these providers appear in `relay-ai providers list`?

**Recommendation:** Add a `⚠️` risk indicator:

```
  ID              Type         Status     Models
  groq            api-key      ✅ active   42
  openai          oauth        ✅ active   12
  claude-code     oauth ⚠️     ✅ active   3    ← subscription token, account risk
  antigravity     oauth ⚠️     ✅ active   5    ← subscription token, account risk
```

---

## Implementation Order

> **Note — GUI integration (2026-06-25):** The `relay-ai ui` web GUI (`docs/plan/2026-06-25-web-gui-favorites-manager.md`) is being implemented first and ships its own local HTTP server on `127.0.0.1`. When we reach this OAuth plan, that server is the callback receiver — no separate `callback-server.ts` needed as the primary path. See "GUI Integration" note in Phase 0 below.

1. **Phase 0:** Shared infrastructure
   - ~~`src/oauth/callback-server.ts`~~ **→ Handled by the GUI server.** The web GUI (`src/ui-command.ts`) already runs a local HTTP server on `127.0.0.1`. Add `GET /oauth/callback` as a route in `src/ui/api.ts` — it captures `?code=&state=`, completes the token exchange, saves to keychain, and returns a styled success/error page. No separate callback server to build or tear down.
   - **CLI fallback only:** For users running `relay-ai auth <provider>` without the GUI open, a minimal `src/oauth/callback-server.ts` still exists — but it is a thin wrapper (~50 lines) rather than the primary path. The GUI is the primary path.
   - Extend `StoredOAuthCredential` with `providerData?: Record<string, unknown>`
   - Split `runNativeDeviceCode()` in `provider-auth.ts` into device-code vs browser-redirect dispatch
2. **Phase 1a:** Warning UX
   - **GUI path (primary):** Inline risk warning panel rendered in the Providers & Keys view before the OAuth redirect. The user must click a confirmation button (not just press Enter). The warning text from this plan maps directly to the GUI's inline panel design.
   - **CLI path (fallback):** `printPanel()`-based risk warning with `p.text()` requiring explicit `yes` input; shared `confirmSubscriptionOAuthRisk(provider)` helper in `src/ui.ts`. Unchanged from original plan.
3. **Phase 1b:** Claude Code OAuth flow — `src/oauth/claude-code.ts` (auth code + PKCE). On the GUI path, the PKCE verifier is stored in the GUI server's in-memory session state and consumed when `GET /oauth/callback` fires. On the CLI path, the callback-server.ts fallback handles the redirect. Registration in `NATIVE_OAUTH_PROVIDER_IDS`, refresh case, `PROVIDER_DISPLAY` entry, help text update — unchanged.
4. **Phase 1c:** Claude Code proxy integration — **significantly more complex than originally scoped** (see "Claude Code Identity Requirements" section below). Requires:
   - Conditional header logic in `upstream-forward.ts`: OAuth routes send `Authorization: Bearer` only, skip `x-api-key` (confirmed by OmniRoute's `default.ts:436-441`)
   - New `src/oauth/claude-identity.ts` — port identity simulation from OmniRoute's `claudeIdentity.ts` (~450 lines):
     - `metadata.user_id` JSON blob: `{ device_id, account_uuid, session_id }` — required on every request
     - Dynamic `anthropic-beta` flag selection via `selectBetaFlags()` — different beta sets for probe vs agent vs structured-output requests
     - User-Agent: `claude-cli/{version} (external, cli)` (currently pinned to `2.1.187`)
     - `cliUserID`: 64-hex device ID generated once at OAuth provisioning, persisted in `providerData.cliUserID`
     - `account_uuid`: from bootstrap endpoint or deterministic SHA-256 fallback
   - The `anthropic-beta: oauth-2025-04-20` flag is **mandatory** on all Claude OAuth requests
5. **Phase 2a:** Antigravity OAuth flow — `src/oauth/antigravity-oauth.ts` (Google auth code + PKCE, `loadCodeAssist` bootstrap, `onboardUser` polling, project ID extraction). Same GUI-vs-CLI dual path as Phase 1b. Store `projectId` and `tier` in `providerData`. Unchanged.
6. **Phase 2b:** Antigravity proxy integration — adapt OmniRoute's MIT-licensed translators:
   - `src/antigravity/openai-to-cloudcode.ts` — port from OmniRoute's `antigravity-to-openai.ts` (reverse direction: OpenAI→CloudCode format for outbound requests to Google)
   - `src/antigravity/cloudcode-to-openai.ts` — port from OmniRoute's `openai-to-antigravity.ts` (reverse direction: CloudCode→OpenAI format for responses back to client)
   - Route through existing `sdk-adapter.ts` / `provider-factory.ts` where possible. Unchanged.
7. **Phase 3:** Tests — unit tests for each OAuth flow, token refresh, and format translators. The GUI callback route (`GET /oauth/callback`) is tested in `tests/ui-api.test.ts` alongside the other API routes.
8. **Phase 4:** Documentation — update `docs/PROVIDERS.md` with risk warnings, update `relay-ai --ai` output with `riskLevel` field, update `providerAuthHelpText()`

### Estimated Scope

| Phase | New Files | Changed Files | Complexity | Notes |
|-------|-----------|---------------|------------|-------|
| 0 (Shared infra) | 0–1 | 2–3 | **Low** | GUI server handles callback; CLI fallback is ~50 lines. Schema + dispatch split unchanged. |
| 1a (Warning UX) | 0 | 1–2 | Low | GUI: inline panel. CLI: existing `printPanel()` pattern. |
| 1b (Claude OAuth) | 1 | 4–5 | Medium | Standard auth code + PKCE; callback via GUI server (primary) or fallback |
| 1c (Claude proxy) | 1 | 2–3 | **Medium–High** | Bearer-only headers + identity metadata (user_id, beta flags, UA). Port OmniRoute's `claudeIdentity.ts` patterns into `src/oauth/claude-identity.ts`. |
| 2a (Antigravity OAuth) | 1 | 3–4 | Medium | Bootstrap + onboarding polling; endpoints known |
| 2b (Antigravity proxy) | 2 | 2–3 | Medium | Port OmniRoute translators (MIT); adapt to relay-ai patterns |
| 3 (Tests) | 2–3 | 1 | Medium | GUI callback route tested in ui-api.test.ts |
| 4 (Docs) | 0 | 2–3 | Low | |

**Total:** ~6–7 new files, ~15 changed files, ~2 weeks of focused work. Phase 0 drops from Medium to Low thanks to GUI server reuse.

**Agy dropped** — pure alias of Antigravity OAuth with zero functional difference. The existing `relay-ai agy` launch command is unaffected.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Anthropic rotates OAuth client ID | Medium | Users must re-auth | Env var override fallback |
| Google blocks extracted client ID | Medium | Antigravity OAuth stops working | Env var override; existing `relay-ai agy` flow unaffected |
| User gets account banned | **Medium–High** | User loses subscription | **Community-confirmed:** multiple community projects using Antigravity OAuth proxies have reported Google account bans and shadow-bans. Anthropic has taken legal action against at least one project (OpenCode) for Claude OAuth reuse and actively enforces via request-shape validation. Mandatory warnings, no "don't show again", recommend burner accounts for Antigravity. |
| Legal/DMCA from Anthropic or Google | Very Low | Must remove feature | Feature flag to disable; keep behind explicit opt-in |
| Token refresh breaks after provider update | Medium | Inference fails until re-auth | Auto-detect and prompt re-auth |

---

---

## Codebase Review Findings (2026-06-25)

Four parallel review agents audited this plan against the actual relay-ai codebase across OAuth architecture, proxy/routing, Antigravity integration, and UX/registration. Below are the consolidated findings.

### BLOCKER 1: No Local Callback Server Exists

**Severity: Blocker — must be built before any implementation**

The plan says "start local HTTP callback server on a random port to receive the redirect" for both Claude Code and Antigravity OAuth flows. **This infrastructure does not exist.**

All three existing OAuth providers (OpenAI, xAI, GitHub Copilot) use **device code flows** — they poll a remote endpoint, they never receive browser redirects. There is zero local HTTP callback server code anywhere in `src/oauth/`.

The only `redirect_uri` reference is in `src/oauth/openai.ts:100` and it points to `https://auth.openai.com/deviceauth/callback` — a remote endpoint, not a local server.

**What must be built:**
- A reusable local HTTP callback server (`src/oauth/callback-server.ts`) that:
  - Listens on `127.0.0.1` with a random port
  - Serves a single `GET /callback?code=...&state=...` endpoint
  - Extracts the authorization code and state from query params
  - Serves a "success" HTML page to the browser after capture
  - Auto-closes after receiving the callback or timing out
  - Handles edge cases: port conflicts, timeout, duplicate callbacks

**Estimated additional effort:** ~1 day, Medium complexity

### BLOCKER 2: StoredOAuthCredential Cannot Store Antigravity Project ID

**Severity: Blocker — schema must be extended**

The plan says "No schema changes needed" for token storage. **This is wrong.**

`StoredOAuthCredential` (defined in `src/oauth/types.ts:3-9`) stores:
```typescript
{ type: 'oauth', access: string, refresh: string, expires: number, accountId?: string }
```

Antigravity OAuth requires storing a **`projectId`** (from the `loadCodeAssist` bootstrap) and a **`tier`** (e.g., `"legacy-tier"`). Neither field exists on `StoredOAuthCredential`.

**Fix options:**
- A) Add optional `projectId?: string` and `tier?: string` fields to `StoredOAuthCredential` — simple but starts polluting a shared type
- B) Add a generic `providerData?: Record<string, unknown>` field — more extensible
- C) Store `projectId` separately in `config.json` or a provider-specific keyring entry

**Recommendation:** Option B — add `providerData?: Record<string, unknown>` to `StoredOAuthCredential`. This is forward-compatible and doesn't break existing providers.

### ISSUE 3: Claude Code OAuth Token May Not Work as a Simple API Key

**Severity: High — needs verification**

The plan assumes "the access token goes to `ANTHROPIC_API_KEY`" and works as a drop-in bearer token. Looking at `src/upstream-forward.ts:6-18`, the `anthropicUpstreamHeaders()` function sends BOTH:
```typescript
Authorization: `Bearer ${key}`,
'x-api-key': key,
```

An OAuth access token is NOT an API key. Anthropic's API may reject requests where `x-api-key` contains an OAuth token. The `anthropic-beta: oauth-2025-04-20` header (seen in OmniRoute's bootstrap call) suggests OAuth tokens require special handling.

**What needs to happen:**
- Test whether `x-api-key: <oauth-token>` works on `api.anthropic.com/v1/messages`
- If not, the upstream forwarder needs a conditional path: skip `x-api-key` and only send `Authorization: Bearer` for OAuth-authenticated routes
- The `ProxyRoute` interface already has `authType?: 'api' | 'oauth' | 'none'` (line 81) — use this to branch header construction

### ~~ISSUE 4: Antigravity "Reverse Direction" Is Much Harder Than Stated~~ — RESOLVED

**Original severity: High. Updated: Medium — resolved via OmniRoute reference code.**

The original review flagged that relay-ai's existing adapters go the wrong direction (Cloud Code → SDK, not SDK → Cloud Code). This was correct about the *local* codebase — but wrong to conclude the adapters "must be built from scratch."

OmniRoute (MIT licensed) already has working, production-tested translators for both directions:

- **`open-sse/translator/request/antigravity-to-openai.ts`** (~180 lines) — Cloud Code → OpenAI format. Handles role mapping (`model`→`assistant`), `generationConfig` translation, thinking budget → `reasoning_effort`, tool declarations, multimodal `inlineData`, and schema type normalization.

- **`open-sse/translator/response/openai-to-antigravity.ts`** (~130 lines) — OpenAI streaming → Cloud Code format. Handles streaming text, reasoning tokens (`thought: true`), tool call accumulation across chunks, finish reason mapping (`stop`→`STOP`, `length`→`MAX_TOKENS`), and usage metadata.

**What we do:** Port these translators into relay-ai's codebase (adapting imports and removing OmniRoute's registry pattern), then wire them into the proxy pipeline. The Cloud Code wire format types already exist in `src/antigravity/request-adapter.ts` (`CloudCodeGenerateRequest`, `CloudCodePart`, etc.) — those types stay, we add the new translation functions.

**Key implementation detail from OmniRoute:** Always use the streaming endpoint (`/v1internal:streamGenerateContent?alt=sse`) even for non-streaming requests — the non-streaming endpoint returns 400 for some models. For non-streaming clients, collect the full SSE stream and return a single JSON response.

### ISSUE 5: Warning Box Style Doesn't Match Existing UI Patterns

**Severity: Low — cosmetic but worth noting**

The plan proposes ASCII box-drawn warnings (`╔══╗`). The relay-ai codebase uses `@clack/prompts` with the custom `printPanel()` helper in `src/ui.ts` for all visual elements. ASCII boxes would look inconsistent.

**Fix:** Use the existing `printPanel()` pattern with `pc.red` or `pc.yellow` coloring, followed by a `p.text()` prompt that requires typing `yes`. Example:
```typescript
printPanel(pc.red('⚠️  ACCOUNT RISK — Claude Code OAuth'), [
  `${pc.white('This will extract your Claude Code session tokens.')}`,
  `${pc.white('Routing them through relay-ai may violate Anthropic ToS.')}`,
  // ...
]);
const confirm = await p.text({ message: 'Type "yes" to proceed:', validate: v => v !== 'yes' ? 'Type "yes" to confirm' : undefined });
```

### ISSUE 6: Provider Auth Dispatch Needs Refactoring

**Severity: Medium — plan underestimates wiring work**

The `authenticateProvider()` function in `src/registry/provider-auth.ts:149-209` has a hard-coded check: `supportsNativeOAuth(providerId)`. This calls into `src/oauth/types.ts` which checks against `NATIVE_OAUTH_PROVIDER_IDS = ['xai', 'xai-oauth', 'openai', 'openai-oauth', 'github-copilot']`.

Adding Claude Code and Antigravity here is straightforward, BUT:

1. The `runNativeDeviceCode()` function (line 53) assumes ALL native OAuth uses **device code flows** (it's literally named that way). Claude Code and Antigravity use **authorization code + PKCE with browser redirect** — a fundamentally different flow.

2. The function would need to be split or renamed — something like:
   ```
   runNativeDeviceCode() → existing providers (xAI, OpenAI, GitHub)
   runNativeBrowserOAuth() → new providers (Claude Code, Antigravity)
   ```

3. The `PROVIDER_DISPLAY` map (line 41) needs entries for the new providers.

4. The `providerAuthHelpText()` (line 211) needs updating — it currently says "Supported native OAuth: xai, openai, github-copilot".

### ISSUE 7: Agy Should Be Dropped — It's Redundant

**Severity: Recommendation**

The plan confirms Agy is a "pure alias" of Antigravity — identical client ID, scopes, endpoints, flow, and credential resolution. OmniRoute maintains the alias for future divergence that hasn't happened.

relay-ai already has both `relay-ai agy` and `relay-ai antigravity-ide` as launch commands, but those serve different surfaces (CLI vs IDE). For OAuth token extraction, there is zero functional difference — adding Agy as a separate OAuth provider adds registry clutter, documentation overhead, and test surface for no user benefit.

**Recommendation:** Implement Antigravity OAuth only. If the CLI variant ever diverges from the IDE variant at the OAuth level, add Agy then. The plan's Phase 3 becomes zero work.

### CONFIRMED: Things the Plan Gets Right

1. **PKCE helpers are reusable** — `src/oauth/pkce.ts` provides `generatePkce()` (S256), `generateOAuthState()`, and `sleepMs()`. These work for both Anthropic and Google PKCE flows.

2. **Refresh dispatch is extensible** — Adding cases to `refreshStoredOAuthCredential()` in `src/oauth/refresh.ts` is a clean switch-case pattern. Adding Claude Code and Antigravity refresh is straightforward.

3. **ProxyRoute already supports OAuth metadata** — The `ProxyRoute` interface (line 81-82) already has `authType?: 'api' | 'oauth' | 'none'` and `oauthAccountId?: string`. The proxy routing logic already checks these in `src/proxy.ts:230` and `src/server/router.ts:199`.

4. **Keyring storage works** — `saveProviderCredential()` and the `keyring:provider:<id>` namespace handle OAuth credentials. No infrastructure changes needed for key storage itself.

5. **The Cloud Code wire format is documented in the codebase** — `src/antigravity/request-adapter.ts` defines `CloudCodeGenerateRequest`, `CloudCodeMessage`, `CloudCodePart`, and `SdkRequest` types. These are directly reusable as type references even though the translation functions go the wrong direction.

6. **builtins.ts pattern works** — The Zen/Go stubs in `src/registry/builtins.ts` show the pattern for adding provider stubs without hardcoded model lists. Claude Code and Antigravity can follow the same pattern.

### Revised Effort Estimate (Post-OmniRoute Reference Code Discovery)

| Phase | Original Estimate | First Review | Final Estimate | Notes |
|-------|------------------|-------------|----------------|-------|
| 0 (Shared infra) | Not in plan | Medium (1 day) | Medium (1 day) | Callback server + schema + dispatch split |
| 1a (Warning UX) | Low | Low | Low | Use `printPanel()` |
| 1b (Claude OAuth) | Medium | Medium–High | Medium | Callback server from Phase 0 simplifies this |
| 1c (Claude proxy) | Low–Medium | Medium | **Medium–High** | Bearer-only headers + full identity simulation (user_id, beta flags, UA). Port OmniRoute's `claudeIdentity.ts` (~450 lines) into `src/oauth/claude-identity.ts`. |
| 2a (Antigravity OAuth) | High | Very High | **Medium** | Endpoints now known; bootstrap flow clear from OmniRoute reference |
| 2b (Antigravity proxy) | Medium | High | **Medium** | Port OmniRoute's MIT translators (~310 lines total), not build from scratch |
| 3 (Agy alias) | Trivial | Drop it | **Dropped** | Redundant — no functional difference |
| 4 (Tests) | Medium | Medium–High | Medium | Standard test coverage |
| 5 (Docs) | Low | Low | Low | Unchanged |

**Final total:** ~2–3 weeks. The OmniRoute reference code eliminates the Antigravity complexity, but Claude Code identity simulation (Phase 1c) is harder than originally scoped. All open questions are now resolved (2026-06-26).

---

## References

### OmniRoute (MIT licensed — source for adapters, endpoints, and OAuth flows)

| What | Path in OmniRoute repo | What we take |
|------|----------------------|--------------|
| Claude OAuth provider | `src/lib/oauth/providers/claude.ts` | Flow, scopes, bootstrap endpoint |
| Antigravity OAuth provider | `src/lib/oauth/providers/antigravity.ts` | Flow, bootstrap, onboarding polling |
| OAuth constants | `src/lib/oauth/constants/oauth.ts` | Authorize/token URLs, scopes, redirect URI |
| Antigravity OAuth service | `src/lib/oauth/services/antigravity.ts` | Full `connect()` flow with local callback server |
| Request translator | `open-sse/translator/request/antigravity-to-openai.ts` | Cloud Code → OpenAI format (~180 lines) |
| Response translator | `open-sse/translator/response/openai-to-antigravity.ts` | OpenAI → Cloud Code format (~130 lines) |
| Cloud Code base URLs | `open-sse/config/antigravityUpstream.ts` | 3 base URLs + API paths |
| Headers & user agents | `open-sse/services/antigravityHeaders.ts` | UA strings, API client headers |
| Project bootstrap | `open-sse/services/antigravityProjectBootstrap.ts` | `loadCodeAssist` flow, project ID extraction |
| Executor | `open-sse/executors/antigravity.ts` | Full request pipeline, 429 handling, credits system |

### relay-ai existing code

- OAuth infrastructure: `src/oauth/{pkce,github,openai,xai,types,refresh}.ts`
- Antigravity gateway: `src/antigravity/{cloud-code-gateway,request-adapter,response-adapter,types}.ts`
- Proxy: `src/proxy.ts`, `src/upstream-forward.ts`, `src/server/router.ts`
- Provider auth: `src/registry/provider-auth.ts`, `src/registry/builtins.ts`
- UI: `src/ui.ts` (`printPanel()` pattern)

### Notes

- Claude Code OAuth API uses `anthropic-beta: oauth-2025-04-20` header — still in beta
- Antigravity uses `v1internal` API version — undocumented internal Google APIs
- Always use streaming endpoint (`streamGenerateContent?alt=sse`) — non-streaming returns 400 on some models
- `loadCodeAssist` must be called before model discovery or inference — binds project context to OAuth token

### Community landscape (2025-2026)

Multiple open-source projects exist that proxy Antigravity and Claude Code OAuth tokens. Community findings:

- **Antigravity proxies:** Several projects expose Anthropic-compatible APIs backed by Antigravity Cloud Code. Google has responded with account bans and shadow-bans across multiple community projects. Users strongly recommend burner accounts.
- **Claude OAuth reuse:** Anthropic has taken legal action against at least one project (OpenCode removed its bundled Claude OAuth plugin in March 2026 after receiving a legal request from Anthropic). Anthropic actively validates request shape — OAuth tokens are rejected unless requests match Claude Code's exact header/metadata fingerprint.
- **OpenCode's approach:** The `opencode-anthropic-auth` plugin (now community-maintained after official removal) reads OAuth tokens from the macOS Keychain or `~/.claude/.credentials.json`, injects them as Bearer tokens with identity metadata. Community forks exist that sync from Claude CLI credentials directly, avoiding OAuth endpoint fragility.
- **Multi-account rotation:** Some proxies implement health-based account rotation, penalizing errored accounts and favoring healthy ones — a pattern relay-ai could adopt if supporting multiple subscription accounts.
- **Request-shape validation:** Anthropic's API enforces that Claude OAuth tokens are accompanied by the correct `anthropic-beta` flags, `metadata.user_id` JSON blob, and User-Agent string. Without these, tokens are rejected with "This credential is only authorized for use with Claude Code."

---

## Claude Code Identity Requirements (2026-06-26)

**This section was added after reviewing OmniRoute's `claudeIdentity.ts` (~450 lines).** The original plan underestimated Phase 1c — Claude Code OAuth is not just "send Bearer token." Anthropic's OAuth endpoint requires a full identity simulation matching a real `claude-cli` session.

### Required request metadata

Every request to `api.anthropic.com/v1/messages` using an OAuth token must include:

1. **`Authorization: Bearer <access_token>`** — OAuth tokens use Bearer auth ONLY, never `x-api-key`. Confirmed by OmniRoute's executor (`default.ts:436-441`):
   ```typescript
   case "claude":
     effectiveKey
       ? (headers["x-api-key"] = effectiveKey)         // API key path
       : (headers["Authorization"] = `Bearer ${token}`); // OAuth path
   ```

2. **`metadata.user_id`** — JSON-stringified blob in the request body containing:
   ```json
   {
     "device_id": "<64-hex-char cliUserID>",
     "account_uuid": "<UUIDv4 from bootstrap or SHA-256 fallback>",
     "session_id": "<UUIDv4, random per process lifetime>"
   }
   ```

3. **`anthropic-beta` header** — dynamically selected based on request shape via `selectBetaFlags()`:
   - Always includes: `oauth-2025-04-20`, `context-management-2025-06-27`, `prompt-caching-scope-2026-01-05`
   - Full agent (tools + system): adds `claude-code-20250219`, `extended-cache-ttl-2025-04-11`, `cache-diagnosis-2026-04-07`
   - Opus only: adds `context-1m-2025-08-07`, `mid-conversation-system-2026-04-07`
   - Opus/Sonnet only: adds `advanced-tool-use-2025-11-20`, `effort-2025-11-24`
   - Structured output: adds `structured-outputs-2025-12-15`, `advisor-tool-2026-03-01`
   - Thinking: `interleaved-thinking-2025-05-14`, `redact-thinking-2026-02-12`, `thinking-token-count-2026-05-13`

4. **`User-Agent`** — must match: `claude-cli/2.1.187 (external, cli)`

5. **`anthropic-version`** — `2023-06-01`

### Identity fields (persisted in `providerData`)

| Field | Source | Persistence |
|-------|--------|-------------|
| `cliUserID` | `crypto.randomBytes(32).toString("hex")` | Generated once at OAuth provisioning, stored in `providerData.cliUserID` |
| `accountUUID` | Bootstrap endpoint (`/api/claude_cli/bootstrap`) | Fetched post-OAuth, stored in `providerData.accountUUID`. Fallback: deterministic UUIDv4 from SHA-256 of access token |
| `sessionId` | `crypto.randomUUID()` | Per-process, not persisted |
| `organizationUUID` | Bootstrap endpoint | Optional, stored in `providerData.organizationUUID` |
| `plan` | Bootstrap endpoint (e.g. `"pro"`, `"max"`) | Optional, stored in `providerData.plan` |

### Version pinning

OmniRoute pins to specific Claude Code versions to match fingerprints:
- CLI version: `2.1.187`
- Stainless SDK version: `0.94.0`

These should be constants in relay-ai with env var overrides for when Claude Code updates.

### Implementation plan for Phase 1c

New file: `src/oauth/claude-identity.ts` — port from OmniRoute's `claudeIdentity.ts`:
- `selectBetaFlags(body, model, clientBeta)` — dynamic anthropic-beta selection
- `buildUserIdJson({ deviceId, accountUUID, sessionId })` — metadata.user_id builder
- `resolveCliUserID(providerData, seed)` — cliUserID resolver with lazy generation
- `resolveAccountUUID(providerData, seed, accessToken)` — account UUID with background bootstrap fetch
- `fetchClaudeBootstrap(accessToken)` — GET `/api/claude_cli/bootstrap` with proper headers

Changes to `upstream-forward.ts`:
- Branch `anthropicUpstreamHeaders()` on `authType === 'oauth'` — send `Authorization: Bearer` only, skip `x-api-key`
- Inject `metadata.user_id` into request body for OAuth routes
- Set `anthropic-beta` via `selectBetaFlags()` instead of static value

---

## Learnings from 2026-06-25 GUI OAuth Implementation (xAI + OpenAI device code)

These are bugs and traps we hit when implementing the first OAuth flows in the GUI. Apply all of these when building Antigravity and Claude OAuth.

### 1. Zero-model catch-22 — most critical

`materializeOne` returns null if `models.length === 0`, regardless of authentication state. An OAuth provider with a valid token but empty `modelsCache` is completely invisible: no card in the UI, not in the CLI picker, no way to trigger a refresh. Users are silently stuck.

**`upsertOAuthProvider` does not populate `modelsCache`.** It creates a bare registry entry. The CLI's `authenticateProvider` always calls `refreshProviderModels` immediately after — the GUI path must do the same.

**Required pattern — must follow this exactly:**
```typescript
// In the background poll callback, after token exchange:
await saveNativeOAuthCredential(providerId, tokens, accountId);
await refreshOAuthProviderModels(providerId);   // ← MUST come before setting status: done
oauthSessions.set(sessionId, { ...session, status: 'done' });
// Only mark done after models are in the cache.
// If the UI polls and sees 'done' before models exist, the reload shows 0 models.
```

**GUI safety net** — `handleGetModels` now includes authenticated OAuth providers with 0 models as visible cards (so the user can click Refresh Models). This is a fallback, not a primary path. Antigravity and Claude OAuth must still do the refresh before setting `done`.

---

### 2. `refreshProviderModels` requires `authRef`, not `api.key`

OAuth providers don't have `api.key` — that field is undefined. Any code that reads `registryProvider.api.key` to get the credential silently passes `null` and the refresh fails with no error.

**Always resolve credentials via `authRef`:**
```typescript
const apiKey = await resolveProviderCredential(providerId, registryProvider.authRef);
await refreshProviderModels(providerId, apiKey, registry);
```

This was broken in `handleProviderRefresh` and is now fixed. Watch for this pattern everywhere credentials are resolved from a registry entry.

---

### 3. OAuth providers must be in `PROVIDER_TEMPLATES` and `handleGetTemplates`

If a user deletes an OAuth provider, it can only reappear in "Available Providers" if:
1. It has an entry in `PROVIDER_TEMPLATES` with `authType: 'oauth'`
2. `handleGetTemplates` explicitly includes OAuth templates — `listAddableTemplates` calls `listSupportedTemplates` which filters `authType === 'api'` only, so OAuth templates are invisible through that path

**Required:** Add Antigravity and Claude to `PROVIDER_TEMPLATES`. In `handleGetTemplates`, query OAuth templates separately:
```typescript
const oauthTemplates = PROVIDER_TEMPLATES
  .filter(t => t.authType === 'oauth' && t.supported && t.addable !== false && !configured.has(t.id))
  ...
```

---

### 4. Template card UX must be auth-type-aware

`buildTemplateCard` in `app.js` shows "Get API key ↗" for all templates. OAuth templates should show "Learn more ↗" (or nothing). The template body for OAuth must render a "Sign in" button — not a key input field.

The `buildOAuthTemplateBodyContent` function now handles this. Antigravity and Claude templates just need to be routed through it via the `template.authType === 'oauth'` check that already exists in `buildTemplateBodyContent`.

---

### 5. PKCE session store — verifier must be tied to session ID

For PKCE flows (Antigravity, Claude Code), the code verifier and OAuth state parameter must survive from when the browser redirect is initiated to when the `/oauth/callback` route fires. The `oauthSessions` Map in `ui/api.ts` is the right place to store these.

**Session shape to extend:**
```typescript
interface OAuthSession {
  status: 'pending' | 'done' | 'error';
  url: string;
  userCode?: string;       // device code only
  codeVerifier?: string;   // PKCE only — never send to client
  oauthState?: string;     // PKCE only — ties callback to session
  providerId: string;
  error?: string;
}
```

The `GET /oauth/callback?code=...&state=...` route matches `state` to a session, retrieves `codeVerifier`, completes the token exchange, then runs `saveNativeOAuthCredential` + `refreshOAuthProviderModels` + sets `status: done`. The client is already polling — no extra wiring needed.

---

### 6. `display:flex` in inline style overrides the `hidden` attribute

The browser's `hidden` attribute sets `display: none` via the UA stylesheet. An explicit `display:flex` in `element.style.cssText` wins and the element stays visible.

**Never mix `element.hidden` with `display:` in inline styles. Use one or the other:**
```javascript
// Correct — toggle display directly
panel.style.display = 'none';   // hide
panel.style.display = 'flex';   // show

// Wrong — hidden attribute loses to inline display:flex
panel.hidden = true;            // ignored if style has display:flex
```

This caused the delete confirmation panel to always show on card expand. Any UI element with a flex layout that needs to be toggled must use `style.display` explicitly.

---

### 7. Ordering: save credential → refresh models → mark done → client reloads

The full correct sequence for any OAuth flow completion in the GUI:

```
1. Token exchange completes (device poll or PKCE callback)
2. saveNativeOAuthCredential(providerId, tokens, accountId?)
   → saves to keychain + upserts provider in registry (no models yet)
3. refreshOAuthProviderModels(providerId)
   → fetches model list from provider API → writes modelsCache to registry
4. oauthSessions.set(sessionId, { status: 'done' })
5. Client polls, gets 'done', calls initModels() + renderProviders()
   → provider now materializes (has credential + models) → visible everywhere
```

If step 3 is skipped or runs after step 4, the client reloads before models exist and the provider is invisible. This is the same sequence the CLI uses in `authenticateProvider` and it must be preserved in the GUI.
