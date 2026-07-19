# Provider Configuration Guide

`relay-ai` uses a Native Provider Registry to store configuration and API keys securely in your OS keychain. This guide outlines all available providers, what they do, and common gotchas (like multiple variants of the same provider).

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

You can also connect them from **Providers & Keys** in `relay-ai ui`. Relay AI displays the device code, provides a **Copy code** button, and opens the provider's sign-in page only after you select **Open sign-in page**.

GitHub Copilot catalogs are plan-aware. Paid accounts receive the callable chat models returned for that account. Free accounts receive only the verified Free-compatible models. If the plan cannot be verified, Relay AI uses the same conservative Free policy so it does not expose models that may consume paid requests. Use **Refresh Models** after changing plans.

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

- **Amazon Bedrock**: Currently requires AWS credentials rather than a simple API key. Use OpenCode's setup and then run `relay-ai providers import`.
- **Azure OpenAI**: Requires specific deployment URLs per model. Use OpenCode's setup and run `relay-ai providers import`.
- **Google Vertex AI**: Handled dynamically using `gcloud` Application Default Credentials via `relay-ai server --vertex`. No API key configuration is required in the registry.
