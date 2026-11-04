# Provider Configuration Guide

> **Several accounts of one provider, and renaming:** see [Accounts and Provider Names](ACCOUNTS.md).

`relay-ai` uses a Native Provider Registry to store configuration and API keys securely in your OS keychain. This guide outlines all available providers, what they do, and common gotchas (like multiple variants of the same provider).

## Refresh a provider's models

Model lists are fetched when you add a provider and cached. To pick up new models:

- `relay-ai providers refresh-models` (all providers) or `relay-ai providers refresh-models <id>`
- **↻ Refresh models** in any launch picker (`relay-ai claude`, `agy`, `codex`, …) after you choose a provider — it refreshes that provider and reopens the model list
- **Refresh All** on the Providers tab of `relay-ai ui`, or **Refresh** in a provider's details

## Add a model manually

For beta models, private model IDs, or aliases missing from the provider's model list:

1. In `relay-ai ui`, open **Providers & Keys**, select a provider, and use **Add model manually**. In the terminal, run `relay-ai providers`, select the provider, and choose **Add model manually**.
2. Enter the exact upstream model ID and an optional display name. The context-size field is optional in both the UI and CLI; enter it only if your provider documents it, otherwise leave it blank and Relay omits the context metadata.
3. Choose **Test & Add**. Relay makes three small API calls to test text generation, streaming, a harmless tool call, and continuation after its result. Provider charges may apply. Validation stops on failure and has a 90-second request budget. Only passing entries are saved.

Manual models use the provider's existing endpoint, headers and credentials. The initial release supports non-OAuth OpenAI-compatible, Anthropic, OpenAI, and OpenRouter providers. Subscription-specific and cloud protocols continue to use their normal catalogs. Tool support is tested using automatic selection because some reasoning models reject forced tool selection.

Entries are stored in `providers.json` under `manualModels`, separate from the downloaded `modelsCache`, and survive refreshes. They appear alongside discovered models in launch pickers, favorites, the API gateway, and embedded Core. When the provider later lists the same ID, only one entry appears; removing your manual entry reveals the discovered entry. Both the UI and provider wizard offer removal.

“Validated” records a successful small test at a point in time. It does not establish pricing, maximum context, image support, or availability after a beta expires. Context sizes you enter are user-supplied; Relay still applies target context requirements and runtime safety defaults.

## Model list tools (every provider)

Open a provider in `relay-ai ui` (**Providers & Keys** → provider) to see its models with **Type**, **Context** and **Price** columns.

- **Test** sends one request capped at 256 output tokens, checks response and tool calling, and reports response time. It does not measure context or test reasoning settings. Successful responses mark the model as tested Chat. A clear refusal (for example "not a chat model") marks it **Not chat**. Each Test uses a little provider quota.
- **Type** shows what a model is for: 💬 Chat, 🔢 Embedding, 🔀 Reranking, 🛡️ Classifier (safety), 🖼️ Image, 🎬 Video, 🔊 Audio, or ⛔ Not chat. The label under it says where it came from, in priority order:

  | Label | Source |
  |---|---|
  | **manual** | You set it with the pencil. Always wins; ↺ resets it. |
  | **tested** | A Test got a chat reply, or the server refused chat. |
  | **models.dev** | The model's entry on models.dev. |
  | **name guess** | The model's name, e.g. `embed` → Embedding, `rerank` → Reranking, `guardian` → Classifier, `instruct` / `-it` or a known chat family (Qwen, Llama, Gemma, Mistral, DeepSeek, GLM, Granite, Nemotron, GPT, Claude, Gemini…) → Chat. Document parsers stay Unknown. |

  Safety, image, video and audio names keep their type even after a passing Test, because those models also answer chat requests.
- **Hide** (eye icon) removes a model from every launch picker, **All provider models**, favorites, the server gateway and Core. It stays on this page, dimmed, so you can unhide it. Refreshes never un-hide a model.
- **Bulk select**: tick rows, or use **Select non-chat** to tick every visible model whose type is known and is not Chat, then **Hide**, **Unhide** or **Clear**. Nothing is hidden until you click Hide.
- **Context size pencil**: type a size such as `128K` or `1M` and save. A size you type is labelled **manual**, wins over everything else, and survives refreshes. ↺ resets it. In the terminal: `relay-ai providers` → provider → **Test a model / set context size**.

## Custom endpoints

Custom OpenAI-compatible and Anthropic-compatible endpoints (self-hosted vLLM, company gateways, LiteLLM and similar) often list models without context sizes. Relay fills the gap in three ways, and labels each size so you know how much to trust it:

| Label | Meaning |
|---|---|
| **manual** | You typed it. Always wins. |
| **measured** | The server stated its limit during explicit context measurement. |
| **estimate** | No size from the server. Relay uses the size models.dev lists for that model across vendors (the most common value, the smaller one on a tie), or a default. The server may run a smaller limit. |

**How measuring works.** Relay sends one tiny request asking for an impossibly long answer. Servers that refuse it usually state their real maximum (vLLM, for example, replies `max_tokens=… cannot be greater than max_model_len=40960`). Nothing large is sent, so a measurement costs about the same as a normal Test. Servers that don't state a limit leave the size unchanged.

**Measure context sizes** (custom endpoints only, in `relay-ai ui`) measures every visible model, three at a time, after you confirm. The button shows progress and doubles as Cancel; a summary lists how many sizes were updated, confirmed, or not reported. Relay never measures on its own, and never across a built-in provider's whole catalog.

**What Claude Code sees.** Claude Code knows only two windows for these models: 200K, or 1M. Relay gives a model 1M only when its size is 1,000,000 or more and not an estimate. One-model launches pass the exact size (a 262K model shows 262K); model-switching sessions show 200K for anything under 1M. An *estimate* counts as at most 200K, so measure or set the context size to unlock its full size in Claude Code.

**Claude-style custom endpoints** receive the API key both as `x-api-key` and as `Authorization: Bearer`, because gateways differ on which one they accept. Your custom headers are sent too, including on single-model Claude Code launches.

**One gateway, two endpoints.** Some gateways publish one model list but serve only some models on their Claude-style endpoint. Adding the gateway twice (once OpenAI-compatible, once Anthropic-compatible) is supported. If a Test on the Claude-style entry says *"This provider's endpoint doesn't serve this model"*, use that model from the OpenAI-compatible entry and hide it on the other. Relay converts protocols for every tool, so the OpenAI-compatible entry works in Claude Code too.

**Internal certificates.** A server signed by a company certificate authority can work in your browser but fail in Relay, because Node only trusts its own bundled list. Tick **Trust this computer's certificates (advanced)** on the custom-provider form, or run:

```bash
relay-ai providers trust-certs on      # also: off, status
```

Relay then also trusts the certificates installed on your computer, for the whole Relay process. It is off by default and saved in `~/.relay-ai/config.json`. When adding a provider fails on an untrusted certificate, Relay explains this and offers to turn it on and retry. It needs Node 22.19 or newer; on older Node, start Relay with `NODE_USE_SYSTEM_CA=1`. Expired certificates and hostname mismatches are not affected and still fail.

## Native Providers

When you run `relay-ai providers add`, you can select from the following templates. The CLI automatically configures the correct endpoint format (`@ai-sdk/openai-compatible` vs specific SDKs) and fetches available models.

### Anthropic
- **Description**: The official Anthropic API for Claude models.
- **Base URL**: `https://api.anthropic.com`
- **Known Issues**: None. Highly recommended for standard Claude access.

### OpenAI
- **Description**: The official OpenAI API for GPT models, o-series reasoning models, and Codex.
- **Base URL**: `https://api.openai.com/v1`

### Google Gemini
- **Description**: The official Google Generative Language API for Gemini models.
- **Base URL**: `https://generativelanguage.googleapis.com/v1beta/openai`

### Groq
- **Description**: Ultra-fast inference API hosting open-weight models (Llama, Mixtral).
- **Base URL**: `https://api.groq.com/openai/v1`

### Mistral
- **Description**: Official API for Mistral models.
- **Base URL**: `https://api.mistral.ai/v1`
- **Gotchas / Known Issues**: Mistral's free tier has strict API rate limits (HTTP 429). Tool-heavy coding sessions can burn through your quota very quickly due to parallel requests.

### Together AI
- **Description**: Platform for training, fine-tuning, and running open-source models.
- **Base URL**: `https://api.together.xyz/v1`

### Cerebras
- **Description**: High-speed AI inference platform powered by wafer-scale chips.
- **Base URL**: `https://api.cerebras.ai/v1`

### DeepInfra
- **Description**: Serverless inference for top open-source models.
- **Base URL**: `https://api.deepinfra.com/v1/openai`

### DeepSeek
- **Description**: API for DeepSeek's coding and chat models.
- **Base URL**: `https://api.deepseek.com/v1`

### Zhipu AI (GLM)
- **Description**: Chinese provider hosting the GLM model family.
- **Base URL**: `https://open.bigmodel.cn/api/paas/v4`

### Qwen Cloud and Alibaba DashScope

Relay offers three separate API-key provider entries for Qwen/DashScope. They use distinct
accounts, endpoints, billing, and API keys: a key from one entry is not interchangeable with
another. These are API keys, not OAuth sign-ins.

#### 1. Alibaba DashScope (China)
- **Base URL**: `https://dashscope.aliyuncs.com/compatible-mode/v1`
- **Description**: The existing mainland China DashScope platform for Qwen and other Alibaba models.

#### 2. Qwen Cloud (Pay-As-You-Go)
- **Base URL**: `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`
- **API keys**: Create a Qwen Cloud API key at `https://home.qwencloud.com/api-keys`.
- **Billing**: Standard pay-as-you-go pricing. Relay can show Alibaba pricing metadata for this variant.

#### 3. Qwen Cloud (Token Plan)
- **Base URL**: `https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`
- **API keys**: Create a Qwen Cloud API key at `https://home.qwencloud.com/api-keys`.
- **Billing**: Uses Token Plan credits, not pay-as-you-go rates. Relay intentionally does not show
  Alibaba PAYG prices for this option because they would be misleading.

Relay restricts these entries to models suitable for interactive coding and agent tool use, so
image/audio-only and no-tool catalog rows are not offered. Token Plan also remains available through
Relay's API Server because it is commonly used as a coding/agent bridge.

### Cloudflare Workers AI
- **Description**: Cloudflare's hosted inference platform for open-weight models (Llama, Gemma, GLM, Kimi, and others).
- **Base URL**: `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1`
- **Setup**: You need both a Cloudflare **Account ID** (from the Cloudflare dashboard) and an API token, not just an API key — the CLI prompts for the Account ID separately and substitutes it into the base URL.
- **Gotchas / Known Issues**:
  - Standard models get 10,000 free Neurons/day; this is a real rate limit and tool-heavy coding sessions (large system prompts, many MCP tools) can hit `HTTP 429 Too Many Requests` quickly, especially on the free tier.
  - Many Cloudflare models have small context windows (24K–131K). Relay hides models below 128K from Claude Code, Codex, and Gemini (136K for Antigravity, which enforces a stricter internal minimum) since agent system prompts and tool definitions alone can consume 25K+ tokens.

### xAI
- **Description**: API for Grok models.
- **Base URL**: `https://api.x.ai/v1`

### Perplexity
- **Description**: API for Perplexity's online models (Sonar).
- **Base URL**: `https://api.perplexity.ai`

### Cohere
- **Description**: API for Command models.
- **Base URL**: `https://api.cohere.com/compatibility/v1`

### OpenRouter
- **Description**: Unified API proxy providing access to dozens of different models.
- **Base URL**: `https://openrouter.ai/api/v1`
- **Protocol recovery**: OpenRouter exposes both Chat Completions and Anthropic Messages routes. Relay keeps the provider, account, and model fixed; if the selected route fails before output with a protocol or early gateway error, it makes one request on the sibling route. A successful choice is remembered for 24 hours, while two failed attempts pause further protocol retries for five minutes. Authentication, quota, context, and moderation errors are returned without a second request.

### ClinePass
- **Description**: Cline's paid coding model subscription, available through either an API key or Cline account OAuth.
- **Unified CLI setup**: Run `relay-ai providers`, choose **+ Add a provider** → **ClinePass**, then choose **Use an API key** or **Sign in with ClinePass**. For an existing ClinePass entry, choose **Change authentication (API/OAuth)** to switch methods.
- **API key setup**: Get a key from the [Cline account settings](https://app.cline.bot), then paste it into the CLI or UI. Relay validates the key before saving it.
- **OAuth setup**: Run `relay-ai providers auth cline-pass`, or choose **Sign in with ClinePass** in the unified CLI flow or UI.
- **Usage and billing**: Both authentication methods use the ClinePass account and its subscription limits. Relay does not create a separate pay-as-you-go account or bill.
- **Endpoint**: `https://api.cline.bot/api/v1`
- **Model IDs**: Relay refreshes ClinePass's live catalog and preserves full IDs such as `cline-pass/qwen3.8-max`.
- **Free-model gating**: Cline restricts its free-bucket models to the Cline IDE extension and CLI. On provider setup and every model refresh, Relay probes just the free-bucket models with the account credential and hides the ones Cline refuses with the "only available via Cline product surfaces" rejection; ambiguous probe failures keep the model listed, and an account-level rejection pauses the pass without removing anything.
- **Credential isolation**: API keys and OAuth tokens use separate keychain entries. Switching methods replaces the old credential only after the new one is saved.
- **Troubleshooting**: If validation fails, the wizard shows the provider's error and confirms that no registry entry was saved. Add `--trace` to write a redacted diagnostic log under `~/.relay-ai/logs/`.

### A2Agent

- **Setup**: In `relay-ai providers` or the UI's **Add provider** screen, choose **A2Agent** and paste the key from your [A2Agent dashboard](https://a2agent.me/login).
- **Catalog**: Relay discovers model IDs from `https://api.a2agent.me/v1/models` when adding or refreshing the provider. IDs keep their exact casing, including `MiniMax-M3`. Run `relay-ai providers refresh-models a2agent` after catalog changes.
- **Protocols**: Claude Code launches use A2Agent’s Anthropic Messages `/v1/messages` endpoint. Antigravity, Codex, Gemini, Server, and Relay Core use OpenAI Chat Completions `/v1/chat/completions`; A2Agent’s Anthropic streaming omits a field that strict SDK clients reject, so SDK-driven launches stay on Chat Completions. Relay uses Bearer authentication for both, and every catalog model was verified against both endpoints. No separate Anthropic account is needed.
- **Billing**: Requests use your A2Agent balance. Adding or refreshing the provider only lists models and does not generate completions. See the official [model listing](https://docs.a2agent.me/api-reference/models-list) and [Anthropic Messages](https://docs.a2agent.me/api-reference/anthropic-messages) documentation.
- **Prompt caching**: A2Agent caches stable prompt prefixes automatically on its OpenAI Chat Completions endpoint. Relay asks streaming requests to include usage and preserves cache-read tokens through Claude, Gemini, Antigravity, the Server gateway, and Relay Core. No cache key or extra provider setting is required.

### Command Code
- **Description**: A subscription gateway to Anthropic, OpenAI, Google, and open-source models through one key.
- **Setup**: Run `relay-ai providers`, choose **+ Add a provider** → **Command Code**, then paste the API key from your [Command Code settings](https://commandcode.ai/settings).
- **Endpoint**: `https://api.commandcode.ai/provider/v1`
- **Plans**: Every plan except **Go** can call the Provider API. Go ($1/mo) has no API access at all and cannot be used with Relay — see below.

| Plan | Price | Provider API | Models |
| --- | --- | --- | --- |
| Go | $1/mo | No | None — not supported |
| GOAT | $10/mo | Yes | 50 open and mid-tier models |
| Pro | $20/mo | Yes | 63 models, adding Claude Sonnet and Haiku, GPT and Gemini |
| Max 10x / 20x | $100 / $200 per month | Yes | Everything, including Claude Opus and Fable |
| Team Pro | $40/mo | Yes | Same as Pro |
| Provider | $15/mo pay-as-you-go | Yes | Everything, billed per request |

Counts come from Command Code's own plan pages and match what Relay discovers. Check [their plan docs](https://commandcode.ai/docs/plans/goat) for the current per-model breakdown.

- **Two protocols, one provider**: Command Code accepts Claude models only on its Anthropic-schema `/messages` endpoint and every other model only on its OpenAI-schema `/chat/completions` endpoint. Relay pins the correct protocol per model when it refreshes the catalog, so both work from a single provider entry. This is why Command Code is a builtin provider rather than a custom endpoint — a custom endpoint speaks one protocol or the other, never both.
- **Protocol recovery**: The same provider-level fallback protects newly named or stale catalog entries on requests Relay translates (non-Claude models, and any model used from Codex, Gemini, or Antigravity). Relay tries the sibling endpoint once only after an early protocol or gateway failure and before any streamed content is committed; it never changes the account or model. Claude models in Claude Code are forwarded to `/messages` untouched and do not retry on the sibling endpoint.
- **Relay lists only the models your plan can actually call**: Command Code gates models by plan, and the gating does not follow model family. On GOAT, `gpt-5.6-sol` works but `gpt-5.5` does not, and `gemini-3.8-flash` works but `gemini-3.5-flash` does not. No endpoint reports your plan, so when you add the provider or run `relay-ai providers refresh-models commandcode`, Relay sends one minimal request per model and drops the ones your plan rejects. A rejected model is refused before it generates anything, so this costs nothing beyond a token or two for the models you do have. Expect the add and refresh steps to take roughly 20 to 30 seconds. If you change plans, refresh the model list to pick up the difference.
- **Temporary outages do not shrink your catalog**: Command Code returns HTTP 503 when the provider behind a model is overloaded. Relay keeps those models listed, and only an explicit `MODEL_NOT_IN_PLAN` rejection removes one.
- **Model IDs**: Relay preserves the provider's full IDs, such as `deepseek/deepseek-v4.1-flash` and `claude-sonnet-5`.
- **Usage and billing**: Requests draw on your existing Command Code subscription credits. Relay does not create a separate account or bill.
- **Works with**: `relay-ai claude`, `codex`, `gemini`, the desktop apps, Antigravity, and `relay-ai server`. Models are routed the same way in every launcher.
- **Troubleshooting `Stream error occurred`**: That message comes from Command Code, not Relay. When the provider behind a model is overloaded, Command Code returns HTTP 503 on a normal request but sends HTTP 200 followed by an in-stream error chunk carrying that generic text on a streaming one, which is all any client receives. Try the same prompt on a different Command Code model to confirm; if other models answer, the one you picked is having an upstream outage and will recover on its own.
- **Troubleshooting `MODEL_NOT_IN_PLAN`**: Your plan does not include that model. Run `relay-ai providers refresh-models commandcode` to re-check availability, which also picks up models you gained by upgrading.
- **The Go plan**: Go works only through the private `/alpha/generate` endpoint that the Command Code CLI uses. Command Code rejects requests to it that do not carry the CLI's own identifying headers, so reaching it from Relay would require impersonating the CLI to bypass a control the vendor added deliberately. Relay does not do this, and using a third-party bridge that does may put your Command Code account at risk. Use GOAT or above for API access.

### OpenCode Zen & OpenCode Go
- **Description**: Cloud gateway backends provided by OpenCode using your OpenCode API key ([opencode.ai/auth](https://opencode.ai/auth)).
- **OpenCode Go**: $10/month flat-rate subscription (`--provider go`). Fully supported for external coding agents and Relay AI.
- **OpenCode Zen**: Pay-as-you-go curated model gateway (`--provider zen`). Metered models with billing or credit balance work normally.
- **A second OpenCode key:** `relay-ai providers add zen --new` (or **Add another account** on the Zen or Go card) adds a numbered **OpenCode Zen 2 + OpenCode Go 2** pair that shares its own credential item; the first account and its key are untouched and a numbered account never falls back to it. See [Accounts](ACCOUNTS.md#opencode-zen--go).
- **Expired key (`This API key has expired`)**: the key itself is dead, signing in again won't renew it. Create a new key in the OpenCode console and use **Change API key** on the provider (Go and Zen share the first account's key).
- **Free-tier limitation (`403 OpenCode's free tier can only be used from within OpenCode`)**: As of September 2026, OpenCode blocks third-party clients and external agent harnesses from accessing zero-cost Zen free models (`*-free`, `big-pickle`). They cannot be called from outside the official OpenCode client, so **Relay hides them from the OpenCode Zen model list** instead of offering them. OpenCode Go free models are not affected and stay listed (verified live 2026-10-19). An OpenCode maintainer confirmed on GitHub that free-tier models cannot be called from other harnesses ([Issue #49621](https://github.com/anomalyco/opencode/issues/49621#issuecomment-5723383322), [Issue #49580](https://github.com/anomalyco/opencode/issues/49580#issuecomment-5723289721)). Paid Zen models and OpenCode Go are unaffected.

### Local Models (Ollama & LM Studio)
- **Description**: Connects to locally running inference engines.
- **Base URLs**: Custom prompts ask for your local URL (e.g., `http://127.0.0.1:11434/v1`).
- **Gotchas**: You can skip providing an API key since local APIs generally don't require auth.

---

## Subscription Providers (OAuth)

Relay AI can connect supported subscriptions with a one-time device code instead of an API key:

- **GitHub Copilot**: `relay-ai providers auth github-copilot`
- **OpenAI ChatGPT**: `relay-ai providers auth openai-oauth`
- **xAI SuperGrok**: `relay-ai providers auth xai-oauth`
- **ClinePass**: `relay-ai providers auth cline-pass`
- **Claude Code subscription**: `relay-ai providers auth claude-code` (browser sign-in; paste Anthropic's code back)
- **Antigravity (Google)**: `relay-ai providers auth antigravity` (browser sign-in; use a throwaway Google account — see [Antigravity](ANTIGRAVITY.md))

Every one of them can hold **several accounts** (`--new`), and any provider can be renamed — see [Accounts and Provider Names](ACCOUNTS.md).

You can also connect them from **Providers & Keys** in `relay-ai ui`. Relay AI displays the device code, provides a **Copy code** button, and opens the provider's sign-in page only after you select **Open sign-in page**.

GitHub Copilot catalogs are plan-aware. Paid accounts receive the callable chat models returned for that account. Free accounts receive only the verified Free-compatible models. If the plan cannot be verified, Relay AI uses the same conservative Free policy so it does not expose models that may consume paid requests. Use **Refresh Models** after changing plans.

ClinePass supports both API-key and OAuth authentication. OAuth access tokens are stored without a transport prefix and are formatted as `workos:` only for ClinePass requests. The runtime retries one expired-token request after refreshing OAuth; it does not loop indefinitely.

See [Subscription OAuth](SUBSCRIPTION-OAUTH.md) for complete setup and troubleshooting instructions.

---

## The Moonshot / Kimi Confusion

Moonshot AI has split their product into three separate platforms. They all share the "Kimi" name, but they use different billing systems, different base URLs, and their API keys **are not interchangeable**.

If you use the wrong provider template for your key, you will receive a `401 Invalid Authentication` or `Incorrect API key` error.

### 1. Moonshot (Kimi)
- **Platform**: Chinese Domestic Developer Platform (`platform.moonshot.cn`)
- **Base URL**: `https://api.moonshot.cn/v1`
- **Description**: The standard, pay-as-you-go developer platform for users in China. It provides access to the standard `moonshot-v1` models.

### 2. Moonshot Global (kimi.ai)
- **Platform**: Global Developer Platform (`platform.kimi.ai`)
- **Base URL**: `https://api.moonshot.ai/v1`
- **Description**: The standard, pay-as-you-go developer platform for international users. **Crucially**, the global platform also grants access to `kimi-k2.7-code` directly through the standard API, bypassing the need for a separate coding subscription. If you generated a key at `platform.kimi.ai`, use this provider!

### 3. Kimi Code (Subscription Required)
- **Platform**: Kimi Code Subscription Console (`www.kimi.com/code/console`)
- **Base URL**: `https://api.kimi.com/coding/v1`
- **Description**: A standalone monthly subscription product specifically geared towards coding agents. If you bought a monthly "Kimi Plus" or "Kimi Code" subscription, you must generate your API key directly from the coding console, and select this provider in `relay-ai`.

---

## Unsupported / Advanced Providers

- **Amazon Bedrock**: Not supported as a first-class API-key provider yet (needs AWS credentials). If you already configured Bedrock in OpenCode CLI, you can optionally run `relay-ai providers import`.
- **Azure OpenAI**: Not supported as a first-class provider yet (needs per-model deployment URLs). Optional: `relay-ai providers import` if already set up in OpenCode CLI.
- **Google Vertex AI (Claude)**: Add with `relay-ai providers add vertex-anthropic` (or in `relay-ai ui`). Uses gcloud Application Default Credentials and `ANTHROPIC_VERTEX_PROJECT_ID` — no API key — and reads models live from `~/.relay-ai/vertex-models.json` (defaults to the current Claude lineup; add, remove or reset models from the provider's menu in `relay-ai providers`). `relay-ai server --vertex` remains available as a dedicated gateway. Gemini on Vertex is not supported yet.

## Free model pool

See [Relay Free Pool](FREE_POOL.md) for the shared pool UI, matching CLI commands, test request costs, and optional context/reasoning checks.
