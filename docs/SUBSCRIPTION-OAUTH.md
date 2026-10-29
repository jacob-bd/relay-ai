# Subscription OAuth

Relay AI can connect these subscription providers without asking you to paste an API key:

- GitHub Copilot
- OpenAI ChatGPT
- xAI SuperGrok
- ClinePass
- Claude Code subscription (browser sign-in, paste the code back)
- Antigravity (Google account, browser sign-in)

Each one can hold **more than one account**, and every account can be renamed — see [Accounts and Provider Names](ACCOUNTS.md).

## Sign in from the web UI

Start the dashboard:

```bash
relay-ai ui
```

Open **Providers & Keys**. For a new connection, select the provider under **Available Providers** to expand its setup panel. For an existing connection, select the Manage chevron on its card. Then select **Get sign-in code**.

1. Select **Copy code** beside the large one-time code.
2. Select **Open sign-in page**. Relay AI opens the provider's secure login page only after you click this button.
3. Sign in on that page, paste the code, and approve access.
4. Return to Relay AI. The panel updates automatically when sign-in finishes and then refreshes the provider's model list.

The one-time code is not your access token and expires if you do not finish the flow. If it expires, select **Get sign-in code** again.

## Sign in from the terminal

You can use the same providers without the web UI:

```bash
relay-ai providers auth github-copilot
relay-ai providers auth openai-oauth
relay-ai providers auth xai-oauth
relay-ai providers auth cline-pass
relay-ai providers auth claude-code
relay-ai providers auth antigravity
```

Add `--new` to sign in a **second account** of the same provider instead of replacing the first (for example `relay-ai providers auth openai-oauth --new`). Without `--new`, signing in again replaces the existing account's credential, and an interactive terminal first names the account and asks (default no).

Follow the device-code instructions printed in the terminal. Credentials are stored in the operating system's secure credential store when available, or in `RELAY_AI_HOME/secrets.json` (e.g. Docker) when the OS store is unavailable.

## Claude Code and Antigravity sign-in

These two use a browser sign-in rather than a device code, and both carry an account-risk warning (Anthropic and Google may not intend this use; see [Antigravity](ANTIGRAVITY.md) and the confirmation text Relay shows).

- **Claude Code:** the sign-in page (`claude.com/cai/oauth/authorize`) shows a code. Paste it into the terminal prompt, or in the web UI click **Open sign-in page** and paste the code into the card. The pasted code must carry the `state` of the sign-in Relay started, or it is rejected. Relay exchanges and refreshes tokens at `platform.claude.com/v1/oauth/token`, the endpoint the current Claude Code (2.1.312) uses.
- **Antigravity:** a Google browser sign-in that returns to Relay on your own machine; Relay checks the response's `state` before accepting it.
- In the web UI both are behind a confirmation of the account risk that the server enforces.
- A browser that is already signed in reuses that account. To add a *different* one, use a private window or **Copy sign-in link** (web UI).

## Several accounts, expired sign-ins and who is signed in

- **Add another account:** `relay-ai providers auth <id> --new`, **Add another account** in the provider menu, or the button on a card in `relay-ai ui`. A second account gets its own id (`openai-oauth-2`), its own credential item and a numbered default name; rename it to taste.
- **The same person is blocked from being added twice** (matched by user id, then email, then GitHub login; Claude Code and ClinePass by account id; a ChatGPT workspace id alone never matches).
- **Account row:** provider details and web-UI cards show the account's email or plan where the sign-in reveals it, so you can pick a name. Relay never names an account after its email.
- **Expired sign-ins** stay on the web-UI Providers page as **Sign-in expired** with a **Sign in again** button.
- **Concurrent refreshes are safe:** a per-account lock stops two processes from spending the same one-use refresh token.

Full details: [Accounts and Provider Names](ACCOUNTS.md).

## ClinePass API keys and OAuth

ClinePass is the one subscription provider that supports both modes. In the CLI, run `relay-ai providers`, choose **+ Add a provider** → **ClinePass**, and then choose **Use an API key** or **Sign in with ClinePass**. You can also use `relay-ai providers auth cline-pass` directly for OAuth, or configure either method from the browser UI's single ClinePass card. Changing modes saves the replacement credential before removing the previous one.

Both methods use the ClinePass account and subscription limits; Relay does not create separate pay-as-you-go billing. If API-key setup fails, the wizard displays the error and does not save the provider.

Cline restricts its free-tier models to the Cline IDE extension and CLI. Relay probes the free bucket on setup and every model refresh and hides the models that answer with Cline's "only available via Cline product surfaces" rejection; see [docs/PROVIDERS.md](PROVIDERS.md) for the full behavior.

## GitHub Copilot plans and models

After GitHub Copilot sign-in, Relay AI checks the account's Copilot access level and stores only a small, non-secret plan summary alongside the credential. It does not expose the GitHub login or raw plan identifier in the web UI.

- **Paid Copilot:** Relay AI shows the callable chat models returned for the account, excluding automatic routers, embedding models, and entries GitHub marks as disabled or unavailable in the model picker.
- **Copilot Free:** Relay AI shows only the verified Free-compatible model allowlist and marks those models as Free.
- **Plan unavailable:** Relay AI applies the same conservative Free policy until the account lookup succeeds. This prevents a temporary lookup failure or old model cache from exposing models that may consume paid requests.

Use **Refresh Models** on the provider card after changing Copilot plans. Relay AI also retries plan detection for older credentials that were saved before plan-aware filtering was added.

## Troubleshooting

- **The code expired:** Generate a new code and repeat the sign-in steps.
- **The browser did not open:** Allow pop-ups for the local Relay AI page, then select **Open sign-in page** again.
- **The UI still says Plan unverified:** Select **Refresh Models**. If the provider's account endpoint is temporarily unavailable, Relay AI intentionally keeps the Free-safe catalog.
- **No models appear after sign-in:** Select **Refresh Models**. If the error persists, re-authenticate the provider and confirm that the subscription is active.
