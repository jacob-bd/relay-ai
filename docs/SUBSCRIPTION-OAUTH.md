# Subscription OAuth

Relay AI can connect these subscription providers without asking you to paste an API key:

- GitHub Copilot
- OpenAI ChatGPT
- xAI SuperGrok

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
```

Follow the device-code instructions printed in the terminal. Credentials are stored in the operating system's secure credential store when available, or in `RELAY_AI_HOME/secrets.json` (e.g. Docker) when the OS store is unavailable.

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
