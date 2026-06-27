#!/usr/bin/env node

// src/provider-templates.ts
var PROVIDER_TEMPLATES = [
  {
    id: "groq",
    name: "Groq",
    authType: "api",
    npm: "@ai-sdk/groq",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    signupUrl: "https://console.groq.com/keys",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "mistral",
    name: "Mistral",
    authType: "api",
    npm: "@ai-sdk/mistral",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    signupUrl: "https://console.mistral.ai/api-keys",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "togetherai",
    name: "Together AI",
    authType: "api",
    npm: "@ai-sdk/togetherai",
    defaultBaseUrl: "https://api.together.xyz/v1",
    signupUrl: "https://api.together.xyz/settings/api-keys",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "cerebras",
    name: "Cerebras",
    authType: "api",
    npm: "@ai-sdk/cerebras",
    defaultBaseUrl: "https://api.cerebras.ai/v1",
    signupUrl: "https://cloud.cerebras.ai",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "deepinfra",
    name: "DeepInfra",
    authType: "api",
    npm: "@ai-sdk/deepinfra",
    defaultBaseUrl: "https://api.deepinfra.com/v1/openai",
    signupUrl: "https://deepinfra.com/dash/api_keys",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    authType: "api",
    npm: "@ai-sdk/openai-compatible",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    signupUrl: "https://platform.deepseek.com",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "zhipu",
    name: "Zhipu AI (GLM)",
    authType: "api",
    npm: "@ai-sdk/openai-compatible",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    signupUrl: "https://open.bigmodel.cn",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "moonshot",
    name: "Moonshot (Kimi)",
    authType: "api",
    npm: "@ai-sdk/openai-compatible",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    signupUrl: "https://platform.moonshot.cn",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "moonshot-global",
    name: "Moonshot Global (kimi.ai)",
    authType: "api",
    npm: "@ai-sdk/openai-compatible",
    defaultBaseUrl: "https://api.moonshot.ai/v1",
    signupUrl: "https://platform.kimi.ai",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "kimi-code",
    name: "Kimi Code (Subscription Required)",
    authType: "api",
    npm: "@ai-sdk/openai-compatible",
    defaultBaseUrl: "https://api.kimi.com/coding/v1",
    modelSource: "static-seed",
    staticModels: [
      { id: "kimi-for-coding", name: "Kimi Code K2.7 (Unified)" }
    ],
    supported: true
  },
  {
    id: "xai",
    name: "xAI",
    authType: "api",
    npm: "@ai-sdk/xai",
    defaultBaseUrl: "https://api.x.ai/v1",
    signupUrl: "https://console.x.ai",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "perplexity",
    name: "Perplexity",
    authType: "api",
    npm: "@ai-sdk/perplexity",
    defaultBaseUrl: "https://api.perplexity.ai",
    signupUrl: "https://www.perplexity.ai/settings/api",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "cohere",
    name: "Cohere",
    authType: "api",
    npm: "@ai-sdk/cohere",
    defaultBaseUrl: "https://api.cohere.com/compatibility/v1",
    signupUrl: "https://dashboard.cohere.com/api-keys",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "openai",
    name: "OpenAI",
    authType: "api",
    npm: "@ai-sdk/openai",
    defaultBaseUrl: "https://api.openai.com/v1",
    signupUrl: "https://platform.openai.com/api-keys",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "google",
    name: "Google Gemini",
    authType: "api",
    npm: "@ai-sdk/google",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    signupUrl: "https://aistudio.google.com/apikey",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "alibaba",
    name: "Alibaba DashScope",
    authType: "api",
    npm: "@ai-sdk/alibaba",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    signupUrl: "https://dashscope.console.aliyun.com/apiKey",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    authType: "api",
    npm: "@openrouter/ai-sdk-provider",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    signupUrl: "https://openrouter.ai/keys",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "ollama",
    name: "Ollama",
    authType: "api",
    npm: "@ai-sdk/openai-compatible",
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    urlPrompt: "Ollama API Base URL:",
    apiKeyOptional: true,
    modelSource: "api-list",
    supported: true
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    authType: "api",
    npm: "@ai-sdk/openai-compatible",
    defaultBaseUrl: "http://127.0.0.1:1234/v1",
    urlPrompt: "LM Studio API Base URL:",
    apiKeyOptional: true,
    modelSource: "api-list",
    supported: true
  },
  {
    id: "venice",
    name: "Venice AI",
    authType: "api",
    npm: "venice-ai-sdk-provider",
    defaultBaseUrl: "https://api.venice.ai/api/v1",
    signupUrl: "https://venice.ai/settings/api",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "anthropic",
    name: "Anthropic",
    authType: "api",
    npm: "@ai-sdk/anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
    signupUrl: "https://console.anthropic.com/settings/keys",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "bedrock",
    name: "Amazon Bedrock",
    authType: "api",
    npm: "@ai-sdk/amazon-bedrock",
    modelSource: "manual-only",
    supported: false,
    unsupportedReason: "Requires AWS credentials \u2014 use relay-ai providers import from OpenCode for now."
  },
  {
    id: "azure",
    name: "Azure OpenAI",
    authType: "api",
    npm: "@ai-sdk/azure",
    modelSource: "manual-only",
    supported: false,
    unsupportedReason: "Requires Azure deployment URLs \u2014 use relay-ai providers import from OpenCode for now."
  },
  {
    id: "vertex",
    name: "Google Vertex AI",
    authType: "none",
    npm: "@ai-sdk/google-vertex",
    modelSource: "manual-only",
    supported: false,
    unsupportedReason: "Uses gcloud Application Default Credentials \u2014 not supported via API key import."
  },
  {
    id: "opencode-cloud",
    name: "OpenCode Zen / Go",
    authType: "api",
    npm: "@ai-sdk/openai-compatible",
    signupUrl: "https://opencode.ai/auth",
    modelSource: "zen-go-api",
    supported: true
  },
  {
    id: "zen",
    name: "OpenCode Zen",
    authType: "api",
    npm: "@ai-sdk/openai-compatible",
    signupUrl: "https://opencode.ai/auth",
    modelSource: "zen-go-api",
    supported: true,
    addable: false
  },
  {
    id: "go",
    name: "OpenCode Go",
    authType: "api",
    npm: "@ai-sdk/openai-compatible",
    signupUrl: "https://opencode.ai/auth",
    modelSource: "zen-go-api",
    supported: true,
    addable: false
  },
  // Subscription OAuth providers — Authorization Code + PKCE (browser redirect)
  // ⚠️  These extract tokens from paid subscriptions. Account risk — see plan docs.
  {
    id: "claude-code",
    name: "Claude Code (Anthropic subscription)",
    authType: "oauth",
    npm: "@ai-sdk/anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
    signupUrl: "https://claude.ai",
    modelSource: "static-seed",
    staticModels: [
      { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" }
    ],
    supported: true,
    subscriptionRisk: true
  },
  {
    id: "antigravity",
    name: "Antigravity (Google Cloud Code Assist)",
    authType: "oauth",
    npm: "@ai-sdk/openai-compatible",
    signupUrl: "https://antigravity.google",
    modelSource: "api-list",
    supported: true,
    subscriptionRisk: true
  },
  // OAuth-gated subscription providers — device code or broker sign-in
  {
    id: "xai-oauth",
    name: "xAI Grok (SuperGrok)",
    authType: "oauth",
    npm: "@ai-sdk/xai",
    signupUrl: "https://x.ai",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "openai-oauth",
    name: "OpenAI (ChatGPT)",
    authType: "oauth",
    npm: "@ai-sdk/openai",
    signupUrl: "https://chatgpt.com",
    modelSource: "api-list",
    supported: true
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    authType: "oauth",
    npm: "@ai-sdk/openai-compatible",
    defaultBaseUrl: "https://api.githubcopilot.com",
    signupUrl: "https://github.com/features/copilot",
    modelSource: "api-list",
    supported: true
  }
];
function listSupportedTemplates() {
  return PROVIDER_TEMPLATES.filter((t) => t.supported && t.authType === "api" && t.addable !== false).sort((a, b) => a.name.localeCompare(b.name));
}
function listAddableTemplates(configuredIds = []) {
  const configured = new Set(configuredIds);
  return listSupportedTemplates().filter((t) => {
    if (t.id === "opencode-cloud") {
      return !configured.has("zen") && !configured.has("go");
    }
    return !configured.has(t.id);
  });
}
function getTemplateById(id) {
  return PROVIDER_TEMPLATES.find((t) => t.id === id);
}
function filterTemplates(templates, query) {
  const q = query.trim().toLowerCase();
  if (!q) return templates;
  return templates.filter(
    (t) => t.id.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.npm.toLowerCase().includes(q)
  );
}

export {
  PROVIDER_TEMPLATES,
  listSupportedTemplates,
  listAddableTemplates,
  getTemplateById,
  filterTemplates
};
//# sourceMappingURL=chunk-WDZWORL4.js.map