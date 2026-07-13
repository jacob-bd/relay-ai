// ─── State ───────────────────────────────────────────────────────────────────

const AGY_MAX = 6;
const GENERAL_MAX = 20;

const state = {
  providers: [],
  templates: [],   // unconfigured available templates
  allModels: [],
  generalFavorites: [],
  agyFavorites: [],
  modelsLoaded: false,
  modelsError: null,
  providerFilter: '',
  modelFilter: '',
  modelFreeOnly: false,
  agyFilter: '',
  agyFreeOnly: false,
  appModelFilter: '',
  appFreeOnly: false,
  providerNameMap: {}, // providerId → full display name
  recentLaunchFolders: [],
  appLaunchFolders: {},
  appModelFilters: {},
  appModelOpen: null,
  appSelections: {},
  server: {
    status: null,
    error: null,
    starting: false,
    form: {
      seeded: false,
      mode: 'gateway',           // 'gateway' | 'http-proxy'
      expose: 'favorites',        // 'favorites' | 'specific'
      exposedProviders: [],
      freeModelsOnly: false,
      providerSearch: '',
      providersList: [],
      providersLoaded: false,
      maskGatewayIds: true,
      listenMode: 'local',        // 'local' | 'network'
      passwordMode: 'new',        // 'saved' | 'new'
      password: '',
      savePassword: false,
    },
  },
};

// ─── Provider logos via Simple Icons CDN ─────────────────────────────────────
// https://simpleicons.org — monochrome SVG brand marks, white on dark bg.
// Format: https://cdn.simpleicons.org/{slug}/ffffff

// Inline SVGs for providers whose official domains block hotlinking.
// White fill, renders on gradient background.
const PROVIDER_INLINE_SVGS = {
  openai: `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg" style="width:20px;height:20px"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.896zm16.597 3.855l-5.843-3.368L15.115 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.403-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>`,
  kilo: `<svg viewBox="0 0 24 24" fill="white" fill-rule="evenodd" xmlns="http://www.w3.org/2000/svg" style="width:22px;height:22px"><title>Kilo Code</title><path d="M0 0v24h24V0H0zm22.222 22.222H1.778V1.778h20.444v20.444zm-7.555-4.964h2.222v1.778h-2.794L12.89 17.83v-2.794h1.778v2.222zm4 0h-1.778v-2.222h-2.222v-1.778h2.793l1.207 1.207v2.793zm-7.556-2.591H9.333v-1.778h1.778v1.778zm-5.778-1.778h1.778v4h4v1.778H6.54L5.333 17.46V12.89zm13.334-3.556v1.778h-5.778V9.333h1.987V7.111h-1.987V5.333h2.558l1.206 1.207v2.793h2.014zm-11.556-2h2.222l1.778 1.778v2H9.333v-2H7.111v2H5.333V5.333h1.778v2zm4 0H9.333v-2h1.778v2z"/></svg>`,
  xai: `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg" style="width:20px;height:20px"><path d="M6.469 8.776L16.512 23h-4.464L2.005 8.776H6.47zm-.004 7.9l2.233 3.164L6.467 23H2l4.465-6.324zM22 2.582V23h-3.659V7.764L22 2.582zM22 1l-9.952 14.095-2.233-3.163L17.533 1H22z"/></svg>`,
  'xai-oauth': `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg" style="width:20px;height:20px"><path d="M6.469 8.776L16.512 23h-4.464L2.005 8.776H6.47zm-.004 7.9l2.233 3.164L6.467 23H2l4.465-6.324zM22 2.582V23h-3.659V7.764L22 2.582zM22 1l-9.952 14.095-2.233-3.163L17.533 1H22z"/></svg>`,
};

// Verified working logo URLs. Slugs tested against cdn.simpleicons.org — 404s removed.
// Missing: openai, groq, cohere, togetherai, fireworks, cerebras → inline SVG or gradient letter fallback.
const PROVIDER_LOGO_URLS = {
  // OpenCode — official favicon (proper square icon)
  zen:            'https://opencode.ai/favicon.ico',
  go:             'https://opencode.ai/favicon.ico',
  // Verified Simple Icons slugs (200 responses confirmed)
  anthropic:    'https://cdn.simpleicons.org/anthropic/ffffff',
  google:       'https://cdn.simpleicons.org/google/ffffff',
  nvidia:       'https://cdn.simpleicons.org/nvidia/ffffff',
  deepseek:     'https://cdn.simpleicons.org/deepseek/ffffff',
  mistral:      'https://cdn.simpleicons.org/mistralai/ffffff',
  ollama:       'https://cdn.simpleicons.org/ollama/ffffff',
  openrouter:   'https://cdn.simpleicons.org/openrouter/ffffff',
  perplexity:   'https://cdn.simpleicons.org/perplexity/ffffff',
  huggingface:  'https://cdn.simpleicons.org/huggingface/ffffff',
  cloudflare:   'https://cdn.simpleicons.org/cloudflare/ffffff',
  azure:        'https://cdn.simpleicons.org/microsoftazure/ffffff',
  vertex:       'https://cdn.simpleicons.org/googlecloud/ffffff',
  bedrock:      'https://cdn.simpleicons.org/amazonaws/ffffff',
  // xai / xai-oauth → inline SVG in PROVIDER_INLINE_SVGS
  // openai, groq, cohere, togetherai, fireworks, cerebras → no verified slug, use gradient letter
};

function getProviderLogoContent(providerId) {
  const base = providerId.replace(/-oauth$/, '').replace(/-api$/, '');
  // Inline SVG takes priority (for providers that block hotlinking)
  const svg = PROVIDER_INLINE_SVGS[providerId] ?? PROVIDER_INLINE_SVGS[base];
  if (svg) return { type: 'svg', content: svg };
  const url = PROVIDER_LOGO_URLS[providerId] ?? PROVIDER_LOGO_URLS[base];
  if (url) return { type: 'img', content: url };
  return null;
}

// ─── Neon model colors (unique per model ID) ──────────────────────────────────

const NEONS = [
  { color: 'oklch(75% 0.32 255)',  bg: 'oklch(75% 0.32 255 / 0.12)',  border: 'oklch(75% 0.32 255 / 0.35)' },  // electric blue
  { color: 'oklch(72% 0.30 320)',  bg: 'oklch(72% 0.30 320 / 0.12)',  border: 'oklch(72% 0.30 320 / 0.35)' },  // hot pink
  { color: 'oklch(78% 0.28 155)',  bg: 'oklch(78% 0.28 155 / 0.12)',  border: 'oklch(78% 0.28 155 / 0.35)' },  // neon green
  { color: 'oklch(80% 0.26 85)',   bg: 'oklch(80% 0.26 85  / 0.12)',  border: 'oklch(80% 0.26 85  / 0.35)' },  // vivid amber
  { color: 'oklch(76% 0.30 195)',  bg: 'oklch(76% 0.30 195 / 0.12)',  border: 'oklch(76% 0.30 195 / 0.35)' },  // electric cyan
  { color: 'oklch(70% 0.30 285)',  bg: 'oklch(70% 0.30 285 / 0.12)',  border: 'oklch(70% 0.30 285 / 0.35)' },  // electric purple
  { color: 'oklch(82% 0.24 55)',   bg: 'oklch(82% 0.24 55  / 0.12)',  border: 'oklch(82% 0.24 55  / 0.35)' },  // vivid orange
  { color: 'oklch(73% 0.30 340)',  bg: 'oklch(73% 0.30 340 / 0.12)',  border: 'oklch(73% 0.30 340 / 0.35)' },  // hot magenta
  { color: 'oklch(79% 0.28 130)',  bg: 'oklch(79% 0.28 130 / 0.12)',  border: 'oklch(79% 0.28 130 / 0.35)' },  // lime green
  { color: 'oklch(74% 0.28 225)',  bg: 'oklch(74% 0.28 225 / 0.12)',  border: 'oklch(74% 0.28 225 / 0.35)' },  // sky blue
  { color: 'oklch(76% 0.28 15)',   bg: 'oklch(76% 0.28 15  / 0.12)',  border: 'oklch(76% 0.28 15  / 0.35)' },  // coral red
  { color: 'oklch(77% 0.28 175)',  bg: 'oklch(77% 0.28 175 / 0.12)',  border: 'oklch(77% 0.28 175 / 0.35)' },  // emerald
  { color: 'oklch(74% 0.30 265)',  bg: 'oklch(74% 0.30 265 / 0.12)',  border: 'oklch(74% 0.30 265 / 0.35)' },  // indigo
  { color: 'oklch(81% 0.26 70)',   bg: 'oklch(81% 0.26 70  / 0.12)',  border: 'oklch(81% 0.26 70  / 0.35)' },  // golden
];

function modelNeon(modelId) {
  let hash = 0;
  for (let i = 0; i < modelId.length; i++) hash = (hash * 31 + modelId.charCodeAt(i)) | 0;
  return NEONS[Math.abs(hash) % NEONS.length];
}

function getProviderName(providerId) {
  return state.providerNameMap[providerId] ?? providerId;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function modelChoiceValue(providerId, modelId) {
  return `${encodeURIComponent(providerId)}::${encodeURIComponent(modelId)}`;
}

function parseModelChoiceValue(value) {
  const idx = value.indexOf('::');
  if (idx < 0) return null;
  return {
    providerId: decodeURIComponent(value.slice(0, idx)),
    modelId: decodeURIComponent(value.slice(idx + 2)),
  };
}

function isGeneralFavorite(providerId, modelId) {
  return state.generalFavorites.some(f => f.providerId === providerId && f.modelId === modelId);
}

function appIconInitial(app) {
  const explicit = {
    claude: 'C',
    codex: 'X',
    gemini: 'G',
    agy: 'A',
    antigravity: 'A',
    'antigravity-ide': 'A',
    'claude-app': 'C',
    'codex-app': 'X',
  };
  return explicit[app.id] ?? providerInitial(app.name);
}

// ─── App icons ───────────────────────────────────────────────────────────────
// Inline SVGs for small/clean icons; IMG paths for rasterized large icons.
const APP_ICON_SVGS = {
  claude: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width:65%;height:65%"><path clip-rule="evenodd" d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z" fill="white" fill-rule="evenodd"/></svg>`,
  codex: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="width:65%;height:65%" fill-rule="evenodd"><path clip-rule="evenodd" d="M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z" fill="white"/></svg>`,
  gemini: `<svg viewBox="0 0 24 24" style="width:100%;height:100%" xmlns="http://www.w3.org/2000/svg"><path d="M0 4.391A4.391 4.391 0 014.391 0h15.217A4.391 4.391 0 0124 4.391v15.217A4.391 4.391 0 0119.608 24H4.391A4.391 4.391 0 010 19.608V4.391z" fill="url(#gem-grad)"/><path clip-rule="evenodd" d="M19.74 1.444a2.816 2.816 0 012.816 2.816v15.48a2.816 2.816 0 01-2.816 2.816H4.26a2.816 2.816 0 01-2.816-2.816V4.26A2.816 2.816 0 014.26 1.444h15.48zM7.236 8.564l7.752 3.728-7.752 3.727v2.802l9.557-4.596v-3.866L7.236 5.763v2.801z" fill="#1E1E2E" fill-rule="evenodd"/><defs><linearGradient gradientUnits="userSpaceOnUse" id="gem-grad" x1="24" x2="0" y1="6.587" y2="16.494"><stop stop-color="#EE4D5D"/><stop offset=".328" stop-color="#B381DD"/><stop offset=".476" stop-color="#207CFE"/></linearGradient></defs></svg>`,
  agy: `<svg fill="white" fill-rule="evenodd" viewBox="0 0 24 24" style="width:65%;height:65%" xmlns="http://www.w3.org/2000/svg"><path d="M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z"/></svg>`,
  'codex-app': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="width:65%;height:65%" fill-rule="evenodd"><path clip-rule="evenodd" d="M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z" fill="white"/></svg>`,
  'claude-app': `<svg xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision" text-rendering="geometricPrecision" image-rendering="optimizeQuality" fill-rule="evenodd" clip-rule="evenodd" viewBox="0 0 512 509.64" style="width:100%;height:100%"><path fill="#D77655" d="M115.612 0h280.775C459.974 0 512 52.026 512 115.612v278.415c0 63.587-52.026 115.612-115.613 115.612H115.612C52.026 509.639 0 457.614 0 394.027V115.612C0 52.026 52.026 0 115.612 0z"/><path fill="#FCF2EE" fill-rule="nonzero" d="M142.27 316.619l73.655-41.326 1.238-3.589-1.238-1.996-3.589-.001-12.31-.759-42.084-1.138-36.498-1.516-35.361-1.896-8.897-1.895-8.34-10.995.859-5.484 7.482-5.03 10.717.935 23.683 1.617 35.537 2.452 25.782 1.517 38.193 3.968h6.064l.86-2.451-2.073-1.517-1.618-1.517-36.776-24.922-39.81-26.338-20.852-15.166-11.273-7.683-5.687-7.204-2.451-15.721 10.237-11.273 13.75.935 3.513.936 13.928 10.716 29.749 23.027 38.848 28.612 5.687 4.727 2.275-1.617.278-1.138-2.553-4.271-21.13-38.193-22.546-38.848-10.035-16.101-2.654-9.655c-.935-3.968-1.617-7.304-1.617-11.374l11.652-15.823 6.445-2.073 15.545 2.073 6.547 5.687 9.655 22.092 15.646 34.78 24.265 47.291 7.103 14.028 3.791 12.992 1.416 3.968 2.449-.001v-2.275l1.997-26.641 3.69-32.707 3.589-42.084 1.239-11.854 5.863-14.206 11.652-7.683 9.099 4.348 7.482 10.716-1.036 6.926-4.449 28.915-8.72 45.294-5.687 30.331h3.313l3.792-3.791 15.342-20.372 25.782-32.227 11.374-12.789 13.27-14.129 8.517-6.724 16.1-.001 11.854 17.617-5.307 18.199-16.581 21.029-13.75 17.819-19.716 26.54-12.309 21.231 1.138 1.694 2.932-.278 44.536-9.479 24.062-4.347 28.714-4.928 12.992 6.066 1.416 6.167-5.106 12.613-30.71 7.583-36.018 7.204-53.636 12.689-.657.48.758.935 24.164 2.275 10.337.556h25.301l47.114 3.514 12.309 8.139 7.381 9.959-1.238 7.583-18.957 9.655-25.579-6.066-59.702-14.205-20.474-5.106-2.83-.001v1.694l17.061 16.682 31.266 28.233 39.152 36.397 1.997 8.999-5.03 7.102-5.307-.758-34.401-25.883-13.27-11.651-30.053-25.302-1.996-.001v2.654l6.926 10.136 36.574 54.975 1.895 16.859-2.653 5.485-9.479 3.311-10.414-1.895-21.408-30.054-22.092-33.844-17.819-30.331-2.173 1.238-10.515 113.261-4.929 5.788-11.374 4.348-9.478-7.204-5.03-11.652 5.03-23.027 6.066-30.052 4.928-23.886 4.449-29.674 2.654-9.858-.177-.657-2.173.278-22.37 30.71-34.021 45.977-26.919 28.815-6.445 2.553-11.173-5.789 1.037-10.337 6.243-9.2 37.257-47.392 22.47-29.371 14.508-16.961-.101-2.451h-.859l-98.954 64.251-17.618 2.275-7.583-7.103.936-11.652 3.589-3.791 29.749-20.474-.101.102.024.101z"/></svg>`,
};
const APP_ICON_IMGS = {
  antigravity: 'icon-antigravity.png',
  'antigravity-ide': 'icon-antigravity-ide.png',
};

function getAppIconHtml(app, fallbackInitial) {
  const svg = APP_ICON_SVGS[app.id];
  if (svg) return svg;
  const img = APP_ICON_IMGS[app.id];
  if (img) return `<img src="${img}" style="width:100%;height:100%;object-fit:contain;border-radius:inherit;" alt="${app.name}" onerror="this.style.display='none'">`;
  return `<span class="provider-logo-fallback">${fallbackInitial}</span>`;
}

// ─── Provider icon palettes ──────────────────────────────────────────────────

const PALETTES = [
  ['oklch(65% 0.28 255)', 'oklch(60% 0.26 285)'],  // indigo→purple
  ['oklch(68% 0.24 175)', 'oklch(62% 0.26 215)'],  // teal→blue
  ['oklch(70% 0.22 25)',  'oklch(65% 0.26 350)'],  // orange→pink
  ['oklch(68% 0.24 145)', 'oklch(62% 0.26 175)'],  // green→teal
  ['oklch(72% 0.22 85)',  'oklch(65% 0.26 55)'],   // amber→orange
  ['oklch(68% 0.26 315)', 'oklch(62% 0.28 285)'],  // pink→purple
  ['oklch(65% 0.26 195)', 'oklch(60% 0.26 225)'],  // sky→indigo
];

function providerPalette(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return PALETTES[Math.abs(hash) % PALETTES.length];
}

function providerInitial(name) {
  return (name || '?').replace(/[^a-zA-Z0-9]/g, '').charAt(0).toUpperCase() || '?';
}

// ─── API ─────────────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  return (await fetch(path, opts)).json();
}

async function loadConfig() {
  const data = await api('GET', '/api/config');
  state.generalFavorites = data.favoriteModels ?? [];
  state.agyFavorites = data.antigravityCliFavoriteModels ?? [];
}

async function loadTemplates() {
  const data = await api('GET', '/api/providers/templates');
  state.templates = data.templates ?? [];
}

async function loadModels() {
  const data = await api('GET', '/api/models');
  if (data.error) throw new Error(data.error);
  state.providers = data.providers ?? [];
  const flat = [];

  for (const p of state.providers) {
    state.providerNameMap[p.id] = p.name;
    const favoriteProviderName = p.favoriteName ?? p.name;
    for (const m of p.models ?? []) flat.push({
      id: m.id,
      name: m.name,
      providerId: p.id,
      providerName: favoriteProviderName,
      contextWindow: m.contextWindow ?? null,
      isFree: Boolean(m.isFree),
      freeStatus: m.freeStatus,
      freeLabel: m.freeLabel,
      cost: m.cost,
    });
    if (typeof p.modelCount === 'number') p._rawCount = p.modelCount;
  }

  // Disambiguate API-key providers that share a first-word name with an OAuth sibling.
  // e.g. "OpenAI (ChatGPT)" (oauth) + "OpenAI" (api) → "OpenAI (API)"
  //      "xAI Grok (SuperGrok)" (oauth) + "xAI" (api) → "xAI (API)"
  const oauthFirstWords = new Set(
    state.providers
      .filter(p => p.authType === 'oauth')
      .map(p => p.name.split(' ')[0].toLowerCase()),
  );
  for (const p of state.providers) {
    if (p.authType !== 'oauth') {
      const firstWord = p.name.split(' ')[0].toLowerCase();
      if (oauthFirstWords.has(firstWord)) {
        state.providerNameMap[p.id] = p.name + ' (API)';
      }
    }
  }
  state.allModels = flat;
}

async function saveFavorites(payload) { return api('POST', '/api/config', payload); }
async function saveKey(providerId, key) { return api('POST', '/api/keys', { providerId, key }); }
async function refreshProvider(providerId) { return api('POST', '/api/providers/refresh', { providerId }); }

// ─── Toast ────────────────────────────────────────────────────────────────────

function showToast(msg, undoFn) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';

  const span = document.createElement('span');
  span.className = 'toast-msg';
  span.textContent = msg;
  toast.appendChild(span);

  let dismissed = false;

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    toast.classList.add('out');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }

  if (undoFn) {
    const btn = document.createElement('button');
    btn.className = 'btn-undo';
    btn.textContent = 'Undo';
    btn.addEventListener('click', () => { dismiss(); undoFn(); });
    toast.appendChild(btn);
    setTimeout(() => { if (!dismissed) { const b = toast.querySelector('.btn-undo'); if (b) b.style.opacity = '0.3'; } }, 4000);
    setTimeout(dismiss, 5500);
  } else {
    setTimeout(dismiss, 2200);
  }

  container.appendChild(toast);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function fmtCtx(n) {
  if (!n) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function isFreeModel(model) {
  return Boolean(model?.isFree || model?.freeStatus === 'verified_free' || model?.freeStatus === 'free_provider');
}

function freeBadgeLabel(model) {
  if (model?.freeStatus === 'free_provider') return 'Free dev access';
  return model?.freeLabel || 'Free';
}

// ─── Providers ────────────────────────────────────────────────────────────────

function renderProviders() {
  const list = document.getElementById('providers-list');
  const availSection = document.getElementById('available-providers-section');
  const availList = document.getElementById('available-providers-list');
  const filter = state.providerFilter.toLowerCase();

  const visibleConfigured = state.providers.filter(p => {
    const displayName = getProviderName(p.id);
    return !filter || displayName.toLowerCase().includes(filter) || p.id.toLowerCase().includes(filter);
  });
  const visibleTemplates = state.templates.filter(t =>
    !filter || t.name.toLowerCase().includes(filter) || t.id.toLowerCase().includes(filter)
  );

  list.innerHTML = '';

  if (!state.modelsLoaded) {
    for (let i = 0; i < 5; i++) {
      const sk = document.createElement('div');
      sk.className = 'skeleton skeleton-card';
      list.appendChild(sk);
    }
    availSection.hidden = true;
    return;
  }

  if (visibleConfigured.length === 0 && visibleTemplates.length === 0) {
    list.innerHTML = '<div class="fav-empty">No providers match your search.</div>';
    availSection.hidden = true;
    return;
  }

  if (visibleConfigured.length === 0) {
    list.innerHTML = '<div class="fav-empty">No configured providers match.</div>';
  } else {
    for (const p of visibleConfigured) list.appendChild(buildProviderCard(p));
  }

  if (visibleTemplates.length > 0) {
    availSection.hidden = false;
    availList.innerHTML = '';
    for (const t of visibleTemplates) availList.appendChild(buildTemplateCard(t));
  } else {
    availSection.hidden = true;
  }
}

function buildProviderCard(provider) {
  const [c1, c2] = providerPalette(provider.id);
  const displayName = getProviderName(provider.id);
  const initial = providerInitial(displayName);
  const logo = getProviderLogoContent(provider.id);
  const card = document.createElement('div');
  card.className = 'provider-card';
  card.dataset.id = provider.id;

  const header = document.createElement('div');
  header.className = 'provider-card-header';
  header.setAttribute('role', 'button');
  header.setAttribute('tabindex', '0');
  header.setAttribute('aria-expanded', 'false');

  const logoHtml = logo?.type === 'svg'
    ? logo.content
    : logo?.type === 'img'
      ? `<img src="${logo.content}" class="provider-logo-img" alt="${escapeHtml(displayName)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="provider-logo-fallback" style="display:none">${initial}</span>`
      : initial;

  header.innerHTML = `
    <div class="provider-icon" style="background:linear-gradient(135deg,${c1},${c2})">${logoHtml}</div>
    <div class="provider-info">
      <div class="provider-name">${escapeHtml(displayName)}</div>
      <div class="provider-models-count">${provider.modelCount ?? provider.models?.length ?? 0} models</div>
    </div>
    <div class="provider-status">
      <span class="status-chip ${provider.hasKey ? 'has-key' : provider.freeAccess ? 'free-access' : 'no-key'}">
        ${provider.hasKey ? 'Key stored' : provider.freeAccess ? 'Free models' : 'Not configured'}
      </span>
      <svg class="provider-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </div>
  `;

  const body = document.createElement('div');
  body.className = 'provider-body';
  body.setAttribute('aria-hidden', 'true');

  const inner = document.createElement('div');
  inner.className = 'provider-body-inner';
  inner.appendChild(buildProviderBodyContent(provider));
  body.appendChild(inner);

  function toggle() {
    const isOpen = card.classList.toggle('open');
    header.setAttribute('aria-expanded', String(isOpen));
    body.setAttribute('aria-hidden', String(!isOpen));
  }

  header.addEventListener('click', toggle);
  header.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

function buildTemplateCard(template) {
  const [c1, c2] = providerPalette(template.id);
  const initial = providerInitial(template.name);
  const logo = getProviderLogoContent(template.id);
  const logoHtml = logo?.type === 'svg'
    ? logo.content
    : logo?.type === 'img'
      ? `<img src="${logo.content}" class="provider-logo-img" alt="${template.name}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="provider-logo-fallback" style="display:none">${initial}</span>`
      : initial;
  const card = document.createElement('div');
  card.className = 'provider-card';
  card.dataset.id = template.id;

  const header = document.createElement('div');
  header.className = 'provider-card-header';
  header.setAttribute('role', 'button');
  header.setAttribute('tabindex', '0');
  header.setAttribute('aria-expanded', 'false');

  const signupLink = template.signupUrl
    ? `<a class="template-signup-link" href="${template.signupUrl}" target="_blank" rel="noopener">${template.authType === 'oauth' ? 'Learn more ↗' : 'Get API key ↗'}</a>`
    : '';

  header.innerHTML = `
    <div class="provider-icon" style="background:linear-gradient(135deg,${c1},${c2})">${logoHtml}</div>
    <div class="provider-info">
      <div class="provider-name">${template.name}</div>
      <div class="provider-models-count">Not configured ${signupLink}</div>
    </div>
    <div class="provider-status">
      <span class="status-chip no-key">Add provider</span>
      <svg class="provider-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </div>
  `;

  const body = document.createElement('div');
  body.className = 'provider-body';
  body.setAttribute('aria-hidden', 'true');

  const inner = document.createElement('div');
  inner.className = 'provider-body-inner';
  inner.appendChild(buildTemplateBodyContent(template, card));
  body.appendChild(inner);

  function toggle() {
    const isOpen = card.classList.toggle('open');
    header.setAttribute('aria-expanded', String(isOpen));
    body.setAttribute('aria-hidden', String(!isOpen));
  }

  header.addEventListener('click', toggle);
  header.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

function buildCustomEndpointBodyContent(template, card) {
  const kind = template.id === '__custom_anthropic__' ? 'anthropic' : 'openai';
  const isAnthropicKind = kind === 'anthropic';

  const content = document.createElement('div');
  content.className = 'provider-body-content';

  function row(label, input) {
    const wrap = document.createElement('div');
    wrap.className = 'key-row';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '4px';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.style.cssText = 'font-size:12px;color:var(--text-muted,#aaa);display:block';
    wrap.appendChild(lbl);
    wrap.appendChild(input);
    return wrap;
  }

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'key-input';
  nameInput.placeholder = isAnthropicKind ? 'e.g. My LiteLLM Proxy' : 'e.g. Local Ollama';
  nameInput.autocomplete = 'off';

  const urlInput = document.createElement('input');
  urlInput.type = 'url';
  urlInput.className = 'key-input';
  urlInput.placeholder = isAnthropicKind ? 'https://my-proxy.example.com/v1' : 'http://localhost:11434/v1';
  urlInput.autocomplete = 'off';

  const keyInput = document.createElement('input');
  keyInput.type = 'password';
  keyInput.className = 'key-input';
  keyInput.placeholder = isAnthropicKind ? 'API key (required)' : 'API key (leave blank if not needed)';
  keyInput.autocomplete = 'off';

  const headersInput = document.createElement('textarea');
  headersInput.className = 'key-input';
  headersInput.rows = 2;
  headersInput.placeholder = 'Optional custom headers, one per line\nX-Plan: coding';
  headersInput.autocomplete = 'off';

  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-primary';
  addBtn.textContent = 'Add Provider';
  addBtn.style.marginTop = '4px';

  const feedback = document.createElement('div');
  feedback.className = 'key-feedback';

  content.appendChild(row('Provider name', nameInput));
  content.appendChild(row('Base URL', urlInput));
  content.appendChild(row('API key', keyInput));
  content.appendChild(row('Custom headers (optional)', headersInput));
  content.appendChild(addBtn);
  content.appendChild(feedback);

  function parseHeaders(text) {
    const headers = {};
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf(':');
      if (idx < 1) continue;
      const name = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (name) headers[name] = value;
    }
    return headers;
  }

  addBtn.addEventListener('click', async () => {
    const displayName = nameInput.value.trim();
    const baseUrl = urlInput.value.trim();
    const apiKey = keyInput.value.trim();
    const headers = parseHeaders(headersInput.value);

    if (!displayName) { feedback.textContent = 'Enter a provider name.'; feedback.className = 'key-feedback error'; return; }
    if (!baseUrl) { feedback.textContent = 'Enter a base URL.'; feedback.className = 'key-feedback error'; return; }
    if (isAnthropicKind && !apiKey) { feedback.textContent = 'API key is required for Anthropic-compatible providers.'; feedback.className = 'key-feedback error'; return; }

    addBtn.disabled = true;
    feedback.textContent = 'Connecting and fetching models…';
    feedback.className = 'key-feedback muted';

    const result = await api('POST', '/api/providers/add-custom', { kind, displayName, baseUrl, apiKey, headers });

    addBtn.disabled = false;
    if (result.ok) {
      feedback.textContent = `✓ ${displayName} added · ${result.count} models available`;
      feedback.className = 'key-feedback success';
      nameInput.value = '';
      urlInput.value = '';
      keyInput.value = '';
      headersInput.value = '';
      state.modelsLoaded = false;
      await loadTemplates();
      await initModels();
      renderProviders();
      showToast(`${displayName} added successfully`);
    } else {
      feedback.textContent = result.error ?? 'Failed to add provider';
      if (result.hint) feedback.textContent += ` — ${result.hint}`;
      feedback.className = 'key-feedback error';
    }
  });

  return content;
}

function buildOAuthTemplateBodyContent(template) {
  const content = document.createElement('div');
  content.className = 'provider-body-content';

  const note = document.createElement('div');
  note.style.cssText = 'font-size:13px;color:var(--text-secondary,#aaa);margin-bottom:10px';
  note.textContent = 'Sign in via device code — no API key required.';

  const actionRow = document.createElement('div');
  actionRow.className = 'key-row';

  const signInBtn = document.createElement('button');
  signInBtn.className = 'btn btn-primary';
  signInBtn.textContent = 'Sign in';

  const feedback = document.createElement('div');
  feedback.className = 'key-feedback';

  actionRow.appendChild(signInBtn);
  content.appendChild(note);
  content.appendChild(actionRow);
  content.appendChild(feedback);

  let pollInterval = null;
  function stopPolling() { if (pollInterval) { clearInterval(pollInterval); pollInterval = null; } }

  signInBtn.addEventListener('click', async () => {
    stopPolling();
    signInBtn.disabled = true;
    feedback.textContent = 'Starting authorization…';
    feedback.className = 'key-feedback muted';

    const startResult = await api('POST', '/api/providers/oauth/start', { providerId: template.id });
    if (startResult.error) {
      feedback.textContent = startResult.error;
      feedback.className = 'key-feedback error';
      signInBtn.disabled = false;
      return;
    }

    const { sessionId } = startResult;
    if (startResult.pkce) {
      // PKCE / browser-redirect flow — open auth URL, poll for completion.
      const { authUrl } = startResult;
      window.open(authUrl, '_blank');
      feedback.innerHTML = `Browser opened for authorization.<br>
        <span style="opacity:0.6;font-size:12px">Complete sign-in in the browser window, then return here…</span>`;
      feedback.className = 'key-feedback muted';
    } else {
      // Device code flow — show URL and code.
      const { url, userCode } = startResult;
      window.open(url, '_blank');
      feedback.innerHTML = `Go to <a href="${url}" target="_blank" style="color:inherit">${url}</a><br>
        Enter code: <strong style="letter-spacing:0.1em;font-size:15px">${userCode}</strong><br>
        <span style="opacity:0.6;font-size:12px">Waiting for authorization…</span>`;
      feedback.className = 'key-feedback muted';
    }

    pollInterval = setInterval(async () => {
      const statusResult = await api('GET', `/api/providers/oauth/status?sessionId=${encodeURIComponent(sessionId)}`);
      if (statusResult.status === 'done') {
        stopPolling();
        feedback.textContent = '✓ Signed in — provider added';
        feedback.className = 'key-feedback success';
        showToast(`${template.name} added`);
        state.modelsLoaded = false;
        await loadTemplates();
        await initModels();
        renderProviders();
      } else if (statusResult.status === 'error') {
        stopPolling();
        feedback.textContent = statusResult.error ?? 'Authorization failed';
        feedback.className = 'key-feedback error';
        signInBtn.disabled = false;
      } else if (statusResult.error) {
        stopPolling();
        feedback.textContent = 'Session expired — please try again';
        feedback.className = 'key-feedback error';
        signInBtn.disabled = false;
      }
    }, 3000);
  });

  return content;
}

function buildTemplateBodyContent(template, card) {
  const isCustom = template.id === '__custom_openai__' || template.id === '__custom_anthropic__';
  if (isCustom) return buildCustomEndpointBodyContent(template, card);
  if (template.authType === 'oauth') return buildOAuthTemplateBodyContent(template, card);

  const content = document.createElement('div');
  content.className = 'provider-body-content';

  let urlInput = null;
  if (template.urlPrompt) {
    const urlLabel = document.createElement('label');
    urlLabel.textContent = template.urlPrompt;
    urlLabel.style.cssText = 'font-size:12px;color:var(--text-muted,#aaa);display:block;margin-bottom:4px';
    content.appendChild(urlLabel);

    urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.className = 'key-input';
    urlInput.placeholder = template.defaultBaseUrl || 'http://localhost:11434/v1';
    urlInput.value = template.defaultBaseUrl || '';
    urlInput.autocomplete = 'off';
    urlInput.style.marginBottom = '8px';
    content.appendChild(urlInput);
  }

  const keyRow = document.createElement('div');
  keyRow.className = 'key-row';

  const wrap = document.createElement('div');
  wrap.className = 'key-input-wrap';

  const input = document.createElement('input');
  input.type = 'password';
  input.className = 'key-input';
  input.placeholder = template.anonymousFreeModels
    ? 'Optional API key; leave empty for free models…'
    : template.apiKeyOptional
    ? 'API key (leave empty for local servers without auth)…'
    : 'Paste API key to add this provider…';
  input.autocomplete = 'off';

  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-primary';
  addBtn.textContent = 'Add Provider';

  const feedback = document.createElement('div');
  feedback.className = 'key-feedback';

  wrap.appendChild(input);
  keyRow.appendChild(wrap);
  keyRow.appendChild(addBtn);
  content.appendChild(keyRow);
  content.appendChild(feedback);

  addBtn.addEventListener('click', async () => {
    const key = input.value.trim();
    const baseUrl = urlInput ? urlInput.value.trim() : undefined;
    if (!key && !template.anonymousFreeModels && !template.apiKeyOptional) { feedback.textContent = 'Enter an API key first.'; feedback.className = 'key-feedback error'; return; }
    if (urlInput && !baseUrl) { feedback.textContent = 'Enter a base URL.'; feedback.className = 'key-feedback error'; return; }
    addBtn.disabled = true;
    feedback.textContent = key ? 'Validating key and fetching models…' : 'Fetching models…';
    feedback.className = 'key-feedback muted';

    const result = await api('POST', '/api/providers/add', { templateId: template.id, key, baseUrl });

    addBtn.disabled = false;
    if (result.ok) {
      feedback.textContent = `✓ ${template.name} added · ${result.count} models available`;
      feedback.className = 'key-feedback success';
      // Reload full catalog so the new provider appears in configured list
      state.modelsLoaded = false;
      await loadTemplates();
      await initModels();
      renderProviders();
      showToast(`${template.name} added successfully`);
    } else {
      feedback.textContent = result.error ?? 'Failed to add provider';
      if (result.hint) feedback.textContent += ` — ${result.hint}`;
      feedback.className = 'key-feedback error';
    }
  });

  return content;
}

function buildProviderBodyContent(provider) {
  if (provider.authType === 'oauth') return buildOAuthProviderBodyContent(provider);

  const content = document.createElement('div');
  content.className = 'provider-body-content';

  const keyRow = document.createElement('div');
  keyRow.className = 'key-row';

  const wrap = document.createElement('div');
  wrap.className = 'key-input-wrap';

  const input = document.createElement('input');
  input.type = 'password';
  input.className = 'key-input';
  input.placeholder = provider.hasKey ? '••••••••  (key already stored)' : provider.freeAccess ? 'Add API key for premium models…' : 'Paste API key…';
  input.autocomplete = 'off';

  const testBtn = document.createElement('button');
  testBtn.className = 'btn btn-primary';
  testBtn.textContent = 'Test & Refresh';

  const feedback = document.createElement('div');
  feedback.className = 'key-feedback';

  wrap.appendChild(input);
  keyRow.appendChild(wrap);
  keyRow.appendChild(testBtn);
  content.appendChild(keyRow);
  content.appendChild(feedback);

  async function doSave(key) {
    if (!key.trim()) return;
    const result = await saveKey(provider.id, key);
    if (result.ok) {
      feedback.textContent = '✓ Key saved to keychain';
      feedback.className = 'key-feedback success';
      provider.hasKey = true;
      const chip = document.querySelector(`[data-id="${CSS.escape(provider.id)}"] .status-chip`);
      if (chip) { chip.className = 'status-chip has-key'; chip.textContent = 'Key stored'; }
    } else {
      feedback.textContent = result.error ?? 'Failed to save key';
      feedback.className = 'key-feedback error';
    }
    setTimeout(() => { feedback.textContent = ''; feedback.className = 'key-feedback'; }, 3500);
  }

  input.addEventListener('blur', () => { if (input.value) doSave(input.value); });

  testBtn.addEventListener('click', async () => {
    if (input.value) await doSave(input.value);
    feedback.textContent = 'Refreshing…';
    feedback.className = 'key-feedback muted';
    testBtn.disabled = true;
    const result = await refreshProvider(provider.id);
    testBtn.disabled = false;
    if (result.ok) {
      feedback.textContent = `✓ ${result.count} models available`;
      feedback.className = 'key-feedback success';
      const countEl = document.querySelector(`[data-id="${CSS.escape(provider.id)}"] .provider-models-count`);
      if (countEl) countEl.textContent = `${result.count} models`;
      provider.modelCount = result.count;
    } else {
      feedback.textContent = result.error ?? 'Refresh failed';
      feedback.className = 'key-feedback error';
    }
    setTimeout(() => { feedback.textContent = ''; feedback.className = 'key-feedback'; }, 4000);
  });

  content.appendChild(buildDeleteProviderRow(provider));
  return content;
}

function buildDeleteProviderRow(provider) {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px solid oklch(22% 0.015 265)';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn btn-ghost';
  deleteBtn.style.cssText = 'color:oklch(65% 0.22 25);border-color:oklch(65% 0.22 25 / 0.4)';
  deleteBtn.textContent = 'Delete Provider';

  const confirmPanel = document.createElement('div');
  confirmPanel.style.cssText = 'display:none;align-items:center;gap:10px;flex-wrap:wrap';

  const confirmMsg = document.createElement('span');
  confirmMsg.style.cssText = 'font-size:13px;color:oklch(65% 0.22 25);flex:1;min-width:160px';
  confirmMsg.textContent = `Remove ${provider.name ?? provider.id}? This cannot be undone.`;

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-ghost';
  cancelBtn.textContent = 'Cancel';

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'btn btn-primary';
  confirmBtn.style.background = 'oklch(65% 0.22 25)';
  confirmBtn.textContent = 'Yes, Delete';

  confirmPanel.appendChild(confirmMsg);
  confirmPanel.appendChild(cancelBtn);
  confirmPanel.appendChild(confirmBtn);

  wrapper.appendChild(deleteBtn);
  wrapper.appendChild(confirmPanel);

  deleteBtn.addEventListener('click', () => {
    deleteBtn.style.display = 'none';
    confirmPanel.style.display = 'flex';
  });

  cancelBtn.addEventListener('click', () => {
    confirmPanel.style.display = 'none';
    deleteBtn.style.display = '';
  });

  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    const result = await api('POST', '/api/providers/delete', { providerId: provider.id });
    if (result.ok) {
      showToast(`${result.name ?? provider.id} removed`);
      state.modelsLoaded = false;
      await loadTemplates();
      await initModels();
      renderProviders();
    } else {
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
      confirmPanel.style.display = 'none';
      deleteBtn.style.display = '';
      showToast(result.error ?? 'Delete failed');
    }
  });

  return wrapper;
}

function buildOAuthProviderBodyContent(provider) {
  const content = document.createElement('div');
  content.className = 'provider-body-content';

  const status = document.createElement('div');
  status.style.cssText = 'font-size:13px;color:var(--text-secondary,#aaa);margin-bottom:10px';
  status.textContent = provider.hasKey
    ? 'Signed in via OAuth.'
    : 'Not signed in. Click below to start the device authorization flow.';

  const actionRow = document.createElement('div');
  actionRow.className = 'key-row';
  actionRow.style.flexWrap = 'wrap';
  actionRow.style.gap = '8px';

  const signInBtn = document.createElement('button');
  signInBtn.className = 'btn btn-primary';
  signInBtn.textContent = provider.hasKey ? 'Re-authenticate' : 'Sign in';

  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'btn btn-ghost';
  refreshBtn.textContent = 'Refresh Models';
  refreshBtn.style.display = provider.hasKey ? '' : 'none';

  const feedback = document.createElement('div');
  feedback.className = 'key-feedback';

  actionRow.appendChild(signInBtn);
  actionRow.appendChild(refreshBtn);
  content.appendChild(status);
  content.appendChild(actionRow);
  content.appendChild(feedback);
  content.appendChild(buildDeleteProviderRow(provider));

  let pollInterval = null;
  function stopPolling() {
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  }

  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    feedback.textContent = 'Fetching latest models…';
    feedback.className = 'key-feedback muted';
    const result = await refreshProvider(provider.id);
    refreshBtn.disabled = false;
    if (result.ok) {
      feedback.textContent = `✓ ${result.count} models`;
      feedback.className = 'key-feedback success';
      const countEl = document.querySelector(`[data-id="${CSS.escape(provider.id)}"] .provider-models-count`);
      if (countEl) countEl.textContent = `${result.count} models`;
    } else {
      feedback.textContent = result.error ?? 'Refresh failed';
      feedback.className = 'key-feedback error';
    }
    setTimeout(() => { feedback.textContent = ''; feedback.className = 'key-feedback'; }, 4000);
  });

  signInBtn.addEventListener('click', async () => {
    stopPolling();
    signInBtn.disabled = true;
    refreshBtn.disabled = true;
    feedback.textContent = 'Starting authorization…';
    feedback.className = 'key-feedback muted';

    const startResult = await api('POST', '/api/providers/oauth/start', { providerId: provider.id });
    if (startResult.error) {
      feedback.textContent = startResult.error;
      feedback.className = 'key-feedback error';
      signInBtn.disabled = false;
      refreshBtn.disabled = false;
      return;
    }

    const { sessionId, url, userCode } = startResult;
    window.open(url, '_blank');
    feedback.innerHTML = `Go to <a href="${url}" target="_blank" style="color:inherit">${url}</a><br>
      Enter code: <strong style="letter-spacing:0.1em;font-size:15px">${userCode}</strong><br>
      <span style="opacity:0.6;font-size:12px">Waiting for authorization…</span>`;
    feedback.className = 'key-feedback muted';

    pollInterval = setInterval(async () => {
      const statusResult = await api('GET', `/api/providers/oauth/status?sessionId=${encodeURIComponent(sessionId)}`);
      if (statusResult.status === 'done') {
        stopPolling();
        feedback.textContent = '✓ Signed in successfully';
        feedback.className = 'key-feedback success';
        provider.hasKey = true;
        status.textContent = 'Signed in via OAuth.';
        signInBtn.textContent = 'Re-authenticate';
        signInBtn.disabled = false;
        refreshBtn.style.display = '';
        refreshBtn.disabled = false;
        const chip = document.querySelector(`[data-id="${CSS.escape(provider.id)}"] .status-chip`);
        if (chip) { chip.className = 'status-chip has-key'; chip.textContent = 'Key stored'; }
        showToast(`Signed in to ${provider.name ?? provider.id}`);
        state.modelsLoaded = false;
        initModels().then(() => { renderProviders(); renderFavList(); });
      } else if (statusResult.status === 'error') {
        stopPolling();
        feedback.textContent = statusResult.error ?? 'Authorization failed';
        feedback.className = 'key-feedback error';
        signInBtn.disabled = false;
        refreshBtn.disabled = false;
      } else if (statusResult.error) {
        stopPolling();
        feedback.textContent = 'Session expired — please try again';
        feedback.className = 'key-feedback error';
        signInBtn.disabled = false;
        refreshBtn.disabled = false;
      }
    }, 3000);
  });

  return content;
}

// ─── Model search results ─────────────────────────────────────────────────────

function buildModelResults(filter, listType) {
  const containerId = listType === 'agy' ? 'agy-results' : 'model-results';
  const container = document.getElementById(containerId);
  const currentFavs = listType === 'agy' ? state.agyFavorites : state.generalFavorites;
  const atCapacity = listType === 'agy' && currentFavs.length >= AGY_MAX;
  const freeOnly = listType === 'agy' ? state.agyFreeOnly : state.modelFreeOnly;

  if (!filter) { container.hidden = true; return; }
  container.hidden = false;

  if (state.modelsError) {
    container.innerHTML = `<div class="model-results-error"><span>${state.modelsError}</span><button class="btn btn-ghost">Retry</button></div>`;
    container.querySelector('button')?.addEventListener('click', () => {
      state.modelsError = null; state.modelsLoaded = false;
      initModels().then(() => buildModelResults(filter, listType));
    });
    return;
  }

  if (!state.modelsLoaded) {
    container.innerHTML = Array(3).fill('<div class="skeleton" style="height:36px;margin:4px 12px;border-radius:6px"></div>').join('');
    return;
  }

  const q = filter.trim().toLowerCase();
  const base = state.allModels.filter(m => !freeOnly || isFreeModel(m));
  const matched = base.filter(m =>
    !q ||
    m.id.toLowerCase().includes(q) ||
    (m.name && m.name.toLowerCase().includes(q)) ||
    m.providerName.toLowerCase().includes(q)
  ).slice(0, freeOnly && !q ? 80 : 40);

  if (matched.length === 0) {
    container.innerHTML = `<div class="model-results-empty">${freeOnly ? 'No free models found.' : 'No models found.'}</div>`;
    return;
  }

  const groups = new Map();
  for (const m of matched) {
    if (!groups.has(m.providerId)) groups.set(m.providerId, { name: m.providerName, models: [] });
    groups.get(m.providerId).models.push(m);
  }

  container.innerHTML = '';
  for (const [providerId, { name, models }] of groups) {
    const [c1, c2] = providerPalette(providerId);
    const initial = providerInitial(name);

    const groupHeader = document.createElement('div');
    groupHeader.className = 'model-group-header';
    groupHeader.innerHTML = `<div class="model-group-icon" style="background:linear-gradient(135deg,${c1},${c2})">${initial}</div>${name}`;
    container.appendChild(groupHeader);

    for (const m of models) {
      const isFav = currentFavs.some(f => f.providerId === m.providerId && f.modelId === m.id);
      const row = document.createElement('div');
      row.className = 'model-result-row';

      const idEl = document.createElement('span');
      idEl.className = 'model-result-id';
      idEl.textContent = m.id;
      idEl.title = m.id;

      const ctxEl = document.createElement('span');
      ctxEl.className = 'model-result-ctx';
      ctxEl.textContent = fmtCtx(m.contextWindow);
      const badgeEl = document.createElement('span');
      badgeEl.className = `free-badge ${m.freeStatus === 'free_provider' ? 'dev-access' : ''}`;
      badgeEl.textContent = freeBadgeLabel(m);

      const addBtn = document.createElement('button');
      addBtn.className = 'btn-add' + (isFav ? ' already-added' : '');
      addBtn.textContent = isFav ? '✓' : '+';
      addBtn.disabled = isFav || (!isFav && atCapacity);
      addBtn.title = atCapacity && !isFav ? `Antigravity is full (${AGY_MAX}/${AGY_MAX})` : (isFav ? 'Already added' : 'Add to favorites');
      if (!isFav && !atCapacity) {
        addBtn.addEventListener('click', () => {
          addToFavorites({ providerId: m.providerId, modelId: m.id }, listType);
          buildModelResults(filter, listType);
        });
      }

      row.appendChild(idEl);
      if (isFreeModel(m)) row.appendChild(badgeEl);
      row.appendChild(ctxEl);
      row.appendChild(addBtn);
      container.appendChild(row);
    }
  }
}

// ─── Favorites CRUD ───────────────────────────────────────────────────────────

function addToFavorites(fav, listType) {
  if (listType === 'agy') {
    if (state.agyFavorites.length >= AGY_MAX) return;
    state.agyFavorites = [...state.agyFavorites, fav];
    saveFavorites({ antigravityCliFavoriteModels: state.agyFavorites });
    renderAgyList();
    updateAgyCounter();
  } else {
    state.generalFavorites = [...state.generalFavorites, fav];
    saveFavorites({ favoriteModels: state.generalFavorites });
    renderFavList();
  }
}

function removeFromFavorites(index, listType) {
  if (listType === 'agy') {
    const prev = [...state.agyFavorites];
    state.agyFavorites = state.agyFavorites.filter((_, i) => i !== index);
    saveFavorites({ antigravityCliFavoriteModels: state.agyFavorites });
    renderAgyList(); updateAgyCounter();
    showToast('Removed from Antigravity', () => {
      state.agyFavorites = prev;
      saveFavorites({ antigravityCliFavoriteModels: state.agyFavorites });
      renderAgyList(); updateAgyCounter();
    });
  } else {
    const prev = [...state.generalFavorites];
    state.generalFavorites = state.generalFavorites.filter((_, i) => i !== index);
    saveFavorites({ favoriteModels: state.generalFavorites });
    renderFavList();
    showToast('Removed from favorites', () => {
      state.generalFavorites = prev;
      saveFavorites({ favoriteModels: state.generalFavorites });
      renderFavList();
    });
  }
}

function reorderFavorites(from, to, listType) {
  const arr = listType === 'agy' ? [...state.agyFavorites] : [...state.generalFavorites];
  const prev = [...arr];
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item);
  if (listType === 'agy') {
    state.agyFavorites = arr;
    saveFavorites({ antigravityCliFavoriteModels: state.agyFavorites });
    renderAgyList();
  } else {
    state.generalFavorites = arr;
    saveFavorites({ favoriteModels: state.generalFavorites });
    renderFavList();
  }
  showToast('Order saved', () => {
    if (listType === 'agy') {
      state.agyFavorites = prev;
      saveFavorites({ antigravityCliFavoriteModels: state.agyFavorites });
      renderAgyList();
    } else {
      state.generalFavorites = prev;
      saveFavorites({ favoriteModels: state.generalFavorites });
      renderFavList();
    }
  });
}

// ─── Fav item ────────────────────────────────────────────────────────────────

function buildFavItem(fav, index, listType) {
  const item = document.createElement('div');
  item.className = 'fav-item slide-in';
  item.setAttribute('draggable', 'true');
  item.setAttribute('role', 'listitem');
  item.setAttribute('tabindex', '0');
  item.dataset.index = String(index);

  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.setAttribute('aria-hidden', 'true');
  handle.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="8" y="4" width="3" height="3" rx="1"/><rect x="13" y="4" width="3" height="3" rx="1"/><rect x="8" y="10" width="3" height="3" rx="1"/><rect x="13" y="10" width="3" height="3" rx="1"/><rect x="8" y="16" width="3" height="3" rx="1"/><rect x="13" y="16" width="3" height="3" rx="1"/></svg>`;

  const neon = modelNeon(fav.modelId);

  const rank = document.createElement('span');
  rank.className = 'fav-rank';
  rank.textContent = String(index + 1);
  rank.style.background = neon.bg;
  rank.style.color = neon.color;
  rank.style.borderColor = neon.border;
  rank.style.boxShadow = `0 0 8px ${neon.border}`;

  const idEl = document.createElement('span');
  idEl.className = 'fav-model-id';
  idEl.textContent = fav.modelId;
  idEl.title = fav.modelId;

  const provBadge = document.createElement('span');
  provBadge.className = 'fav-provider-badge';
  provBadge.textContent = getProviderName(fav.providerId);
  // Colored pill using the provider's palette
  const [c1] = providerPalette(fav.providerId);
  provBadge.style.color = c1;
  provBadge.style.background = c1.replace(')', ' / 0.1)');
  provBadge.style.borderColor = c1.replace(')', ' / 0.3)');

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn-remove';
  removeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  removeBtn.setAttribute('aria-label', `Remove ${fav.modelId}`);
  removeBtn.addEventListener('click', () => removeFromFavorites(index, listType));

  item.appendChild(handle);
  item.appendChild(rank);
  item.appendChild(idEl);
  item.appendChild(provBadge);
  item.appendChild(removeBtn);

  // Drag-and-drop
  item.addEventListener('dragstart', e => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    requestAnimationFrame(() => item.classList.add('dragging'));
  });

  item.addEventListener('dragend', () => {
    item.classList.remove('dragging');
    document.querySelectorAll('.fav-item').forEach(el => el.classList.remove('drag-over'));
  });

  item.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.fav-item').forEach(el => el.classList.remove('drag-over'));
    item.classList.add('drag-over');
  });

  item.addEventListener('dragleave', () => item.classList.remove('drag-over'));

  item.addEventListener('drop', e => {
    e.preventDefault();
    item.classList.remove('drag-over');
    const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (!isNaN(from) && from !== index) reorderFavorites(from, index, listType);
  });

  // Keyboard reorder
  item.addEventListener('keydown', e => {
    const arr = listType === 'agy' ? state.agyFavorites : state.generalFavorites;
    if (e.altKey && e.key === 'ArrowUp' && index > 0) { e.preventDefault(); reorderFavorites(index, index - 1, listType); }
    else if (e.altKey && e.key === 'ArrowDown' && index < arr.length - 1) { e.preventDefault(); reorderFavorites(index, index + 1, listType); }
  });

  return item;
}

function renderFavList() {
  const list = document.getElementById('favorites-list');
  list.innerHTML = '';
  if (state.generalFavorites.length === 0) {
    list.innerHTML = '<div class="fav-empty">No favorites yet. Search above to add your first.</div>';
  } else {
    state.generalFavorites.forEach((f, i) => list.appendChild(buildFavItem(f, i, 'general')));
  }
  updateGeneralCounter();
}

function updateGeneralCounter() {
  const count = state.generalFavorites.length;

  const pips = document.getElementById('gen-pips');
  if (pips) {
    pips.innerHTML = '';
    for (let i = 0; i < GENERAL_MAX; i++) {
      const pip = document.createElement('div');
      pip.className = 'agy-pip' + (i < count ? ' filled' : '');
      pips.appendChild(pip);
    }
  }

  const counter = document.getElementById('gen-counter');
  if (counter) counter.innerHTML = `${count}<span class="agy-slot-max">/${GENERAL_MAX}</span>`;
}

function renderAgyList() {
  const list = document.getElementById('agy-list');
  list.innerHTML = '';
  if (state.agyFavorites.length === 0) {
    list.innerHTML = '<div class="fav-empty">No Antigravity favorites yet. Search above to add your first.</div>';
    return;
  }
  state.agyFavorites.forEach((f, i) => list.appendChild(buildFavItem(f, i, 'agy')));
}

function updateAgyCounter() {
  const count = state.agyFavorites.length;

  // Section counter
  const counter = document.getElementById('agy-counter');
  if (counter) counter.innerHTML = `${count}<span class="agy-slot-max">/6</span>`;

  // Slot pips
  const pips = document.getElementById('agy-pips');
  if (pips) {
    pips.innerHTML = '';
    for (let i = 0; i < AGY_MAX; i++) {
      const pip = document.createElement('div');
      pip.className = 'agy-pip' + (i < count ? ' filled' : '');
      pips.appendChild(pip);
    }
  }

  // Sidebar badge
  const badge = document.getElementById('nav-agy-badge');
  if (badge) {
    badge.textContent = `${count}/${AGY_MAX}`;
    badge.classList.toggle('full', count >= AGY_MAX);
  }
}

// ─── Sidebar nav highlight ────────────────────────────────────────────────────

function initNav() {
  const sectionIds = ['providers', 'favorites', 'antigravity', 'apps', 'server'];
  const navItems = document.querySelectorAll('.nav-item');
  const content = document.getElementById('content');

  // Always start on Providers & Keys — hardcoded, no computed check at mount.
  // The scroll listener updates this as the user scrolls.
  function setActive(id) {
    navItems.forEach(n => n.classList.toggle('active', n.dataset.section === id));
  }
  setActive('providers');

  content.addEventListener('scroll', () => {
    const contentTop = content.getBoundingClientRect().top;
    const threshold = content.clientHeight * 0.4;
    let activeId = 'providers';
    for (const id of sectionIds) {
      const el = document.getElementById(id);
      if (!el) continue;
      const elTop = el.getBoundingClientRect().top - contentTop;
      if (elTop < threshold) activeId = id;
    }
    setActive(activeId);
  }, { passive: true });
}

// ─── Provider stats ──────────────────────────────────────────────────────────

function renderProviderStats() {
  const el = document.getElementById('provider-stats');
  if (!el) return;
  const providerCount = state.providers.length;
  const modelCount = state.allModels.length;
  el.innerHTML = `
    <div class="provider-stat">
      <div class="provider-stat-value"><span>${providerCount}</span></div>
      <div class="provider-stat-label">providers configured</div>
    </div>
    <div class="provider-stat">
      <div class="provider-stat-value"><span>${modelCount}</span></div>
      <div class="provider-stat-label">models available</div>
    </div>
  `;
}

// ─── Dark / light mode toggle ─────────────────────────────────────────────────

function initTheme() {
  const saved = localStorage.getItem('relay-ai-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = saved ? saved === 'dark' : prefersDark;
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  updateThemeIcon(isDark);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('relay-ai-theme', next);
  updateThemeIcon(next === 'dark');
}

function updateThemeIcon(isDark) {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const iconEl = btn.querySelector('.theme-icon');
  const labelEl = btn.querySelector('.theme-label');
  if (iconEl) iconEl.innerHTML = isDark
    ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
    : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
  if (labelEl) labelEl.textContent = isDark ? 'Light mode' : 'Dark mode';
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function initModels() {
  state.modelsError = null;
  try {
    await loadModels();
    state.modelsLoaded = true;
  } catch (err) {
    state.modelsError = String(err);
    state.modelsLoaded = true;
  }
}

async function init() {
  initTheme();
  initNav();

  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

  await loadConfig();
  renderFavList();
  renderAgyList();
  updateAgyCounter();
  updateGeneralCounter();
  await loadApps();
  renderApps();
  renderProviders(); // shows skeletons

  initServerPolling();

  // Load templates in parallel with models — re-render providers when done
  loadTemplates().then(() => renderProviders());

  initModels().then(() => {
    renderProviders();
    renderProviderStats();
    renderApps();
    // Re-render favorites now that we have full provider names
    renderFavList();
    renderAgyList();
    if (state.modelFilter) buildModelResults(state.modelFilter, 'general');
    if (state.agyFilter)   buildModelResults(state.agyFilter, 'agy');
  });

  document.getElementById('provider-search').addEventListener('input', e => {
    state.providerFilter = e.target.value;
    renderProviders();
  });

  document.getElementById('refresh-all-btn').addEventListener('click', async () => {
    const btn = document.getElementById('refresh-all-btn');
    const status = document.getElementById('refresh-all-status');
    btn.disabled = true;
    btn.classList.add('loading');
    status.hidden = false;
    status.textContent = 'Refreshing all providers…';

    const result = await api('POST', '/api/providers/refresh-all');

    btn.disabled = false;
    btn.classList.remove('loading');

    if (result.ok) {
      const succeeded = result.providers.filter(p => p.ok && !p.skipped);
      const skipped   = result.providers.filter(p => p.skipped);
      const failed    = result.providers.filter(p => !p.ok && !p.skipped);

      // Reload filtered catalog first so the model count matches what search shows
      state.modelsLoaded = false;
      await initModels();
      renderProviders();
      if (state.modelFilter) buildModelResults(state.modelFilter, 'general');
      if (state.agyFilter)   buildModelResults(state.agyFilter, 'agy');

      // Build status panel — use filtered count so it matches the search
      status.innerHTML = '';

      const oauthSkipped = result.providers.filter(p => p.oauthWarning);
      const realFailed   = failed.filter(p => !p.oauthWarning);
      const allSkipped   = skipped.length + oauthSkipped.length;

      const summary = document.createElement('div');
      summary.textContent = `✓ Refreshed ${succeeded.length} provider${succeeded.length !== 1 ? 's' : ''}`
        + (allSkipped  ? ` · ${allSkipped} skipped`      : '')
        + (realFailed.length ? ` · ${realFailed.length} failed` : '')
        + ` · ${state.allModels.length} models available`;
      status.appendChild(summary);

      if (oauthSkipped.length > 0 || realFailed.length > 0) {
        const detailSection = document.createElement('div');
        detailSection.style.marginTop = '8px';
        detailSection.style.paddingTop = '8px';
        detailSection.style.borderTop = '1px solid oklch(22% 0.015 265)';

        for (const p of oauthSkipped) {
          const row = document.createElement('div');
          row.style.color = 'oklch(80% 0.18 75)';  // amber — warning, not error
          row.style.fontSize = '14px';
          row.style.marginTop = '4px';
          row.textContent = `⚠ ${p.name}: OAuth — model list refresh not available via API. Connection is still active.`;
          detailSection.appendChild(row);
        }

        for (const p of realFailed) {
          const row = document.createElement('div');
          row.style.color = 'oklch(68% 0.22 25)';  // red — actual failure
          row.style.fontSize = '14px';
          row.style.marginTop = '4px';
          row.textContent = `✗ ${p.name}: ${p.reason ?? 'Unknown error'}`;
          detailSection.appendChild(row);
        }

        status.appendChild(detailSection);
      }

      // Auto-hide after longer delay if there are real failures
      setTimeout(() => { status.hidden = true; }, realFailed.length > 0 ? 12000 : 6000);
    } else {
      status.textContent = `✗ Refresh failed: ${result.error ?? 'Unknown error'}`;
      setTimeout(() => { status.hidden = true; }, 5000);
    }
  });

  document.getElementById('model-search').addEventListener('input', e => {
    state.modelFilter = e.target.value;
    buildModelResults(state.modelFilter, 'general');
  });
  document.getElementById('model-free-only')?.addEventListener('change', e => {
    state.modelFreeOnly = e.target.checked;
    buildModelResults(state.modelFilter, 'general');
  });

  document.getElementById('agy-search').addEventListener('input', e => {
    state.agyFilter = e.target.value;
    buildModelResults(state.agyFilter, 'agy');
  });
  document.getElementById('agy-free-only')?.addEventListener('change', e => {
    state.agyFreeOnly = e.target.checked;
    buildModelResults(state.agyFilter, 'agy');
  });

  document.getElementById('app-model-search')?.addEventListener('input', e => {
    state.appModelFilter = e.target.value;
    renderApps();
  });
  document.getElementById('app-free-only')?.addEventListener('change', e => {
    state.appFreeOnly = e.target.checked;
    renderApps();
  });
}

init();

// ─── Applications Control Center ──────────────────────────────────────────────

state.apps = [];

async function loadApps() {
  try {
    const data = await api('GET', '/api/apps');
    if (data && data.apps) {
      state.apps = data.apps;
      state.recentLaunchFolders = data.recentLaunchFolders ?? [];
      for (const app of state.apps) {
        if (!state.appLaunchFolders[app.id]) {
          state.appLaunchFolders[app.id] = state.recentLaunchFolders[0] ?? '';
        }
      }
    }
  } catch (err) {
    console.error('Failed to load apps:', err);
  }
}

function getAppSelection(appId) {
  return state.appSelections[appId] ?? { mode: 'default', label: 'Choose at launch' };
}

function appModelInputValue(appId) {
  if (state.appModelOpen === appId) return state.appModelFilters[appId] ?? '';
  return getAppSelection(appId).label;
}

function matchedAppModels(appId) {
  const localFilter = state.appModelFilters[appId] ?? '';
  const q = (localFilter || state.appModelFilter).trim().toLowerCase();
  const matched = state.allModels.filter(m => {
    const providerName = getProviderName(m.providerId);
    if (state.appFreeOnly && !isFreeModel(m)) return false;
    if (!q) return true;
    return m.id.toLowerCase().includes(q)
      || (m.name && m.name.toLowerCase().includes(q))
      || providerName.toLowerCase().includes(q)
      || (m.providerName && m.providerName.toLowerCase().includes(q));
  });
  return matched.slice(0, 80);
}

function buildAppModelResults(appId) {
  const matched = matchedAppModels(appId);
  const groups = new Map();
  for (const m of matched) {
    const providerName = getProviderName(m.providerId);
    if (!groups.has(m.providerId)) {
      groups.set(m.providerId, { name: providerName, models: [] });
    }
    groups.get(m.providerId).models.push(m);
  }

  if (groups.size === 0) {
    return '<div class="launch-model-empty">No models match.</div>';
  }

  return Array.from(groups.entries())
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(([providerId, group]) => {
      const rows = group.models
        .slice()
        .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
        .map(m => {
          const fav = isGeneralFavorite(m.providerId, m.id);
          const label = `${fav ? '★ ' : ''}${m.name || m.id}`;
          const badge = isFreeModel(m) ? `<span class="free-badge ${m.freeStatus === 'free_provider' ? 'dev-access' : ''}">${escapeHtml(freeBadgeLabel(m))}</span>` : '';
          const encodedProvider = encodeURIComponent(m.providerId);
          const encodedModel = encodeURIComponent(m.id);
          return `
            <button class="launch-model-row" type="button" onclick="selectLaunchModel('${appId}', '${encodedProvider}', '${encodedModel}')">
              <span class="launch-model-name">${escapeHtml(label)}</span>
              ${badge}
              <span class="launch-model-id">${escapeHtml(m.id)}</span>
            </button>
          `;
        })
        .join('');
      return `
        <div class="launch-model-group">
          <div class="launch-model-group-heading">${escapeHtml(group.name)}</div>
          ${rows}
        </div>
      `;
    })
    .join('');
}

function renderApps() {
  const cliContainer = document.getElementById('apps-list-cli');
  const desktopContainer = document.getElementById('apps-list-apps');
  if (!cliContainer || !desktopContainer) return;

  if (state.apps.length === 0) {
    cliContainer.innerHTML = '<div class="apps-empty">No applications found.</div>';
    desktopContainer.innerHTML = '';
    return;
  }

  const searchSuffix = state.appModelFilter.trim()
    ? ` matching "${escapeHtml(state.appModelFilter.trim())}"`
    : '';

  // Per-app icon background overrides (when we have a real icon)
  const APP_ICON_BG = {
    claude: '#D97757',
    codex: '#1a1a2e',
    gemini: '#1E1E2E',
    agy: '#111827',
    antigravity: '#ffffff',
    'antigravity-ide': '#000000',
    'claude-app': '#D77655',
    'codex-app': '#111827',
  };

  const renderAppCard = (app) => {
    const statusText = app.installed ? 'Installed' : 'Not Detected';
    const statusClass = app.installed ? 'provider-badge active' : 'provider-badge';
    const [iconStart, iconEnd] = providerPalette(app.id);
    const iconInitial = appIconInitial(app);
    const hasCustomIcon = APP_ICON_SVGS[app.id] || APP_ICON_IMGS[app.id];
    const iconBg = hasCustomIcon
      ? (APP_ICON_BG[app.id] ?? `linear-gradient(135deg, ${iconStart}, ${iconEnd})`)
      : `linear-gradient(135deg, ${iconStart}, ${iconEnd})`;
    const modelInputValue = appModelInputValue(app.id);
    const modelResults = state.appModelOpen === app.id ? buildAppModelResults(app.id) : '';
    const launchFolder = state.appLaunchFolders[app.id] ?? '';
    const recentFolders = state.recentLaunchFolders
      .map(folder => `<button class="launch-folder-chip" type="button" onclick="selectLaunchFolder('${app.id}', '${encodeURIComponent(folder)}')">${escapeHtml(folder)}</button>`)
      .join('');

    return `
      <div class="provider-card${state.appModelOpen === app.id ? ' launch-model-open' : ''}" style="opacity: ${app.installed ? 1 : 0.65}; padding: 24px; position: relative; overflow: visible;">
        <div class="provider-header" style="margin-bottom: 16px; display: flex; align-items: center; gap: 14px;">
          <div class="provider-icon" style="background: ${iconBg}; display:flex; align-items:center; justify-content:center;">
            ${getAppIconHtml(app, iconInitial)}
          </div>
          <div class="provider-info">
            <h3 class="provider-name" style="font-size: 1.15rem; font-weight: 600;">${app.name}</h3>
            <span class="${statusClass}" style="margin-top: 4px; display: inline-block;">${statusText}</span>
          </div>
        </div>

        ${app.installed ? `
          <div class="launch-controls" style="display: flex; flex-direction: column; gap: 12px;">
            <div class="launch-model-picker">
              <label style="font-size: 12px; font-weight: 500; color: var(--color-muted);">Model 🧠${searchSuffix}</label>
              <div class="launch-model-input-wrap">
                <input id="launch-model-input-${app.id}" class="search-input launch-model-input" value="${escapeHtml(modelInputValue)}" placeholder="Search models..." onfocus="openLaunchModelPicker('${app.id}')" oninput="filterLaunchModels('${app.id}', this.value)">
                ${state.appModelOpen === app.id ? `
                  <div class="launch-model-menu">
                    <div class="launch-model-quick">
                      <button type="button" onclick="selectLaunchDefault('${app.id}')">Choose at launch</button>
                      <button type="button" onclick="selectLaunchFavorites('${app.id}')">★ Favorites</button>
                    </div>
                    ${modelResults}
                  </div>
                ` : ''}
              </div>
            </div>
            ${app.type !== 'app' ? `
            <div class="launch-folder-control">
              <label style="font-size: 12px; font-weight: 500; color: var(--color-muted);">Launch folder 📁</label>
              <div style="display: flex; gap: 8px; align-items: center;">
                <input id="launch-folder-${app.id}" class="search-input launch-folder-input" style="flex: 1;" value="${escapeHtml(launchFolder)}" placeholder="/path/to/codebase" oninput="setLaunchFolder('${app.id}', this.value)">
                <button class="btn btn-ghost" onclick="browseLaunchFolder('${app.id}')" style="height: 42px; padding: 0 12px; display: flex; align-items: center; justify-content: center; font-size: 16px;" title="Browse Folder">
                  📂
                </button>
              </div>
              ${recentFolders ? `<div class="launch-folder-recents">${recentFolders}</div>` : ''}
            </div>
            ` : ''}
            <button class="btn btn-primary" onclick="launchApp('${app.id}')" style="width: 100%; height: 38px; font-size: 14px; font-weight: 600;">
              Launch
            </button>
          </div>
        ` : `
          <div style="font-size: 14px; color: var(--color-muted); line-height: 1.5; margin-bottom: 20px;">
            This tool is not installed or not found in your system's PATH variable.
          </div>
          <div style="font-size: 12px; color: var(--color-muted); background: oklch(14% 0.005 265); padding: 8px 12px; border-radius: 6px;">
            Install via npm: <code style="color: var(--color-accent); font-family: monospace;">npm install -g @relay-ai/cli</code>
          </div>
        `}
      </div>
    `;
  };

  const byName = (a, b) => a.name.localeCompare(b.name);
  const cliApps = state.apps.filter(app => app.type === 'cli').sort(byName);
  const desktopApps = state.apps.filter(app => app.type !== 'cli').sort(byName);

  const columnHtml = (label, apps) => `
    <div class="apps-group-heading">${escapeHtml(label)}</div>
    ${apps.length === 0 ? '<div class="apps-empty">None detected.</div>' : apps.map(renderAppCard).join('')}
  `;

  cliContainer.innerHTML = columnHtml('CLI', cliApps);
  desktopContainer.innerHTML = columnHtml('Apps', desktopApps);

  renderAppPathSettings();
}

function renderAppPathSettings() {
  const container = document.getElementById('app-paths-list');
  if (!container) return;

  if (state.apps.length === 0) {
    container.innerHTML = '<div class="advanced-empty">No applications detected yet.</div>';
    return;
  }

  container.innerHTML = state.apps.map(app => {
    const pathValue = app.path ?? '';
    const sourceLabel = app.pathSource === 'override' ? 'Custom path' : app.path ? 'Auto-detected' : 'Not detected';
    const statusClass = app.installed ? 'provider-badge active' : 'provider-badge';
    return `
      <div class="app-path-row">
        <div class="app-path-meta">
          <div class="app-path-name">${escapeHtml(app.name)}</div>
          <span class="${statusClass}">${sourceLabel}</span>
        </div>
        <input id="app-path-input-${app.id}" class="search-input app-path-input" value="${escapeHtml(pathValue)}" placeholder="Path to ${escapeHtml(app.name)}">
        <div class="app-path-actions">
          <button class="btn btn-primary" onclick="saveAppPath('${app.id}')">Save</button>
          <button class="btn btn-ghost" onclick="clearAppPath('${app.id}')" ${app.pathSource === 'override' ? '' : 'disabled'}>Auto</button>
        </div>
      </div>
    `;
  }).join('');
}

async function launchApp(appId) {
  const selection = getAppSelection(appId);
  const body = { appId };

  if (selection.mode === 'favorites') {
    body.favorites = true;
  } else if (selection.mode === 'model') {
    body.providerId = selection.providerId;
    body.modelId = selection.modelId;
  }

  const folder = (state.appLaunchFolders[appId] ?? '').trim();
  if (folder) {
    body.cwd = folder;
  }

  // Visual feedback on button
  const button = document.querySelector(`button[onclick="launchApp('${appId}')"]`);
  if (!button) return;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Launching...';

  try {
    const res = await api('POST', '/api/apps/launch', body);
    if (res.ok) {
      await loadApps();
      button.textContent = 'Launched!';
      setTimeout(() => {
        button.disabled = false;
        button.textContent = originalText;
        renderApps();
      }, 2000);
    } else {
      alert('Launch failed: ' + (res.error || 'Unknown error'));
      button.disabled = false;
      button.textContent = originalText;
    }
  } catch (err) {
    alert('Launch failed: ' + err);
    button.disabled = false;
    button.textContent = originalText;
  }
}

function updateLaunchModelMenu(appId, clearInput) {
  const input = document.getElementById(`launch-model-input-${appId}`);
  if (!input) return false;
  
  if (clearInput) {
    input.value = '';
  }

  const wrap = input.closest('.launch-model-input-wrap');
  if (!wrap) return false;
  document.querySelectorAll('.provider-card.launch-model-open').forEach(card => {
    card.classList.remove('launch-model-open');
  });
  wrap.closest('.provider-card')?.classList.add('launch-model-open');

  let menu = wrap.querySelector('.launch-model-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.className = 'launch-model-menu';
    wrap.appendChild(menu);
  }

  const modelResults = buildAppModelResults(appId);
  menu.innerHTML = `
    <div class="launch-model-quick">
      <button type="button" onclick="selectLaunchDefault('${appId}')">Choose at launch</button>
      <button type="button" onclick="selectLaunchFavorites('${appId}')">★ Favorites</button>
    </div>
    ${modelResults}
  `;
  return true;
}

function openLaunchModelPicker(appId) {
  state.appModelOpen = appId;
  state.appModelFilters[appId] = '';
  if (!updateLaunchModelMenu(appId, true)) {
    renderApps();
    setTimeout(() => document.getElementById(`launch-model-input-${appId}`)?.focus(), 0);
  }
}

function filterLaunchModels(appId, value) {
  state.appModelOpen = appId;
  state.appModelFilters[appId] = value;
  updateLaunchModelMenu(appId, false);
}

function selectLaunchDefault(appId) {
  state.appSelections[appId] = { mode: 'default', label: 'Choose at launch' };
  state.appModelOpen = null;
  state.appModelFilters[appId] = '';
  renderApps();
}

function selectLaunchFavorites(appId) {
  state.appSelections[appId] = { mode: 'favorites', label: '★ Favorites' };
  state.appModelOpen = null;
  state.appModelFilters[appId] = '';
  renderApps();
}

function selectLaunchModel(appId, encodedProviderId, encodedModelId) {
  const providerId = decodeURIComponent(encodedProviderId);
  const modelId = decodeURIComponent(encodedModelId);
  const model = state.allModels.find(m => m.providerId === providerId && m.id === modelId);
  const favorite = isGeneralFavorite(providerId, modelId);
  const label = `${favorite ? '★ ' : ''}${model?.name || modelId}`;
  state.appSelections[appId] = { mode: 'model', providerId, modelId, label };
  state.appModelOpen = null;
  state.appModelFilters[appId] = '';
  renderApps();
}

function setLaunchFolder(appId, value) {
  state.appLaunchFolders[appId] = value;
}

function selectLaunchFolder(appId, encodedFolder) {
  state.appLaunchFolders[appId] = decodeURIComponent(encodedFolder);
  renderApps();
}

async function browseLaunchFolder(appId) {
  try {
    const res = await api('POST', '/api/apps/browse-folder');
    if (res.path) {
      state.appLaunchFolders[appId] = res.path;
      renderApps();
    } else if (res.error) {
      alert('Failed to open folder picker: ' + res.error);
    }
  } catch (err) {
    alert('Failed to open folder picker: ' + err);
  }
}

async function saveAppPath(appId) {
  const input = document.getElementById(`app-path-input-${appId}`);
  if (!input) return;

  const path = input.value.trim();
  if (!path) {
    alert('Enter a path, or click Auto to use auto-detection.');
    return;
  }

  const res = await api('POST', '/api/apps/path', { appId, path });
  if (res.ok) {
    state.apps = res.apps ?? state.apps;
    renderApps();
  } else {
    alert('Path not saved: ' + (res.error || 'Unknown error'));
  }
}

async function clearAppPath(appId) {
  const res = await api('POST', '/api/apps/path', { appId, path: null });
  if (res.ok) {
    state.apps = res.apps ?? state.apps;
    renderApps();
  } else {
    alert('Path not cleared: ' + (res.error || 'Unknown error'));
  }
}

// Expose launchApp to window scope for onclick handlers
window.launchApp = launchApp;
window.openLaunchModelPicker = openLaunchModelPicker;
window.filterLaunchModels = filterLaunchModels;
window.selectLaunchDefault = selectLaunchDefault;
window.selectLaunchFavorites = selectLaunchFavorites;
window.selectLaunchModel = selectLaunchModel;
window.setLaunchFolder = setLaunchFolder;
window.selectLaunchFolder = selectLaunchFolder;
window.browseLaunchFolder = browseLaunchFolder;
window.saveAppPath = saveAppPath;
window.clearAppPath = clearAppPath;

// Close the launch model picker when clicking outside
document.addEventListener('click', (e) => {
  if (!state.appModelOpen) return;
  const wrap = e.target.closest('.launch-model-input-wrap');
  if (!wrap) {
    state.appModelOpen = null;
    renderApps();
  }
});

// ─── Server ────────────────────────────────────────────────────────────────
// Runs either `relay-ai server` or `relay-ai server --http-proxy` in-process
// from the browser: same lifecycle and output, no second terminal needed.

async function refreshServerStatus() {
  try {
    const data = await api('GET', '/api/server/status');
    state.server.status = data;
    if (!data.running) seedServerFormFromSaved(data.saved);
  } catch {
    // Transient poll failure — keep showing the last known state.
  }
  renderServerPanel();
  updateServerNavBadge();
}

function seedServerFormFromSaved(saved) {
  const f = state.server.form;
  if (f.seeded || !saved) return;
  f.seeded = true;
  // The CLI wizard also allows "expose all providers" (favoritesOnly: false, exposedProviders: null),
  // which this form has no toggle for. Land on "Specific providers" with nothing pre-checked rather
  // than silently reinterpreting it as "Favorites only" — a materially narrower, wrong scope.
  f.expose = saved.favoritesOnly ? 'favorites' : 'specific';
  f.freeModelsOnly = Boolean(saved.freeModelsOnly);
  f.exposedProviders = saved.exposedProviders ? [...saved.exposedProviders] : [];
  f.maskGatewayIds = saved.maskGatewayIds;
  f.listenMode = saved.listenMode === 'network' ? 'network' : 'local';
  f.passwordMode = saved.hasSavedPassword ? 'saved' : 'new';
  if (f.expose === 'specific') loadServerProviders().then(renderServerPanel);
}

function updateServerNavBadge() {
  const badge = document.getElementById('nav-server-badge');
  if (!badge) return;
  badge.hidden = !(state.server.status && state.server.status.running);
}

function initServerPolling() {
  refreshServerStatus();
  setInterval(() => {
    // Skip while the tab is backgrounded — the endpoint reads config/keychain state that
    // doesn't need sub-second freshness, and there's no reason to keep polling unseen.
    if (!document.hidden) refreshServerStatus();
  }, 5000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshServerStatus();
  });
}

async function loadServerProviders() {
  if (state.server.form.providersLoaded) return;
  try {
    const data = await api('GET', '/api/server/providers');
    state.server.form.providersList = data.providers ?? [];
  } catch {
    state.server.form.providersList = [];
  }
  state.server.form.providersLoaded = true;
}

function renderServerPanel() {
  const panel = document.getElementById('server-panel');
  if (!panel) return;
  const s = state.server;
  if (!s.status) {
    panel.innerHTML = '<div class="skeleton skeleton-card"></div>';
    return;
  }
  panel.innerHTML = s.status.running ? renderServerRunning(s.status) : renderServerSetup(s);
}

function buildServerProviderRows() {
  const s = state.server;
  const q = s.form.providerSearch.trim().toLowerCase();
  const filtered = s.form.providersList.filter(p =>
    !q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
  );
  if (!s.form.providersLoaded) {
    return Array(3).fill('<div class="skeleton" style="height:36px;margin:4px 0;border-radius:6px"></div>').join('');
  }
  if (filtered.length === 0) return '<div class="fav-empty">No providers match.</div>';
  return filtered.map(p => {
    const isSel = s.form.exposedProviders.includes(p.id);
    return `
      <label class="server-provider-row">
        <input type="checkbox" ${isSel ? 'checked' : ''} onchange="toggleServerProvider('${p.id}')">
        <span class="server-provider-row-name">${escapeHtml(p.name)}</span>
        <span class="server-provider-row-count">${p.modelCount} model${p.modelCount !== 1 ? 's' : ''}</span>
      </label>
    `;
  }).join('');
}

function renderServerProviderPicker() {
  const s = state.server;
  const chips = s.form.exposedProviders.map(id => {
    const p = s.form.providersList.find(x => x.id === id);
    const label = p ? p.name : id;
    return `<span class="server-provider-chip">${escapeHtml(label)}<button type="button" onclick="toggleServerProvider('${id}')" aria-label="Remove ${escapeHtml(label)}">&times;</button></span>`;
  }).join('');

  return `
    <div class="server-providers-picker">
      ${chips ? `<div class="server-provider-chips">${chips}</div>` : ''}
      <div class="search-field">
        <svg class="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input type="search" class="search-input" placeholder="Search providers to expose…" value="${escapeHtml(s.form.providerSearch)}" oninput="setServerProviderSearch(this.value)">
      </div>
      <div class="server-provider-list">${buildServerProviderRows()}</div>
    </div>
  `;
}

function toggleGroupHtml(options) {
  return `<div class="toggle-group">${options.map(o =>
    `<button type="button" class="toggle-option ${o.active ? 'active' : ''}" onclick="${o.onClick}">${escapeHtml(o.label)}</button>`
  ).join('')}</div>`;
}

function renderServerNetworkOptions() {
  const s = state.server;
  const f = s.form;
  const hasSaved = Boolean(s.status?.saved?.hasSavedPassword);
  const showPasswordInput = f.passwordMode === 'new' || !hasSaved;

  return `
    <div class="server-network-options">
      ${hasSaved ? toggleGroupHtml([
        { label: 'Use saved password', active: f.passwordMode === 'saved', onClick: "setServerPasswordMode('saved')" },
        { label: 'Enter new password', active: f.passwordMode === 'new', onClick: "setServerPasswordMode('new')" },
      ]) : ''}
      ${showPasswordInput ? `
        <input type="password" class="key-input" placeholder="Server password" value="${escapeHtml(f.password)}" oninput="setServerPassword(this.value)">
        <label class="server-toggle-row">
          <input type="checkbox" ${f.savePassword ? 'checked' : ''} onchange="setServerSavePassword(this.checked)">
          <span>Save this password for next time</span>
        </label>
      ` : ''}
    </div>
  `;
}

function renderServerSetup(s) {
  const f = s.form;
  const modePicker = `
    <div class="server-field">
      <div class="server-field-label">Mode</div>
      ${toggleGroupHtml([
        { label: 'API gateway', active: f.mode === 'gateway', onClick: "setServerMode('gateway')" },
        { label: 'HTTP proxy', active: f.mode === 'http-proxy', onClick: "setServerMode('http-proxy')" },
      ])}
    </div>
  `;

  if (f.mode === 'http-proxy') {
    return `
      <div class="server-setup">
        ${modePicker}
        <div class="server-proxy-note">
          <strong>Transparent Claude Code proxy</strong>
          <p>Keeps Claude Code's normal Anthropic login and forwards first-party models unchanged. Compatible global favorites are available by typing their <code>relay:&lt;provider&gt;:&lt;model&gt;</code> name in <code>/model</code>.</p>
          <p>The proxy listens only on this machine. After it starts, use the environment variables shown below and leave <code>ANTHROPIC_BASE_URL</code> unset.</p>
        </div>
        ${s.error ? `<div class="key-feedback error server-start-error">${escapeHtml(s.error)}</div>` : ''}
        <button class="btn btn-primary server-start-btn" ${s.starting ? 'disabled' : ''} onclick="submitServerStart()">
          ${s.starting ? 'Starting…' : 'Start HTTP Proxy'}
        </button>
      </div>
    `;
  }

  const specific = f.expose === 'specific';
  const providersOk = f.expose === 'favorites' || (specific && f.exposedProviders.length > 0);
  const passwordOk = f.listenMode !== 'network' || f.passwordMode === 'saved' || f.password.trim().length > 0;
  const canStart = providersOk && passwordOk && !s.starting;

  let hint = '';
  if (!providersOk) hint = 'Select at least one provider to expose.';
  else if (!passwordOk) hint = 'Enter a server password for network mode.';

  return `
    <div class="server-setup">
      ${modePicker}
      <div class="server-field">
        <div class="server-field-label">Expose</div>
        ${toggleGroupHtml([
          { label: 'Favorites only', active: f.expose === 'favorites', onClick: "setServerExpose('favorites')" },
          { label: 'Specific providers', active: specific, onClick: "setServerExpose('specific')" },
        ])}
        ${specific ? renderServerProviderPicker() : ''}
      </div>

      <div class="server-field">
        <label class="server-toggle-row">
          <input type="checkbox" ${f.maskGatewayIds ? 'checked' : ''} onchange="setServerMask(this.checked)">
          <span>Mask gateway model ids <span class="server-field-hint">(needed for Claude Desktop / Cowork)</span></span>
        </label>
        <label class="server-toggle-row">
          <input type="checkbox" ${f.freeModelsOnly ? 'checked' : ''} onchange="setServerFreeModelsOnly(this.checked)">
          <span>Free models only <span class="server-field-hint">(includes verified $0 models and free developer access)</span></span>
        </label>
      </div>

      <div class="server-field">
        <div class="server-field-label">Listen</div>
        ${toggleGroupHtml([
          { label: 'Local only', active: f.listenMode === 'local', onClick: "setServerListenMode('local')" },
          { label: 'Network', active: f.listenMode === 'network', onClick: "setServerListenMode('network')" },
        ])}
        ${f.listenMode === 'network' ? renderServerNetworkOptions() : ''}
      </div>

      ${s.error ? `<div class="key-feedback error server-start-error">${escapeHtml(s.error)}</div>` : ''}

      <button class="btn btn-primary server-start-btn" ${canStart ? '' : 'disabled'} onclick="submitServerStart()">
        ${s.starting ? 'Starting…' : 'Start Server'}
      </button>
      ${hint && !s.error ? `<div class="server-field-hint">${escapeHtml(hint)}</div>` : ''}
    </div>
  `;
}

function renderServerRunning(status) {
  if (status.mode === 'http-proxy') return renderHttpProxyRunning(status);

  let idx = 0;
  const nextId = () => `server-url-${idx++}`;

  function urlCard(label, url) {
    const id = nextId();
    return `
      <div class="url-card">
        <div class="url-card-label">${escapeHtml(label)}</div>
        <span class="url-card-value" id="${id}">${escapeHtml(url)}</span>
        <button class="btn btn-ghost btn-sm" onclick="copyServerValue('${id}')">Copy</button>
      </div>
    `;
  }

  const urlCards = [urlCard('Anthropic', status.anthropicUrl), urlCard('OpenAI', status.openaiUrl)];
  for (const n of status.networkUrls ?? []) {
    urlCards.push(urlCard(`Anthropic (${n.name})`, n.anthropicUrl));
    urlCards.push(urlCard(`OpenAI (${n.name})`, n.openaiUrl));
  }
  if (status.requestLogPath) urlCards.push(urlCard('Request log', status.requestLogPath));

  const apiKeyCard = status.listenMode === 'network'
    ? `
      <div class="url-card">
        <div class="url-card-label">API key</div>
        <span class="url-card-value masked" id="server-api-key-value" data-value="${escapeHtml(status.apiKey || '')}">••••••••••••</span>
        <button class="btn btn-ghost btn-sm" onclick="toggleServerApiKeyVisibility()">Reveal</button>
        <button class="btn btn-ghost btn-sm" onclick="copyServerValue('server-api-key-value')">Copy</button>
      </div>
    `
    : `
      <div class="url-card">
        <div class="url-card-label">API key</div>
        <span class="url-card-value">any non-empty value</span>
      </div>
    `;

  const configBits = [];
  if (status.favoritesOnly) configBits.push('Favorites only');
  else if (status.exposedProviders) configBits.push(`${status.exposedProviders.length} provider${status.exposedProviders.length !== 1 ? 's' : ''}`);
  else configBits.push('All providers');
  if (status.freeModelsOnly) configBits.push('Free models only');
  configBits.push(status.maskGatewayIds ? 'Discovery ids masked' : 'Discovery ids raw');
  configBits.push(status.listenMode === 'network' ? 'Network' : 'Local only');

  const modelRows = (status.models ?? []).map(m => `
    <tr>
      <td>${escapeHtml(m.providerLabel)}</td>
      <td>${escapeHtml(m.name)}</td>
      <td><code>${escapeHtml(m.anthropicId)}</code></td>
      <td><code>${escapeHtml(m.openaiId)}</code></td>
    </tr>
  `).join('');

  return `
    <div class="server-running">
      <div class="server-status-row">
        <span class="server-status-badge"><span class="server-status-dot"></span>Server running</span>
        <button class="btn btn-ghost server-stop-btn" onclick="stopServerGateway()">Stop Server</button>
      </div>
      <div class="server-config-summary">
        ${escapeHtml(configBits.join(' · '))}${status.providerSummary ? ' — ' + escapeHtml(status.providerSummary) : ''}
      </div>
      <div class="url-card-grid">
        ${urlCards.join('')}
        ${apiKeyCard}
      </div>
      <div class="server-model-table-wrap">
        <table class="server-model-table">
          <thead><tr><th>Provider</th><th>Model</th><th>Anthropic ID</th><th>OpenAI ID</th></tr></thead>
          <tbody>${modelRows || '<tr><td colspan="4" class="fav-empty">No models exposed.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderHttpProxyRunning(status) {
  function envCard(label, value, id) {
    return `
      <div class="url-card server-proxy-env-card">
        <div class="url-card-label">${escapeHtml(label)}</div>
        <span class="url-card-value" id="${id}">${escapeHtml(value || '')}</span>
        <button class="btn btn-ghost btn-sm" onclick="copyServerValue('${id}')">Copy</button>
      </div>
    `;
  }

  const modelRows = (status.proxyModels ?? []).map(m => `
    <tr>
      <td>${escapeHtml(m.displayName)}</td>
      <td><code>${escapeHtml(m.id)}</code></td>
    </tr>
  `).join('');

  const skipped = [];
  if (status.unavailableFavorites) {
    skipped.push(`${status.unavailableFavorites} unavailable favorite${status.unavailableFavorites === 1 ? '' : 's'}`);
  }
  if (status.unsupportedFavorites) {
    skipped.push(`${status.unsupportedFavorites} unsupported favorite${status.unsupportedFavorites === 1 ? '' : 's'}`);
  }

  return `
    <div class="server-running">
      <div class="server-status-row">
        <span class="server-status-badge"><span class="server-status-dot"></span>HTTP proxy running</span>
        <button class="btn btn-ghost server-stop-btn" onclick="stopServerGateway()">Stop Proxy</button>
      </div>
      <div class="server-config-summary">
        Local only · Transparent Anthropic passthrough · ${(status.proxyModels ?? []).length} relay model${(status.proxyModels ?? []).length === 1 ? '' : 's'}
      </div>
      <div class="server-proxy-note server-proxy-running-note">
        <strong>Configure the shell that will launch Claude Code</strong>
        <p>Set the three environment values below. Leave <code>ANTHROPIC_BASE_URL</code> unset so Claude Code uses its normal Anthropic authentication.</p>
        <p>Each inference appends routing metadata—but never prompts, credentials, or response bodies—to the request log.</p>
      </div>
      <div class="url-card-grid">
        ${envCard('HTTPS_PROXY', status.proxyUrl, 'server-https-proxy')}
        ${envCard('HTTP_PROXY', status.proxyUrl, 'server-http-proxy')}
        ${envCard('NODE_EXTRA_CA_CERTS', status.caCertPath, 'server-proxy-ca-cert')}
        ${envCard('REQUEST LOG', status.requestLogPath, 'server-proxy-request-log')}
      </div>
      ${skipped.length ? `<div class="server-proxy-warning">Skipped ${escapeHtml(skipped.join(' and '))}. Update them in Favorites, then restart the proxy.</div>` : ''}
      <div class="server-model-table-wrap">
        <table class="server-model-table">
          <thead><tr><th>Favorite model</th><th>Claude Code <code>/model</code> name</th></tr></thead>
          <tbody>${modelRows || '<tr><td colspan="2" class="fav-empty">No compatible favorites configured. Anthropic passthrough still works.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

function setServerMode(mode) {
  state.server.form.mode = mode;
  state.server.error = null;
  renderServerPanel();
}

function setServerExpose(mode) {
  state.server.form.expose = mode;
  state.server.error = null;
  if (mode === 'specific' && !state.server.form.providersLoaded) {
    loadServerProviders().then(renderServerPanel);
  }
  renderServerPanel();
}

function toggleServerProvider(id) {
  const arr = state.server.form.exposedProviders;
  const idx = arr.indexOf(id);
  if (idx >= 0) arr.splice(idx, 1); else arr.push(id);
  renderServerPanel();
}

function setServerProviderSearch(value) {
  state.server.form.providerSearch = value;
  const list = document.querySelector('#server-panel .server-provider-list');
  if (list) list.innerHTML = buildServerProviderRows();
}

function setServerMask(checked) {
  state.server.form.maskGatewayIds = checked;
}

function setServerFreeModelsOnly(checked) {
  state.server.form.freeModelsOnly = checked;
}

function setServerListenMode(mode) {
  state.server.form.listenMode = mode;
  state.server.error = null;
  renderServerPanel();
}

function setServerPasswordMode(mode) {
  state.server.form.passwordMode = mode;
  renderServerPanel();
}

function setServerPassword(value) {
  state.server.form.password = value;
}

function setServerSavePassword(checked) {
  state.server.form.savePassword = checked;
}

async function submitServerStart() {
  const f = state.server.form;
  state.server.starting = true;
  state.server.error = null;
  renderServerPanel();

  const body = f.mode === 'http-proxy'
    ? { mode: 'http-proxy' }
    : {
        mode: 'gateway',
        favoritesOnly: f.expose === 'favorites',
        freeModelsOnly: f.freeModelsOnly,
        exposedProviders: f.expose === 'specific' ? f.exposedProviders : null,
        maskGatewayIds: f.maskGatewayIds,
        listenMode: f.listenMode,
        passwordMode: f.passwordMode,
        password: f.password,
        savePassword: f.savePassword,
      };

  let result;
  try {
    result = await api('POST', '/api/server/start', body);
  } catch (err) {
    result = { ok: false, error: String(err) };
  }

  state.server.starting = false;
  if (result.ok) {
    state.server.status = result.status;
    state.server.form.password = '';
    showToast(f.mode === 'http-proxy' ? 'HTTP proxy started' : 'Server started');
  } else {
    state.server.error = result.error || 'Failed to start server';
  }
  renderServerPanel();
  updateServerNavBadge();
}

async function stopServerGateway() {
  try {
    await api('POST', '/api/server/stop');
    state.server.form.seeded = false;
    await refreshServerStatus();
    showToast('Server stopped');
  } catch (err) {
    showToast('Failed to stop server: ' + err);
  }
}

async function copyServerValue(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const text = el.dataset.value ?? el.textContent;
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard');
  } catch {
    showToast('Could not copy — copy manually');
  }
}

function toggleServerApiKeyVisibility() {
  const el = document.getElementById('server-api-key-value');
  if (!el) return;
  const masked = el.classList.toggle('masked');
  el.textContent = masked ? '••••••••••••' : (el.dataset.value ?? '');
}

window.setServerMode = setServerMode;
window.setServerExpose = setServerExpose;
window.toggleServerProvider = toggleServerProvider;
window.setServerProviderSearch = setServerProviderSearch;
window.setServerMask = setServerMask;
window.setServerFreeModelsOnly = setServerFreeModelsOnly;
window.setServerListenMode = setServerListenMode;
window.setServerPasswordMode = setServerPasswordMode;
window.setServerPassword = setServerPassword;
window.setServerSavePassword = setServerSavePassword;
window.submitServerStart = submitServerStart;
window.stopServerGateway = stopServerGateway;
window.copyServerValue = copyServerValue;
window.toggleServerApiKeyVisibility = toggleServerApiKeyVisibility;
