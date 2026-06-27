# OAuth Providers

relay-ai supports two categories of OAuth providers:

- **Standard OAuth** — device code flows against GitHub Copilot, xAI (SuperGrok), and OpenAI (ChatGPT). These use your own subscription but are straightforward and low-risk.
- **Subscription token extraction** — browser-redirect PKCE flows that extract OAuth tokens from Claude Code and Antigravity (Google Cloud Code Assist). **These carry serious account risk and will very likely lead to bans.** Read the warnings carefully before using them.

---

## Standard OAuth Providers

These use device-code flows — you open a URL, enter a code, and the token is stored. Risk of account action is low for normal usage.

| Provider ID | Subscription | Auth Method |
|-------------|-------------|-------------|
| `openai-oauth` | ChatGPT Plus / Pro | Device code at `auth.openai.com/codex/device` |
| `xai-oauth` | xAI SuperGrok | Device code at `x.ai/device` |
| `github-copilot` | GitHub Copilot Individual / Business | Device code at `github.com/login/device` |

### Authenticate

```bash
relay-ai providers auth openai-oauth
relay-ai providers auth xai-oauth
relay-ai providers auth github-copilot
```

Or via the UI:

```bash
relay-ai ui   # → Providers & Keys → sign in
```

### What These Do

The OAuth token for each provider is stored in your OS keychain. When you launch Claude Code or another tool via relay-ai, inference is routed through the provider's API using that token. Token refresh is automatic.

- **OpenAI / xAI:** These use the same OAuth client IDs as the Codex CLI and Grok apps. Terms of Service implications are similar to using any OAuth-connected third-party app.
- **GitHub Copilot:** Uses GitHub's device flow. relay-ai gets a session token scoped to `read:user` plus the Copilot token exchange endpoint.

These are relatively standard OAuth integrations with lower account risk, similar to any third-party app connecting to these services.

---

## ⛔ Subscription Token Extraction Providers

> **READ THIS BEFORE PROCEEDING.**
>
> These providers extract OAuth tokens from your existing subscriptions and use them to route inference from other tools. This is almost certain to violate the Terms of Service of Anthropic and Google. **Account bans are a known and documented consequence.** relay-ai and its authors take no responsibility whatsoever for suspended accounts, lost subscriptions, or any other consequence. You proceed entirely at your own risk.

| Provider ID | Subscription Source | Inference Target |
|-------------|-------------------|-----------------|
| `claude-code` | Anthropic Claude Pro / Max | `api.anthropic.com/v1/messages` |
| `antigravity` | Google account + Cloud Code Assist | `cloudcode-pa.googleapis.com` (internal) |

---

### ⛔ Claude Code OAuth

**What happens:** relay-ai authenticates with your Anthropic account using the Claude Code OAuth PKCE client. The resulting token is used to route inference from other tools (Codex, Gemini CLI, other Claude Code sessions) through your Claude subscription — bypassing the requirement to use Claude Code itself.

**The risk:**

- Anthropic's Terms of Service grant these tokens for Claude Code use **only**. Using them to power other tools is a documented ToS violation.
- Anthropic actively enforces this server-side by validating request shape. They know when their tokens are being used outside of Claude Code.
- Anthropic took legal action against OpenCode in March 2026, forcing them to remove this exact feature. Community users have reported account suspensions.
- A ban means losing your Claude Pro or Max subscription and your Anthropic account.

**What you risk losing:** Your Anthropic account and Claude subscription.

**Our position:** We strongly advise against using your primary Anthropic account for this. relay-ai and its authors take no responsibility for bans or enforcement actions.

---

### ⛔ Antigravity OAuth (Google Cloud Code Assist)

**What happens:** relay-ai authenticates with your Google account to obtain Cloud Code Assist OAuth tokens. Those tokens are used to route inference to Google's internal `cloudcode-pa.googleapis.com` API — the same backend that powers Antigravity, but now used by relay-ai to serve requests from Claude Code or Codex.

**The risk:**

- Google's ToS prohibit routing Cloud Code Assist tokens through third-party proxies.
- Multiple community projects using similar approaches have faced Google account bans and shadow-bans. This is not theoretical.
- A Google account ban is **not** like losing an API key. It means losing Gmail, Google Drive, YouTube, Google Photos, Google Workspace, Google Pay, and every service tied to that account — permanently.

**What you risk losing:** Your entire Google account and everything in it.

**⛔ Do not use your primary Google account. Ever. Use a throwaway or secondary Google account that you can lose without consequence.**

A free Google account created specifically for this purpose is sufficient for authentication.

**Our position:** relay-ai and its authors take no responsibility for account bans, lost data, or any other consequence. We provide this for educational and research purposes only.

---

## Setup — Subscription Providers

### Prerequisites

- relay-ai installed
- A browser available on your machine (OAuth requires a browser redirect)

### Authenticate

```bash
# Claude Code OAuth (browser opens to claude.ai)
relay-ai providers auth claude-code

# Antigravity / Google OAuth (browser opens to accounts.google.com)
relay-ai providers auth antigravity
```

**What happens during authentication:**

1. relay-ai prints a full risk warning in the terminal.
2. You must type `yes` explicitly to proceed. Just pressing Enter cancels.
3. A browser tab opens for sign-in.
4. After sign-in, the browser redirects to a local callback page (`http://127.0.0.1:<port>/callback`).
5. relay-ai exchanges the code for tokens, saves them to your OS keychain, and fetches available models.

**For Antigravity:** After token exchange, relay-ai calls `loadCodeAssist` and polls `onboardUser` to initialize your Cloud Code Assist project. This can take up to 50 seconds on first run.

### Via the UI

```bash
relay-ai ui
```

In the Providers & Keys panel, `Claude Code` and `Antigravity` appear in "Available Providers". The UI shows the risk warning with a required acknowledgment checkbox — the Sign in button stays disabled until you check it.

---

## Available Models

### `openai-oauth`

GPT models available on ChatGPT Plus / Pro subscription — fetched live from the OpenAI API.

### `xai-oauth`

Grok models available on the SuperGrok subscription — fetched live from the xAI API.

### `github-copilot`

Models available via GitHub Copilot — fetched live from the Copilot API.

### `claude-code`

Seeded at authentication (matches Claude Code subscription):

| Model ID | Display Name |
|----------|-------------|
| `claude-opus-4-6` | Claude Opus 4.6 |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 |
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5 |

Not all models may be available depending on your plan tier.

### `antigravity`

Models fetched live from Google's Cloud Code Assist API. Availability depends on your account's Cloud Code tier. Typically includes current Gemini models and Claude models that Google has authorized via Cloud Code.

---

## Token Refresh and Re-authentication

Token refresh for all OAuth providers is automatic using the stored refresh token. If the refresh token expires or is revoked:

```bash
relay-ai providers auth <provider-id>
```

If Anthropic or Google revoke your token as part of an enforcement action, re-authentication will not be possible.

---

## Removing OAuth Providers

```bash
relay-ai providers   # → select provider → delete
```

Removes the provider from the registry and deletes stored tokens from the OS keychain. To also revoke the token on the provider's servers, visit your account settings and revoke third-party app access.

---

## Technical Notes

### Claude Code Identity Simulation

Anthropic validates OAuth requests against the claude-cli fingerprint. relay-ai simulates this:

- `Authorization: Bearer <token>` only — no `x-api-key`
- `User-Agent: claude-cli/2.1.187 (external, cli)`
- `metadata.user_id` in the request body: `{"device_id":"<64-hex>","account_uuid":"<uuid>","session_id":"<uuid>"}`
- Context-aware `anthropic-beta` flags: `oauth-2025-04-20`, `claude-code-20250219` (agent requests), thinking flags, etc.

The `device_id` is generated once at authentication and persisted. The `account_uuid` comes from Anthropic's bootstrap endpoint. The `session_id` is per-process.

### Antigravity Request Format

Requests to Cloud Code Assist use Google's internal envelope format with your `projectId` (obtained during bootstrap), a per-request UUID, Antigravity user agent headers, and safety filters set to OFF to prevent false-positive blocks on legitimate coding content.

### Client Credentials

The OAuth client credentials are the public PKCE values shipped in the respective CLI binaries. Per [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252) and [Google's documentation](https://developers.google.com/identity/protocols/oauth2/native-app), installed-app OAuth client IDs are publicly distributed by design. They are not secrets and can be overridden if rotated:

```bash
export CLAUDE_OAUTH_CLIENT_ID="override"
export ANTIGRAVITY_OAUTH_CLIENT_ID="override"
export ANTIGRAVITY_OAUTH_CLIENT_SECRET="override"
```

---

## Disclaimer

relay-ai and its authors are not affiliated with Anthropic, Google, GitHub, OpenAI, or xAI. These OAuth integrations are provided for educational and research purposes. **We take no responsibility for account bans, ToS violations, suspended subscriptions, lost access to services, or any other consequence of using these providers.** You use them entirely at your own risk.
