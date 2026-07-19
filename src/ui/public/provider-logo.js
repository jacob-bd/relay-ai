// Provider brand marks shared by every UI surface that represents a provider.
// Simple Icons URLs were verified when added; inline SVGs cover brands whose
// official assets cannot be hotlinked reliably.

const PROVIDER_INLINE_SVGS = {
  openai: `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg" style="width:20px;height:20px"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.896zm16.597 3.855l-5.843-3.368L15.115 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.403-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>`,
  kilo: `<svg viewBox="0 0 24 24" fill="white" fill-rule="evenodd" xmlns="http://www.w3.org/2000/svg" style="width:22px;height:22px"><title>Kilo Code</title><path d="M0 0v24h24V0H0zm22.222 22.222H1.778V1.778h20.444v20.444zm-7.555-4.964h2.222v1.778h-2.794L12.89 17.83v-2.794h1.778v2.222zm4 0h-1.778v-2.222h-2.222v-1.778h2.793l1.207 1.207v2.793zm-7.556-2.591H9.333v-1.778h1.778v1.778zm-5.778-1.778h1.778v4h4v1.778H6.54L5.333 17.46V12.89zm13.334-3.556v1.778h-5.778V9.333h1.987V7.111h-1.987V5.333h2.558l1.206 1.207v2.793h2.014zm-11.556-2h2.222l1.778 1.778v2H9.333v-2H7.111v2H5.333V5.333h1.778v2zm4 0H9.333v-2h1.778v2z"/></svg>`,
  xai: `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg" style="width:20px;height:20px"><path d="M6.469 8.776L16.512 23h-4.464L2.005 8.776H6.47zm-.004 7.9l2.233 3.164L6.467 23H2l4.465-6.324zM22 2.582V23h-3.659V7.764L22 2.582zM22 1l-9.952 14.095-2.233-3.163L17.533 1H22z"/></svg>`,
};

const PROVIDER_LOGO_URLS = {
  zen: 'https://opencode.ai/favicon.ico',
  go: 'https://opencode.ai/favicon.ico',
  anthropic: 'https://cdn.simpleicons.org/anthropic/ffffff',
  google: 'https://cdn.simpleicons.org/google/ffffff',
  nvidia: 'https://cdn.simpleicons.org/nvidia/ffffff',
  deepseek: 'https://cdn.simpleicons.org/deepseek/ffffff',
  mistral: 'https://cdn.simpleicons.org/mistralai/ffffff',
  ollama: 'https://cdn.simpleicons.org/ollama/ffffff',
  openrouter: 'https://cdn.simpleicons.org/openrouter/ffffff',
  perplexity: 'https://cdn.simpleicons.org/perplexity/ffffff',
  huggingface: 'https://cdn.simpleicons.org/huggingface/ffffff',
  cloudflare: 'https://cdn.simpleicons.org/cloudflare/ffffff',
  azure: 'https://cdn.simpleicons.org/microsoftazure/ffffff',
  vertex: 'https://cdn.simpleicons.org/googlecloud/ffffff',
  bedrock: 'https://cdn.simpleicons.org/amazonaws/ffffff',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getProviderLogoContent(providerId) {
  const base = providerId.replace(/-oauth$/, '').replace(/-api$/, '');
  const svg = PROVIDER_INLINE_SVGS[providerId] ?? PROVIDER_INLINE_SVGS[base];
  if (svg) return { type: 'svg', content: svg };
  const url = PROVIDER_LOGO_URLS[providerId] ?? PROVIDER_LOGO_URLS[base];
  if (url) return { type: 'img', content: url };
  return null;
}

export function providerInitial(name) {
  return (name || '?').replace(/[^a-zA-Z0-9]/g, '').charAt(0).toUpperCase() || '?';
}

export function providerLogoHtml(providerId, displayName) {
  const initial = providerInitial(displayName);
  const logo = getProviderLogoContent(providerId);
  if (logo?.type === 'svg') return logo.content;
  if (logo?.type === 'img') {
    return `<img src="${logo.content}" class="provider-logo-img" alt="${escapeHtml(displayName)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="provider-logo-fallback" style="display:none">${initial}</span>`;
  }
  return initial;
}
