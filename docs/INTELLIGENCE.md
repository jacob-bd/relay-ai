# Model Intelligence score (optional)

Relay can show an **Intelligence** score next to each model, so you can pick the smartest model from a list. The scores come from [Artificial Analysis](https://artificialanalysis.ai/) (their *Intelligence Index*). The feature is optional and off until you add a key.

## What the score means

The Intelligence Index combines results from many hard tests of reasoning, knowledge and coding into one number. Higher means smarter overall. Use it to compare models with each other, not as a promise for your own task. Relay shows a score when the model id matches an Artificial Analysis slug (after normalizing dots/slashes), including dated checkpoints (e.g. provider `deepseek-v4.1-flash` → AA `deepseek-v4-1-flash-1017`). Effort variants (`-high`, `-non-reasoning`, …) are only used when the model id itself names that effort — a wrong score is worse than none. Artificial Analysis's free list currently covers on the order of ~100 scored entries (~60 unique bases); models they have not scored show a dash.

## Set it up

1. Create a free account at [artificialanalysis.ai/login](https://artificialanalysis.ai/login). If Google sign-in is blocked ("Access blocked"), create the account with your **email address** instead.
2. Open [API key management](https://artificialanalysis.ai/api-key-management-redirect) and create a key.
3. In `relay-ai ui`, open **Intelligence**, paste the key and click **Save & download**.

Relay checks the key before saving it, stores it in your operating system's credential store (or `RELAY_AI_HOME/secrets.json` where none exists), and downloads the scores to `RELAY_AI_HOME/intelligence.json`.

## Where it shows

An **Intelligence** column appears on every provider's model page and in the Free Pool's free-model list. Click the header to sort: smartest first, then lowest first, then back to the normal order. Models without a score always stay last. Free Pool members, Favorites and the favorites search results show the score as an `IQ` badge. The column header carries the explanation and a link to artificialanalysis.ai, as their terms require.

## Limits and data handling

- Free plan: 100 requests per 24 hours. A refresh reads about four pages, so it uses about four requests. Relay refreshes at most once a day, or when you click **Refresh now**.
- Each person uses their own key. Relay only downloads the data to your computer and does not bundle or redistribute it.
- **Remove key & scores** deletes the key and the downloaded scores.
- Data and branding belong to Artificial Analysis; see their [terms](https://artificialanalysis.ai/terms-of-use).
