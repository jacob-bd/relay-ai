# Antigravity Support

relay-ai has **two distinct Antigravity modes.** They are completely different in how they work and what they risk. Read both sections carefully.

| Mode | Command | What it does | Risk |
|------|---------|-------------|------|
| **Gateway** (existing) | `relay-ai agy` / `relay-ai antigravity-ide` | Launches Antigravity CLI/IDE and redirects its inference to your relay-ai providers | Medium — use a throwaway Google account |
| **OAuth extraction** (new) | `relay-ai providers auth antigravity` | Extracts your Google Cloud Code Assist tokens so other tools (Claude Code, Codex) can use your Antigravity quota | **High — account bans documented. Do not use primary Google account.** |

---

## Mode 1: Antigravity CLI & IDE Gateway

Relay AI supports both the Antigravity CLI (`agy`) and the Antigravity IDE through a local Cloud Code gateway that injects Relay AI models into Antigravity's native model picker.

> ⚠️ **Use a throwaway Google account. Do not use your main account.**
>
> Antigravity support is experimental and uses local endpoint overrides around Google-owned tooling. This is probably not what Google intended, may violate Google's terms of service, and could lead to account restrictions or bans.
>
> Relay AI does not need your main Google account. Antigravity only needs a Google account for authentication. Use a throwaway account, a secondary account, or another account you can afford to lose. A free Google account should be enough for both the Antigravity CLI and the Antigravity IDE. Do not risk your real Gmail, Workspace, YouTube, Drive, or business account here.

## Commands

```bash
relay-ai agy              # Launch Antigravity CLI
relay-ai antigravity-ide  # Launch Antigravity IDE (macOS)
```

## How It Works

1. Relay AI starts a local Cloud Code gateway on `127.0.0.1` (random port)
2. `CLOUD_CODE_URL` is set to point at the gateway
3. The gateway intercepts `loadCodeAssist` and `fetchAvailableModels`, returning a local catalog with your Relay models injected
4. `streamGenerateContent` requests for Relay models are routed through the Vercel AI SDK to your configured providers
5. Google's original models are preserved in the picker alongside Relay models
6. Cloud Code generation traffic goes through the gateway, not Google

## Account Requirements

### ⚠️ Account warning, please read this before launching

Antigravity requires Google OAuth authentication to start. You cannot use it fully signed out today.

Use a throwaway or secondary Google account. Not your main one.

This matters for both:

- `relay-ai agy`, the Antigravity CLI
- `relay-ai antigravity-ide`, the Antigravity IDE

The account does not need to be special. It does not need to be your paid account. A free Google account should work for authentication.

### Why this matters

- Antigravity stores OAuth credentials in your OS keychain and `~/.gemini/antigravity-cli/`
- The OAuth token must be refreshed periodically via `oauth2.googleapis.com` (this carries only the refresh token, not conversation data)
- This workflow is probably not what Google intended and may be against Google's terms of service
- Google may restrict or ban accounts when their tooling is used in ways they don't allow
- A throwaway account protects the account you actually care about
- **Relay AI's gateway never forwards your prompts, conversation history, or Cloud Code requests to Google**

The practical rule is simple: if losing the account would hurt, don't use it here.

### What Relay AI blocks

- All `v1internal:streamGenerateContent` requests → routed to your Relay providers
- `loadCodeAssist` → served from a local fixture (no Google contact)
- `fetchAvailableModels` → served from a local catalog (no Google contact)
- `fetchUserInfo`, `retrieveUserQuotaSummary`, `setUserSettings`, `listExperiments` → served locally with minimal responses

### What we cannot block (yet)

- OAuth token refresh (`oauth2.googleapis.com`), carries refresh token only, no conversation data
- Antigravity's own telemetry (Sentry), can be disabled with `ANTIGRAVITY_SENTRY_SAMPLE_RATE=0`
- Auto-update checks, the `agy` binary may check for updates independently

## Privacy Guarantee

Relay AI guarantees that its local gateway does not forward identity, prompts, or Cloud Code traffic to Google. We describe this accurately as:

> **Signed-out Relay profile with Google Cloud Code forwarding disabled**

We do not claim this is anonymous, untraceable, or ban-proof. The Antigravity binary may independently contact Google for updates, telemetry, or authentication.

## IDE-Specific Notes

The Antigravity IDE requires two endpoint controls:
- `CLOUD_CODE_URL` environment variable
- `jetski.cloudCodeUrl` in the managed profile settings

Relay AI manages an isolated profile at `~/.relay-ai/antigravity/profile`. Your normal IDE profile is never modified.

## Platform Support

- **macOS (Apple Silicon):** Tested and supported
- **Other platforms:** Coming after binary/profile discovery is verified

---

## Mode 2: Antigravity OAuth Token Extraction

> **⛔ SERIOUS ACCOUNT RISK. Read before proceeding.**
>
> This mode extracts your Google Cloud Code Assist OAuth tokens and uses them to route inference from other tools (Claude Code, Codex, Gemini CLI) through Google's internal API. This is fundamentally different from Mode 1 — instead of launching Antigravity and intercepting its traffic locally, relay-ai authenticates directly with Google and uses your Cloud Code Assist quota on your behalf.
>
> Google has issued account bans and shadow-bans for this type of usage across multiple community projects. A Google account ban is not limited to Cloud Code Assist — it affects Gmail, Drive, YouTube, Workspace, Photos, Google Pay, and every other service tied to your account.
>
> **Do not use your primary Google account. Use a throwaway account only.**
>
> relay-ai and its authors take no responsibility for account bans, lost access, or any other consequence.

### What This Mode Does

1. relay-ai authenticates directly with Google using the Antigravity CLI's OAuth client credentials (public PKCE credentials, not secrets).
2. After sign-in, relay-ai calls Google's `loadCodeAssist` bootstrap endpoint to bind the OAuth token to your Cloud Code Assist project.
3. The tokens are stored in your OS keychain under the `antigravity` provider.
4. When you run `relay-ai claude` (or other tools) with the Antigravity provider selected, relay-ai translates Anthropic-format requests into Google's internal Cloud Code format and forwards them to `cloudcode-pa.googleapis.com`.
5. Responses are translated back to Anthropic format and returned to the client.

This is the **reverse** of Mode 1. Mode 1 lets Antigravity's tools use your relay-ai providers. Mode 2 lets relay-ai's tools use your Antigravity quota.

### Setup

```bash
relay-ai providers auth antigravity
```

A browser tab opens to Google's sign-in page. After sign-in, relay-ai completes the bootstrap automatically (up to 50 seconds on first run).

For full setup instructions, model availability, and technical details: **[docs/SUBSCRIPTION-OAUTH.md](SUBSCRIPTION-OAUTH.md)**
