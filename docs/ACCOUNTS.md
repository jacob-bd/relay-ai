# Accounts and Provider Names

Relay AI can hold **more than one account of the same provider** — two ChatGPT sign-ins, two Claude subscriptions, two Groq keys, two OpenCode keys — and every provider can be **renamed**. Each account is its own provider entry with its own saved credential, its own name, and its own models in every launch picker and in favorites.

- [Rename a provider](#rename-a-provider)
- [Add another account](#add-another-account)
  - [Sign-in providers (OAuth)](#sign-in-providers-oauth)
  - [API-key providers](#api-key-providers)
  - [OpenCode Zen + Go](#opencode-zen--go)
- [The same account twice is blocked](#the-same-account-twice-is-blocked)
- [See who is signed in](#see-who-is-signed-in)
- [Expired sign-ins](#expired-sign-ins)
- [Signing in again replaces only that account](#signing-in-again-replaces-only-that-account)
- [Example: work ChatGPT (native) + personal ChatGPT (Relay)](#example-work-chatgpt-native--personal-chatgpt-relay)
- [Where credentials are stored](#where-credentials-are-stored)
- [Safe token refresh](#safe-token-refresh)
- [Troubleshooting](#troubleshooting)

Existing setups are untouched: nothing is migrated, every saved credential, provider id and favorite keeps working, and a renamed provider keeps the same id, so favorites that point at it still resolve.

## Rename a provider

Any provider can be renamed. The name is display-only — it changes how the provider appears in pickers, favorites and the web UI, never its id or credential.

```bash
relay-ai providers rename openai-oauth "ChatGPT (personal)"
```

Or use **Rename provider** in the `relay-ai providers` menu, or the **Rename Provider** button on a card in `relay-ai ui`.

- Names are limited to 60 characters.
- **Names must be unique**, ignoring capitalization and extra spaces. Renaming to a name another provider already has is refused, as is adding or editing a custom endpoint with a taken name.
- A name you chose is shown exactly as typed, and it survives signing in again, replacing a key, and re-importing.
- If you already had two providers with the same name, Relay numbers them once, the first time it loads the registry ("Groq", "Groq 2").

## Add another account

A second account becomes a new provider next to the first. It gets an id like `groq-2`, `openai-oauth-2` or `zen-2`, a default name with a number ("Groq 2", "ChatGPT 2"), and its own item in your credential store. **Relay never names an account after its email address** — rename it to whatever helps you tell them apart. The email or plan is shown separately (see [See who is signed in](#see-who-is-signed-in)).

The first account is never changed by adding a second.

### Sign-in providers (OAuth)

ChatGPT, xAI SuperGrok, GitHub Copilot, ClinePass, Claude Code and Antigravity can each hold several accounts.

```bash
relay-ai providers auth openai-oauth --new      # a second ChatGPT account
relay-ai providers auth claude-code --new       # a second Claude subscription
relay-ai providers auth antigravity --new       # a second Google account for Antigravity
```

In the `relay-ai providers` menu, open the provider and choose **Add another account**. The **Sign in with OAuth** screen also lists new-account entries. In `relay-ai ui`, use **Add another account** on the provider's card.

Notes per provider:

- **ChatGPT, xAI, GitHub Copilot, ClinePass:** device-code sign-in, same as the first account — the UI shows a code with a **Copy code** button, and the sign-in page opens only when you click **Open sign-in page**.
- **Antigravity (Google):** browser sign-in. In the web UI Relay first asks you to confirm the [account-risk warning](ANTIGRAVITY.md) — the confirmation is enforced by the server, not just the page. The terminal flow checks the sign-in's `state` before accepting the response.
- **Claude Code:** the sign-in page shows a code that you paste back. In the terminal, paste it at the prompt. In the web UI, click **Open sign-in page**, then paste Anthropic's code into the card. As with Antigravity, the UI asks you to confirm the account risk first. A pasted code must carry the `state` this sign-in sent, otherwise it is rejected.
- **A browser that is already signed in** reuses that account. To add a *different* Claude or Google account, use a private window or another browser: the web UI has a **Copy sign-in link** button for this, and in the terminal you can copy the printed URL. If the browser signs you in as the account you already added, Relay says so (and suggests **Sign in again** on that provider instead) — see [The same account twice is blocked](#the-same-account-twice-is-blocked).

Two Claude accounts do not collide in the model list: a numbered account's `claude-*` model ids are scoped to it, while the first account keeps the plain ids.

### API-key providers

Most API-key providers (Groq, Mistral, OpenRouter, DeepSeek, Anthropic, Google, …) can have a second key.

```bash
relay-ai providers add groq --new
```

Or choose **Add another account** in the provider's menu, or on the provider's card in `relay-ai ui`. Relay tests the key before saving and refuses the identical key for the same server.

Not offered for: providers that use gcloud instead of a key, providers that also offer OAuth sign-in as a separate flow (ClinePass — use its OAuth accounts), and custom endpoints (add another custom endpoint instead; one base URL can be added repeatedly, which is the way to use two accounts on one gateway). Providers that need an account id or a server URL (Cloudflare, Ollama, …) can add a second account from the terminal only.

### OpenCode Zen + Go

Zen and Go share one OpenCode API key, so a second key adds a **numbered pair**:

```bash
relay-ai providers add zen --new     # or: add go --new — both add the same pair
```

or **Add another account** on the OpenCode Zen or Go card (CLI menu or `relay-ai ui`). Paste the other account's OpenCode key; Relay creates **OpenCode Zen 2** and **OpenCode Go 2** (`zen-2` + `go-2`).

- The pair shares **one** credential-store item of its own (`opencode-2`, then `opencode-3`, …). **Change API key** on either member changes it for both.
- The first account keeps using the global OpenCode key. A numbered account **never falls back to it** — if its key is removed it simply has no credential rather than quietly using the first account's.
- The same key as any existing OpenCode account is refused.
- Removing a pair member keeps the shared key while the other member exists, and deletes it with the last one.
- Model lists are the same public catalog for every account; the key only decides whose account the requests are billed to.
- OpenCode keys can expire. A request answered with "This API key has expired" means the key itself must be replaced in the OpenCode console, then use **Change API key** on the provider.

## The same account twice is blocked

Relay will not store the same person twice for one provider, since two copies would fight over one rotating refresh token. It compares what the sign-in itself reveals: the account's user id, then email (ignoring case), then GitHub login for Copilot, and the account/organization id for Claude Code and ClinePass. A ChatGPT *workspace* id alone never counts as a match, so two different people in the same workspace are fine.

If you see "This account … is already signed in as …" when adding an account, your browser reused the logged-in session. Use a private window (or **Copy sign-in link**), sign in as the other account, and try again.

## See who is signed in

Sign-in accounts show an **Account** row — email and plan where the provider reveals them — in provider details (`relay-ai providers`) and on cards in `relay-ai ui`. This is read-only information so you can choose a name for the account; Relay does not use it as the name. GitHub Copilot's username is deliberately never sent to the browser.

## Expired sign-ins

A sign-in whose saved credential can no longer be refreshed stays on the **Providers** page in `relay-ai ui` as a card marked **Sign-in expired** with a **Sign in again** button, instead of silently disappearing. You can still rename or remove it. Accounts with no saved credential, or that you disabled, are not shown.

The terminal provider list does not mark expired accounts (checking each account's credential would trigger many keychain reads); if a refresh is permanently refused, the error tells you what to do:

```text
… this sign-in is no longer valid. Sign in again: relay-ai providers auth <id>
```

## Signing in again replaces only that account

`relay-ai providers auth <id>` and **Sign in again** replace that one account's credential. Before overwriting an existing sign-in, an interactive terminal names the provider and account and asks — the default is **no**. Adding another account never asks, because it overwrites nothing.

## Example: work ChatGPT (native) + personal ChatGPT (Relay)

You are signed in to the ChatGPT/Codex desktop app with your **work** account (the app's own, native sign-in) and want your **personal** ChatGPT account's models available in the same session.

```bash
relay-ai providers auth openai-oauth                       # sign in the personal account in Relay
relay-ai providers rename openai-oauth "ChatGPT (personal)"
relay-ai codex-app --with-native                           # work models (native) + Relay models
```

If you already have a Relay ChatGPT account and want a different personal one, use `--new` on the first command. Rotating between two ChatGPT Plus accounts works the same way: add both, rename them, and pick the one you want in the launch picker or as favorites. See [Mixed native + Relay mode](CODEX.md#mixed-native--relay-mode).

## Where credentials are stored

Each account has its own item in the operating system's credential store (or `RELAY_AI_HOME/secrets.json` when none is available, as in Docker):

| Account | Credential item |
|---|---|
| Sign-in account | `oauth:provider:<id>` (for example `oauth:provider:openai-oauth-2`) |
| API-key account | `provider:<id>` (for example `provider:groq-2`) |
| OpenCode Zen/Go, first account | `global:opencode` (shared) |
| OpenCode Zen/Go, numbered pair | `provider:opencode-<N>` (shared by the pair) |

Environment overrides use the provider id: `RELAY_AI_KEY_GROQ_2`, `RELAY_AI_KEY_ZEN_2`, and so on.

## Safe token refresh

Sign-in providers rotate refresh tokens, and a refresh token can be spent only once. When the web UI, a terminal launch and a background process all need a fresh token at the same moment, Relay takes a per-account lock (in `RELAY_AI_HOME/locks`), re-reads the credential store, and uses the result another process already produced instead of spending a stale token. A lock left by a crashed process is detected and broken, and a wait that runs too long proceeds rather than blocking a launch.

## Troubleshooting

- **"The name … is already used by another provider":** pick another name — uniqueness ignores capitalization and spacing.
- **"This account … is already signed in as …" when adding an account:** the browser reused the existing session. Switch accounts in the browser, or use a private window or **Copy sign-in link**.
- **A second account does not show in a launch picker:** it is a separate provider; select it by its name. Favorites also point at a specific account.
- **"Sign-in expired":** use **Sign in again** on the card, or `relay-ai providers auth <id>`.
- **OpenCode "API key has expired":** replace the key with **Change API key** (the first account's old key may still sit in the credential store; the replacement takes priority).
