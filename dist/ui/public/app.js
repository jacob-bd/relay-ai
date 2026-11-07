import {
  formatModelPrice,
  formatModelTestLabel,
  getProviderModelPage,
  isFreeModel,
  matchesModelSearch,
  PROVIDER_MODEL_PAGE_SIZE,
  sortByIntelligence,
} from './provider-model-browser.js';
import { copyDeviceCode, copyTextToClipboard, oauthConnectionLabel } from './oauth-device.js';
import { providerInitial, providerLogoHtml } from './provider-logo.js';
import { dropTarget, moveItem } from './drag-order.js';

// ─── State ───────────────────────────────────────────────────────────────────

const GENERAL_MAX = 50;
const CODEX_SUBAGENT_MAX = 1;
const UPDATE_COMMAND = 'npm install -g @jacobbd/relay-ai@latest';

const state = {
  freePoolMembers: [],
  freePoolEnabled: false,
  pool: null,          // { data, error } from GET /api/pool
  poolSearch: '',
  poolMinCtx: 0,
  poolProviders: [],   // selected provider ids for the free-model filter; empty = all
  poolPage: 1,
  poolBusy: false,

  providers: [],
  usage: {},                  // providerId → saved plan usage (GET /api/usage; checked on demand only)
  usageRefreshing: new Set(), // providerIds with a manual check in flight
  intelligenceActive: false, // scores downloaded: show the Intelligence column
  intelligenceSort: null,    // null | 'desc' | 'asc'
  templates: [],   // unconfigured available templates
  allModels: [],
  appModelsByTarget: {}, // launch target → flattened, compatibility-filtered model list
  generalFavorites: [],
  codexSubagentModels: [],
  modelsLoaded: false,
  modelsError: null,
  providerFilter: '',
  activeProviderId: null,
  providerModelFilter: '',
  providerModelMinCtx: 0,
  providerModelFreeOnly: false,
  providerModelPage: 1,
  manualModelForms: new Map(), // provider ID → draft and in-flight action, survives browser re-renders
  contextEdit: null, // { providerId, modelId, value, unit } while a context size is being edited
  contextMeasure: null, // { providerId, done, total, cancelled, controllers } while measuring all sizes
  kindEdit: null, // { providerId, modelId, kind } while a model type is being edited
  modelSelection: new Map(), // provider ID → Set of model IDs ticked for bulk hide
  modelFilter: '',
  modelFreeOnly: false,
  codexSubagentFilter: '',
  codexSubagentFreeOnly: false,
  appModelFilter: '',
  appFreeOnly: false,
  providerNameMap: {}, // providerId → full display name
  recentLaunchFolders: [],
  appLaunchFolders: {},
  appModelFilters: {},
  appModelOpen: null,
  appSelections: {},
  appHttpProxy: {},
  appWithNative: {},
  server: {
    status: null,
    error: null,
    starting: false,
    modelSearch: '',
    form: {
      seeded: false,
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
      passwordVisible: false,
      savePassword: false,
    },
  },
};

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
  const normalized = id.replace(/-\d+$/, '');
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) hash = (hash * 31 + normalized.charCodeAt(i)) | 0;
  return PALETTES[Math.abs(hash) % PALETTES.length];
}

// Inline style for a provider pill, matching the Favorites badge colors.
// The Free Pool page lists many accounts at once, so it gives each one its own hue,
// spaced evenly around the wheel (hashing into 8 palettes made accounts collide).
let poolHueColors = new Map();
function assignPoolProviderColors(ids) {
  const sorted = [...new Set(ids)].sort();
  const step = 360 / Math.max(sorted.length, 1);
  poolHueColors = new Map(sorted.map((id, i) => [id, `oklch(72% 0.17 ${Math.round((i * step + 200) % 360)})`]));
}

function providerPillStyle(id, strength = 1) {
  const c1 = poolHueColors.get(id) ?? providerPalette(id)[0];
  return `color:${c1};background:${c1.replace(')', ` / ${0.1 * strength})`)};border-color:${c1.replace(')', ` / ${0.3 * strength})`)}`;
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
  state.freePoolMembers = data.freePoolMembers ?? [];
  state.freePoolEnabled = data.freePoolEnabled === true;
  state.codexSubagentModels = (data.codexSubagentModels ?? []).slice(0, CODEX_SUBAGENT_MAX);
}

async function initUpdateIndicator() {
  const indicator = document.getElementById('update-indicator');
  const popover = document.getElementById('update-popover');
  if (!indicator || !popover) return;

  try {
    const status = await api('GET', '/api/update-status');
    if (!status.updateAvailable || !status.latestVersion) return;

    document.getElementById('update-current-version').textContent = status.currentVersion;
    document.getElementById('update-latest-version').textContent = status.latestVersion;
    indicator.title = `Version ${status.latestVersion} is available. Click for update instructions.`;
    indicator.hidden = false;
  } catch {
    return;
  }

  indicator.addEventListener('click', () => {
    const open = popover.hidden;
    popover.hidden = !open;
    indicator.setAttribute('aria-expanded', String(open));
  });

  document.getElementById('update-copy-btn')?.addEventListener('click', async () => {
    try {
      await copyTextToClipboard(UPDATE_COMMAND);
      showToast('Update command copied');
    } catch {
      showToast('Could not copy the update command');
    }
  });

  document.addEventListener('click', event => {
    if (!popover.hidden && !document.getElementById('sidebar-version-area')?.contains(event.target)) {
      popover.hidden = true;
      indicator.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !popover.hidden) {
      popover.hidden = true;
      indicator.setAttribute('aria-expanded', 'false');
      indicator.focus();
    }
  });
}

async function loadTemplates() {
  const data = await api('GET', '/api/providers/templates');
  state.templates = data.templates ?? [];
}

function flattenModelProviders(providers) {
  const flat = [];
  for (const p of providers) {
    const favoriteProviderName = p.favoriteName ?? p.name;
    for (const m of (p.models ?? []).filter(model => !model.hidden)) flat.push({
      id: m.id,
      name: m.name,
      providerId: p.id,
      providerName: favoriteProviderName,
      contextWindow: m.contextWindow ?? null,
      isFree: Boolean(m.isFree),
      freeStatus: m.freeStatus,
      freeLabel: m.freeLabel,
      cost: m.cost,
      claudeTransparentCompatible: Boolean(m.claudeTransparentCompatible),
    });
  }
  return flat;
}

// Mirrors src/ui/api.ts's APP_ID_TO_LAUNCH_TARGET — which models are compatible with
// which app depends on the launch target, not just the raw catalog.
const APP_ID_NEEDS_TARGET_FILTER = new Set([
  'claude', 'claude-app', 'codex', 'codex-app', 'codex-subagents', 'gemini', 'agy', 'antigravity', 'antigravity-ide',
]);

async function loadAppModels(appId) {
  if (state.appModelsByTarget[appId]) return state.appModelsByTarget[appId];
  if (!APP_ID_NEEDS_TARGET_FILTER.has(appId)) return state.allModels;
  const data = await api('GET', `/api/models?appId=${encodeURIComponent(appId)}`);
  if (data.error) return state.allModels;
  const flat = flattenModelProviders(data.providers ?? []);
  state.appModelsByTarget[appId] = flat;
  return flat;
}

async function loadModels() {
  const data = await api('GET', '/api/models');
  if (data.error) throw new Error(data.error);
  state.providers = data.providers ?? [];
  for (const p of state.providers) {
    state.providerNameMap[p.id] = p.name;
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
  const byShownName = (a, b) => getProviderName(a.id).localeCompare(getProviderName(b.id), undefined, { sensitivity: 'base', numeric: true });
  state.providers.sort(byShownName);
  state.allModels = flattenModelProviders(state.providers);
}

async function saveFavorites(payload) { return api('POST', '/api/config', payload); }
async function saveKey(providerId, key, confirmOverwrite = false) {
  return api('POST', '/api/keys', { providerId, key, confirmOverwrite });
}
async function refreshProvider(providerId, key) {
  return api('POST', '/api/providers/refresh', key ? { providerId, key } : { providerId });
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function showToast(msg, undoFn, durationMs = 2200) {
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
    // Long messages (e.g. test results with a pool reason) need time to read; hovering holds the toast.
    const readMs = Math.max(durationMs, Math.min(15000, 3000 + msg.length * 50));
    let timer = setTimeout(dismiss, readMs);
    toast.addEventListener('mouseenter', () => clearTimeout(timer));
    toast.addEventListener('mouseleave', () => { timer = setTimeout(dismiss, 2500); });
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

// Latest Test outcome (stored locally in the registry): a small badge next to the Test button.
function testBadgeHtml(result) {
  if (!result) return '<span class="model-test-badge is-untested" title="Not tested yet">Untested</span>';
  const when = new Date(result.at);
  const day = Number.isNaN(when.getTime()) ? '' : when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const stamp = Number.isNaN(when.getTime()) ? '' : when.toLocaleString();
  if (result.ok) {
    const tools = result.toolsPassed === false ? ' · tool calling not confirmed' : '';
    return `<span class="model-test-badge is-pass" title="Passed ${escapeHtml(stamp)}${tools}">✓ Passed${day ? ' · ' + escapeHtml(day) : ''}</span>`;
  }
  if (result.transient) {
    return `<span class="model-test-badge is-retry" title="${escapeHtml((result.error || 'Temporary problem') + ' This does not mean the model is broken; run Test again.')}">⏱ Try again${day ? ' · ' + escapeHtml(day) : ''}</span>`;
  }
  return `<span class="model-test-badge is-fail" title="${escapeHtml((result.error || 'Test failed') + (stamp ? ' (' + stamp + ')' : ''))}">✗ Failed${day ? ' · ' + escapeHtml(day) : ''}</span>`;
}

function freeBadgeLabel(model) {
  if (model?.freeStatus === 'free_provider') {
    const isCloudflare = model?.providerId === 'cloudflare' || model?.id?.startsWith('@cf/') || model?.id?.startsWith('@hf/');
    return isCloudflare ? '10k/day Free' : 'Free dev access';
  }
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
  const connectionLabel = oauthConnectionLabel(provider);
  const card = document.createElement('div');
  card.className = 'provider-card';
  card.dataset.id = provider.id;

  const header = document.createElement('div');
  header.className = 'provider-card-header';
  header.setAttribute('role', 'button');
  header.setAttribute('tabindex', '0');
  header.setAttribute('aria-label', `View models from ${displayName}`);

  header.innerHTML = `
    <div class="provider-icon" style="background:linear-gradient(135deg,${c1},${c2})">${providerLogoHtml(provider.id, displayName)}</div>
    <div class="provider-info">
      <div class="provider-name">${escapeHtml(displayName)}</div>
      <div class="provider-models-count">${provider.modelCount ?? provider.models?.length ?? 0} models</div>
      ${provider.canEditServerUrl && provider.serverUrl ? `<div class="provider-server-url" title="Server address">${escapeHtml(provider.serverUrl)}</div>` : ''}
    </div>
    <div class="provider-status">
      <span class="status-chip ${provider.hasKey ? 'has-key' : provider.freeAccess ? 'free-access' : 'no-key'}">
        ${escapeHtml(connectionLabel)}
      </span>
      <button class="provider-config-toggle" type="button" aria-label="Manage ${escapeHtml(displayName)} provider" aria-expanded="false" title="Manage provider">
        <svg class="provider-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
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
    configToggle.setAttribute('aria-expanded', String(isOpen));
    body.setAttribute('aria-hidden', String(!isOpen));
  }

  const configToggle = header.querySelector('.provider-config-toggle');
  configToggle.addEventListener('click', event => { event.stopPropagation(); toggle(); });
  header.addEventListener('click', () => openProviderModelBrowser(provider.id));
  header.addEventListener('keydown', e => {
    if (e.target === header && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openProviderModelBrowser(provider.id);
    }
  });

  const usage = document.createElement('div');
  usage.className = 'provider-usage';
  usage.dataset.usageFor = provider.id;
  renderUsageStrip(usage, provider.id);

  card.appendChild(header);
  card.appendChild(usage);
  card.appendChild(body);
  return card;
}

// ─── Plan usage (per signed-in account; checked on demand, never on a timer) ──

async function loadUsage() {
  try {
    const data = await api('GET', '/api/usage');
    if (data.ok) applyUsage(data.accounts);
  } catch { /* usage is optional */ }
}

function applyUsage(accounts) {
  for (const account of accounts ?? []) state.usage[account.providerId] = account;
  document.querySelectorAll('.provider-usage').forEach(el => renderUsageStrip(el, el.dataset.usageFor));
}

async function refreshUsage(providerId) {
  if (state.usageRefreshing.has(providerId)) return;
  state.usageRefreshing.add(providerId);
  applyUsage([]);
  try {
    const data = await api('POST', '/api/usage/refresh', { providerId });
    if (!data.ok) showToast(data.error || 'Could not check usage');
    const account = data.accounts?.[0];
    if (account?.error) showToast(account.error.message);
    state.usageRefreshing.delete(providerId);
    applyUsage(data.accounts);
  } catch {
    state.usageRefreshing.delete(providerId);
    applyUsage([]);
    showToast('Could not check usage');
  }
}

function usageRelative(iso, future) {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return '';
  const mins = Math.round(Math.abs(ms) / 60000);
  const text = mins < 1 ? 'now' : mins < 60 ? `${mins}m` : mins < 48 * 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${Math.round(mins / 1440)}d`;
  if (future) return ms <= 0 ? 'reset' : `resets in ${text}`;
  return mins < 1 ? 'just now' : `${text} ago`;
}

function usageWindowHtml(w) {
  const expired = w.resetsAt && Date.parse(w.resetsAt) <= Date.now();
  const used = expired ? 0 : w.usedPercent;
  const pct = used == null ? null : Math.max(0, Math.min(100, used));
  const level = pct == null ? '' : pct >= 90 ? 'is-high' : pct >= 70 ? 'is-mid' : '';
  const counts = w.limit != null && w.remaining != null ? ` · ${w.remaining}/${w.limit} left` : '';
  const models = w.scope?.type === 'model-group' && w.scope.modelIds?.length ? w.scope.modelIds.join(', ') : '';
  return `
    <div class="usage-row" ${models ? `title="${escapeHtml(models)}"` : ''}>
      <span class="usage-label">${escapeHtml(w.label)}</span>
      <span class="usage-bar ${level}"><span style="width:${pct ?? 0}%"></span></span>
      <span class="usage-pct">${pct == null ? '—' : `${Math.round(pct)}%`}</span>
      <span class="usage-reset">${escapeHtml((w.resetsAt ? usageRelative(w.resetsAt, true) : '') + counts)}</span>
    </div>`;
}

function renderUsageStrip(el, providerId) {
  const account = state.usage[providerId];
  if (!account || account.status === 'unsupported') { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const busy = state.usageRefreshing.has(providerId);
  const checked = account.fetchedAt ? `checked ${usageRelative(account.fetchedAt, false)}` : 'not checked yet';
  const balances = account.balances ?? [];
  const rows = account.windows.map(usageWindowHtml).join('') + balances.map(b => `
    <div class="usage-row usage-balance">
      <span class="usage-label">${escapeHtml(b.label)}</span>
      <span class="usage-amount">US$${Number(b.amount).toFixed(2)}</span>
    </div>`).join('');
  const note = account.error
    ? `<div class="usage-note is-error">${escapeHtml(account.error.message)}${account.windows.length ? ' Showing the last reading.' : ''}</div>`
    : account.status === 'ok' && !account.windows.length && !balances.length ? '<div class="usage-note">No usage limits reported.</div>' : '';
  el.innerHTML = `
    <div class="usage-head">
      <span class="usage-title">Plan usage${account.limitReached ? ' · <span class="usage-limit">limit reached</span>' : ''}</span>
      <span class="usage-checked">${escapeHtml(checked)}</span>
      <button class="btn btn-ghost btn-sm usage-refresh" type="button" ${busy ? 'disabled' : ''}>${busy ? 'Checking…' : 'Refresh'}</button>
    </div>
    ${rows}${note}`;
  el.querySelector('.usage-refresh').addEventListener('click', event => {
    event.stopPropagation();
    refreshUsage(providerId);
  });
}

function providerIdFromHash() {
  const prefix = '#provider/';
  if (!window.location.hash.startsWith(prefix)) return null;
  try {
    return decodeURIComponent(window.location.hash.slice(prefix.length));
  } catch {
    return null;
  }
}

function openProviderModelBrowser(providerId) {
  if (state.activeProviderId !== providerId) {
    state.providerModelFilter = '';
    state.providerModelPage = 1;
  }
  window.location.hash = `provider/${encodeURIComponent(providerId)}`;
}

function syncProviderModelBrowserFromHash() {
  const providerId = providerIdFromHash();
  const content = document.getElementById('content');
  state.activeProviderId = providerId;
  content.classList.toggle('provider-browser-open', Boolean(providerId));
  if (!providerId) return;
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.section === 'providers');
  });
  content.scrollTop = 0;
  renderProviderModelBrowser();
}

let activeModelFavPopover = null;

function closeModelFavPopover() {
  if (activeModelFavPopover) {
    activeModelFavPopover.remove();
    activeModelFavPopover = null;
  }
}

function toggleModelFavoriteMenu(button, providerId, modelId) {
  const targetKey = `${providerId}::${modelId}`;
  if (activeModelFavPopover && activeModelFavPopover.dataset.targetId === targetKey) {
    closeModelFavPopover();
    return;
  }
  closeModelFavPopover();

  const model = state.providers.find(item => item.id === providerId)?.models?.find(item => item.id === modelId);
  const pool = model ? poolRowState(providerId, model) : { state: 'hidden' };
  const isGenFav = isGeneralFavorite(providerId, modelId);
  const isSubagent = state.codexSubagentModels.some(f => f.providerId === providerId && f.modelId === modelId);
  const genAtCapacity = state.generalFavorites.length >= GENERAL_MAX;
  const subagentAtCapacity = state.codexSubagentModels.length >= CODEX_SUBAGENT_MAX;

  const popover = document.createElement('div');
  popover.className = 'model-fav-popover';
  popover.dataset.targetId = targetKey;

  const genDisabled = isGenFav || genAtCapacity;
  let genLabel = '★ Add to Favorites';
  if (isGenFav) genLabel = '✓ In Global Favorites';
  else if (genAtCapacity) genLabel = `★ Favorites full (${GENERAL_MAX}/${GENERAL_MAX})`;

  const subagentDisabled = isSubagent || subagentAtCapacity;
  let subagentLabel = '✦ Add to Codex SubAgent';
  if (isSubagent) subagentLabel = '✓ In Codex SubAgent';
  else if (subagentAtCapacity) subagentLabel = `✦ Codex SubAgent full (${CODEX_SUBAGENT_MAX}/${CODEX_SUBAGENT_MAX})`;

  // The pool is a third destination, not a second plus button on the row.
  const showPool = pool.state !== 'hidden';
  const poolDisabled = pool.state === 'member' || pool.state === 'blocked';
  let poolLabel = '⇄ Add to Relay Free Pool';
  if (pool.state === 'member') poolLabel = '✓ In Relay Free Pool';
  else if (pool.state === 'blocked') poolLabel = 'Relay Free Pool unavailable';
  const poolTitle = pool.state === 'blocked' ? pool.reason : '';

  popover.innerHTML = `
    <button class="model-fav-popover-item ${genDisabled ? 'disabled' : ''}" type="button" data-type="general" ${genDisabled ? 'disabled' : ''}>
      <span>${genLabel}</span>
      <span class="popover-slot-count">${state.generalFavorites.length}/${GENERAL_MAX}</span>
    </button>
    <button class="model-fav-popover-item ${subagentDisabled ? 'disabled' : ''}" type="button" data-type="codex-subagents" ${subagentDisabled ? 'disabled' : ''}>
      <span>${subagentLabel}</span>
      <span class="popover-slot-count">${state.codexSubagentModels.length}/${CODEX_SUBAGENT_MAX}</span>
    </button>
    ${showPool ? `<button class="model-fav-popover-item ${poolDisabled ? 'disabled' : ''}" type="button" data-type="free-pool" title="${escapeHtml(poolTitle)}" ${poolDisabled ? 'disabled' : ''}>
      <span>${poolLabel}</span>
      <span class="popover-slot-count">${pool.state === 'member' ? '✓' : 'free'}</span>
    </button>` : ''}
  `;

  popover.querySelectorAll('.model-fav-popover-item').forEach(item => {
    item.addEventListener('click', event => {
      event.stopPropagation();
      const listType = item.dataset.type;
      if (listType === 'free-pool') {
        closeModelFavPopover();
        void toggleFreePoolModel(providerId, modelId);
        return;
      }
      addToFavorites({ providerId, modelId }, listType);
      closeModelFavPopover();
      showToast(
        listType === 'codex-subagents'
          ? 'Added to Codex SubAgent'
          : 'Added to Global Favorites',
      );
      renderProviderModelBrowser();
    });
  });

  const rect = button.getBoundingClientRect();
  popover.style.position = 'fixed';
  popover.style.top = `${rect.bottom + 4}px`;
  popover.style.left = `${Math.max(10, rect.right - 220)}px`;
  popover.style.zIndex = '9999';

  document.body.appendChild(popover);
  activeModelFavPopover = popover;
}

document.addEventListener('click', event => {
  if (activeModelFavPopover && !activeModelFavPopover.contains(event.target) && !event.target.closest('.btn-model-add')) {
    closeModelFavPopover();
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && activeModelFavPopover) {
    closeModelFavPopover();
  }
});

function renderProviderModelBrowser() {
  closeModelFavPopover();
  const container = document.getElementById('provider-model-browser');
  if (!state.activeProviderId) return;

  const provider = state.providers.find(item => item.id === state.activeProviderId);
  if (!provider) {
    container.innerHTML = state.modelsLoaded
      ? '<div class="provider-browser-empty">Provider not found. <a href="#providers">Return to providers</a></div>'
      : '<div class="provider-browser-empty">Loading models…</div>';
    return;
  }

  const showActions = !isServerAdminUi();
  const result = getProviderModelPage(provider.models ?? [], state.providerModelFilter, state.providerModelPage, {
    minContextWindow: state.providerModelMinCtx,
    freeOnly: state.providerModelFreeOnly,
    intelligenceSort: state.intelligenceActive ? state.intelligenceSort : null,
  });
  state.providerModelPage = result.page;
  const first = result.total === 0 ? 0 : (result.page - 1) * PROVIDER_MODEL_PAGE_SIZE + 1;
  const last = Math.min(result.page * PROVIDER_MODEL_PAGE_SIZE, result.total);
  const [c1, c2] = providerPalette(provider.id);
  const displayName = getProviderName(provider.id);

  container.innerHTML = `
    <a class="provider-browser-back" href="#providers">← Providers &amp; Keys</a>
    <div class="provider-browser-hero">
      <div class="provider-icon" style="background:linear-gradient(135deg,${c1},${c2})">${providerLogoHtml(provider.id, displayName)}</div>
      <div>
        <div class="section-eyebrow">Provider catalog</div>
        <h1 class="section-heading">${escapeHtml(displayName)} <span class="heading-accent">models</span></h1>
        <p class="section-sub">${(provider.models ?? []).filter(model => !model.hidden).length} models available${(provider.models ?? []).some(model => model.hidden) ? ` · ${(provider.models ?? []).filter(model => model.hidden).length} hidden` : ''} · prices shown per 1M tokens</p>
      </div>
    </div>
    ${provider.supportsManualModels ? '<div id="manual-model-panel"></div>' : ''}
    <div class="provider-browser-tools">
      <div class="search-field">
        <svg class="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input class="search-input" id="provider-model-search" type="search" value="${escapeHtml(state.providerModelFilter)}" placeholder="Search ${escapeHtml(displayName)} models…" aria-label="Search ${escapeHtml(displayName)} models">
      </div>
      <div class="provider-model-filters">
        <select class="filter-select" id="provider-model-ctx-select" aria-label="Filter by context window size">
          <option value="0" ${state.providerModelMinCtx === 0 ? 'selected' : ''}>All context sizes</option>
          <option value="128000" ${state.providerModelMinCtx === 128000 ? 'selected' : ''}>≥ 128k</option>
          <option value="200000" ${state.providerModelMinCtx === 200000 ? 'selected' : ''}>≥ 200k</option>
          <option value="500000" ${state.providerModelMinCtx === 500000 ? 'selected' : ''}>≥ 500k</option>
          <option value="1000000" ${state.providerModelMinCtx === 1000000 ? 'selected' : ''}>≥ 1M</option>
        </select>
        <label class="filter-checkbox-label">
          <input type="checkbox" id="provider-model-free-checkbox" ${state.providerModelFreeOnly ? 'checked' : ''}>
          <span>Free models only</span>
        </label>
      </div>
      ${provider.customEndpoint && showActions ? `<button class="btn btn-ghost" id="provider-model-measure" type="button" title="Check every model's real context size with the server (one small request per model)">${measureButtonLabel(provider.id)}</button>` : ''}
      <button class="btn btn-ghost" id="provider-model-refresh" type="button" ${state.manualModelForms.get(provider.id)?.pending ? 'disabled' : ''}>Refresh</button>
    </div>
    <div class="model-bulk-bar" id="model-bulk-bar">${bulkBarHtml(provider)}</div>
    <div class="provider-model-table-wrap">
      <table class="provider-model-table provider-model-table--catalog${state.intelligenceActive ? ' provider-model-table--intel' : ''}">
        <thead><tr><th class="th-select"><input type="checkbox" id="provider-model-select-page" aria-label="Select all models on this page" ${result.items.length > 0 && result.items.every(model => selectionFor(provider.id).has(model.id)) ? 'checked' : ''}></th><th>Model</th><th>Type</th><th>Context</th>${intelHeaderHtml()}<th>Price in / out <span tabindex="0" class="price-help" aria-label="About price estimates">ⓘ<span role="tooltip">Prices are estimates per 1M tokens and may not reflect the provider’s actual pricing or promotions. Check the provider’s pricing page. Reference estimates use another provider’s published rates.</span></span></th><th class="th-actions">Actions</th></tr></thead>
        <tbody>
          ${result.items.map(model => `
            <tr class="${model.hidden ? 'model-hidden' : ''}">
              <td class="td-select"><input type="checkbox" class="model-select" data-model-id="${escapeHtml(model.id)}" aria-label="Select ${escapeHtml(model.name || model.id)}" ${selectionFor(provider.id).has(model.id) ? 'checked' : ''}></td>
              <td><strong>${escapeHtml(model.name || model.id)}</strong>${model.source === 'manual' ? ' <span class="manual-model-badge">Manual</span>' : ''}<code>${escapeHtml(model.id)}</code></td>
              <td class="kind-cell" data-model-id="${escapeHtml(model.id)}">${kindCellHtml(provider.id, model, showActions)}</td>
              <td class="ctx-cell" data-model-id="${escapeHtml(model.id)}">${contextCellHtml(provider.id, model, showActions)}</td>
              ${intelCellHtml(model)}
              <td class="price-cell"><div class="price-stack">${formatModelPrice(model.cost, isFreeModel(model), freeBadgeLabel(model), model.referencePrice)}
                  ${(model.userMarkedFree || !isFreeModel(model)) ? `<button class="btn btn-ghost btn-model-mark-free${model.userMarkedFree ? ' is-marked' : ''}" type="button" data-model-id="${escapeHtml(model.id)}" aria-pressed="${model.userMarkedFree ? 'true' : 'false'}" title="${model.userMarkedFree ? 'Remove your free mark' : 'Treat this model as free, even if its listed price says otherwise. Relay cannot check this: if the provider bills you, that is on your account.'}">${model.userMarkedFree ? 'Unmark free' : 'Mark free'}</button>` : ''}
                </div></td>
                <td class="td-actions"><div class="model-actions">
                  <div class="test-stack">
                    <button class="btn btn-ghost btn-model-test" type="button" data-model-id="${escapeHtml(model.id)}" title="One small request, up to 1024 output tokens. Checks response and tool calling. No retries.">Test</button>
                    <span class="test-badge-slot" data-model-id="${escapeHtml(model.id)}">${testBadgeHtml(model.testResult)}</span>
                  </div>
                  <button class="btn-model-hide${model.hidden ? ' is-hidden' : ''}" type="button" data-model-id="${escapeHtml(model.id)}" aria-pressed="${model.hidden ? 'true' : 'false'}" title="${model.hidden ? 'Unhide' : 'Hide'}" aria-label="${model.hidden ? 'Unhide' : 'Hide'} ${escapeHtml(model.name || model.id)}">${model.hidden ? EYE_OFF_ICON : EYE_ICON}</button>
                  ${showActions ? `
                  <button class="btn-model-add" type="button" data-model-id="${escapeHtml(model.id)}" title="Add to favorites">+</button>
                  ${poolRowButton(provider.id, model)}
                  ` : ''}
                </div></td>
            </tr>
          `).join('') || `<tr><td colspan="6" class="provider-model-empty">No models match your search and filters.</td></tr>`}
        </tbody>
      </table>
    </div>
    <div class="provider-model-pagination">
      <span>${first}–${last} of ${result.total}</span>
      <div>
        <button class="btn btn-ghost" id="provider-model-prev" type="button" ${result.page <= 1 ? 'disabled' : ''}>Previous</button>
        <span>Page ${result.page} of ${result.totalPages}</span>
        <button class="btn btn-primary" id="provider-model-next" type="button" ${result.page >= result.totalPages ? 'disabled' : ''}>Next</button>
      </div>
    </div>
  `;

  if (provider.supportsManualModels) {
    document.getElementById('manual-model-panel').appendChild(buildManualModelPanel(provider));
  }

  bindIntelSort(container, () => { state.providerModelPage = 1; renderProviderModelBrowser(); });
  document.getElementById('provider-model-search').addEventListener('input', event => {
    state.providerModelFilter = event.target.value;
    state.providerModelPage = 1;
    renderProviderModelBrowser();
    const search = document.getElementById('provider-model-search');
    search?.focus();
    search?.setSelectionRange(search.value.length, search.value.length);
  });
  document.getElementById('provider-model-ctx-select')?.addEventListener('change', event => {
    state.providerModelMinCtx = parseInt(event.target.value, 10) || 0;
    state.providerModelPage = 1;
    renderProviderModelBrowser();
  });
  document.getElementById('provider-model-free-checkbox')?.addEventListener('change', event => {
    state.providerModelFreeOnly = event.target.checked;
    state.providerModelPage = 1;
    renderProviderModelBrowser();
  });
  if (showActions) {
    container.querySelectorAll('.btn-model-add').forEach(btn => {
      btn.addEventListener('click', event => {
        event.stopPropagation();
        const modelId = btn.dataset.modelId;
        toggleModelFavoriteMenu(btn, provider.id, modelId);
      });
    });
  }
  container.querySelectorAll('.btn-model-pool').forEach(button => {
    const action = button.classList.contains('is-pooled') ? 'remove' : 'add';
    button.addEventListener('click', () => toggleFreePoolModel(provider.id, button.dataset.modelId, button, action));
  });
  container.querySelectorAll('.btn-model-test').forEach(button => {
    button.addEventListener('click', () => testModelResponse(button, provider.id, button.dataset.modelId));
  });
  container.querySelectorAll('.btn-model-hide').forEach(button => {
    button.addEventListener('click', () => toggleModelHidden(provider.id, button.dataset.modelId));
  });
  container.querySelectorAll('.btn-model-mark-free').forEach(button => {
    button.addEventListener('click', () => toggleModelMarkedFree(provider.id, button.dataset.modelId));
  });
  container.querySelectorAll('.ctx-cell').forEach(cell => bindContextCell(cell, provider.id));
  container.querySelectorAll('.kind-cell').forEach(cell => bindKindCell(cell, provider.id));
  bindModelSelection(container, provider, result.items);
  document.getElementById('provider-model-measure')?.addEventListener('click', () => measureAllContextSizes(provider));
  document.getElementById('provider-model-prev').addEventListener('click', () => {
    state.providerModelPage -= 1;
    renderProviderModelBrowser();
  });
  document.getElementById('provider-model-next').addEventListener('click', () => {
    state.providerModelPage += 1;
    renderProviderModelBrowser();
  });
  document.getElementById('provider-model-refresh').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Refreshing…';
    const refreshed = await refreshProvider(provider.id);
    if (!refreshed.ok) {
      showToast(refreshed.error ?? 'Refresh failed');
      button.disabled = false;
      button.textContent = 'Refresh';
      return;
    }
    await initModels();
    renderProviders();
    renderProviderStats();
    renderProviderModelBrowser();
    showToast(`${refreshed.count} models refreshed`);
  });
}

const EYE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/></svg>';

// Hide/unhide one model. Hidden models drop out of every picker, "All provider models" and the server.
async function toggleModelHidden(providerId, modelId) {
  const provider = state.providers.find(item => item.id === providerId);
  const model = provider?.models?.find(item => item.id === modelId);
  if (!model) return;
  const hidden = !model.hidden;
  const result = await api('POST', '/api/providers/models/hide', { providerId, modelId, hidden });
  if (!result.ok) {
    showToast(result.error ?? 'Could not change this model');
    return;
  }
  if (hidden) model.hidden = true;
  else delete model.hidden;
  provider.modelCount = provider.models.filter(item => !item.hidden).length;
  state.allModels = flattenModelProviders(state.providers);
  state.appModelsByTarget = {};
  renderProviders();
  renderProviderModelBrowser();
  showToast(hidden ? `${model.name || modelId} hidden` : `${model.name || modelId} is visible again`);
}

// "Mark free": the user declares a model free (their own risk). Lets it join the Free Pool after a Test.
async function toggleModelMarkedFree(providerId, modelId) {
  const provider = state.providers.find(item => item.id === providerId);
  const model = provider?.models?.find(item => item.id === modelId);
  if (!model) return;
  const free = !model.userMarkedFree;
  const result = await api('POST', '/api/providers/models/mark-free', { providerId, modelId, free });
  if (!result.ok) {
    showToast(result.error ?? 'Could not change this model');
    return;
  }
  await initModels();
  renderProviders();
  renderProviderStats();
  renderProviderModelBrowser();
  showToast(free
    ? `${model.name || modelId} is now treated as free. Relay cannot verify this; if the provider bills you, that is on your account. Run Test before the pool uses it.`
    : `${model.name || modelId} is no longer marked free`);
}

const SAVE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>';
const CANCEL_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const PENCIL_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

function contextEditFor(providerId, modelId) {
  const edit = state.contextEdit;
  return edit && edit.providerId === providerId && edit.modelId === modelId ? edit : null;
}

// Context column: the size, a tag when it was typed or measured, and a pencil to edit it.
function contextCellHtml(providerId, model, showActions) {
  const edit = contextEditFor(providerId, model.id);
  if (edit) {
    return `<span class="ctx-edit">
        <input class="ctx-input" type="number" min="0" step="any" value="${escapeHtml(String(edit.value))}" aria-label="Context size for ${escapeHtml(model.name || model.id)}">
        <select class="ctx-unit" aria-label="Unit"><option value="K" ${edit.unit === 'K' ? 'selected' : ''}>K</option><option value="M" ${edit.unit === 'M' ? 'selected' : ''}>M</option></select>
        <button class="btn-ctx-icon btn-ctx-save" type="button" title="Save" aria-label="Save">${SAVE_ICON}</button>
        <button class="btn-ctx-icon btn-ctx-cancel" type="button" title="Cancel" aria-label="Cancel">${CANCEL_ICON}</button>
        ${model.contextWindowOverride ? '<button class="btn-ctx-icon btn-ctx-reset" type="button" title="Reset to the provider\'s size" aria-label="Reset">↺</button>' : ''}
      </span>`;
  }
  const pencil = showActions ? `<button class="btn-ctx-edit" type="button" title="Edit context size" aria-label="Edit context size">${PENCIL_ICON}</button>` : '';
  const [label, tip] = model.contextWindowOverride === 'user' ? ['manual', 'Set by you. Tests won\'t change it.']
    : model.contextWindowOverride === 'measured' ? ['measured', 'Measured from the server by a model test.']
    : model.contextWindowEstimate === 'models.dev' ? ['estimate', 'From models.dev (the model\'s usual size); this server may run a smaller limit. Use Measure context sizes or the pencil to confirm.']
    : model.contextWindowEstimate ? ['estimate', 'Relay\'s guess from the model name. Use Measure context sizes or the pencil to confirm.']
    : [null, null];
  const labelHtml = label ? `<span class="ctx-label ctx-label-${label}" title="${tip}">${label}</span>` : '';
  return `${fmtCtx(model.contextWindow) || '—'}${pencil}${labelHtml}`;
}

function bindContextCell(cell, providerId) {
  const modelId = cell.dataset.modelId;
  const provider = state.providers.find(item => item.id === providerId);
  const model = provider?.models?.find(item => item.id === modelId);
  if (!model) return;
  const rerender = () => {
    cell.innerHTML = contextCellHtml(providerId, model, !isServerAdminUi());
    bindContextCell(cell, providerId);
  };
  cell.querySelector('.btn-ctx-edit')?.addEventListener('click', () => {
    const size = model.contextWindow ?? 0;
    const unit = size >= 1_000_000 ? 'M' : 'K';
    const value = size ? Number((size / (unit === 'M' ? 1_000_000 : 1_000)).toFixed(3)) : '';
    state.contextEdit = { providerId, modelId, value, unit };
    rerender();
    cell.querySelector('.ctx-input')?.focus();
  });
  const input = cell.querySelector('.ctx-input');
  const unitSelect = cell.querySelector('.ctx-unit');
  const save = async () => {
    const amount = Number(input.value);
    const contextWindow = Math.round(amount * (unitSelect.value === 'M' ? 1_000_000 : 1_000));
    if (!Number.isFinite(amount) || amount <= 0) { showToast('Enter a size greater than zero'); input.focus(); return; }
    const result = await api('POST', '/api/providers/models/context', { providerId, modelId, contextWindow });
    if (!result.ok) { showToast(result.error ?? 'Could not save the context size'); return; }
    model.contextWindow = result.contextWindow;
    model.contextWindowOverride = 'user';
    delete model.contextWindowEstimate;
    state.contextEdit = null;
    state.appModelsByTarget = {};
    rerender();
    showToast(`${model.name || modelId}: context set to ${fmtCtx(result.contextWindow)}`);
  };
  input?.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); save(); }
    if (event.key === 'Escape') { state.contextEdit = null; rerender(); }
  });
  cell.querySelector('.btn-ctx-save')?.addEventListener('click', save);
  cell.querySelector('.btn-ctx-cancel')?.addEventListener('click', () => { state.contextEdit = null; rerender(); });
  cell.querySelector('.btn-ctx-reset')?.addEventListener('click', async () => {
    const result = await api('POST', '/api/providers/models/context', { providerId, modelId, contextWindow: null });
    if (!result.ok) { showToast(result.error ?? 'Could not reset the context size'); return; }
    state.contextEdit = null;
    state.appModelsByTarget = {};
    await initModels();
    renderProviderModelBrowser();
    showToast(`${model.name || modelId}: context size reset`);
  });
}

// After a Test: reflect a measured context size in the row without redrawing the whole table.
function applyTestContextResult(providerId, modelId, context) {
  if (!context?.updated && !context?.saved) return;
  const provider = state.providers.find(item => item.id === providerId);
  const model = provider?.models?.find(item => item.id === modelId);
  if (!model) return;
  model.contextWindow = context.measured;
  model.contextWindowOverride = 'measured';
  delete model.contextWindowEstimate;
  state.appModelsByTarget = {};
  const cell = document.querySelector(`.ctx-cell[data-model-id="${CSS.escape(modelId)}"]`);
  if (cell && !contextEditFor(providerId, modelId)) {
    cell.innerHTML = contextCellHtml(providerId, model, !isServerAdminUi());
    bindContextCell(cell, providerId);
  }
}

const KIND_INFO = {
  chat: ['💬', 'Chat'],
  embedding: ['🔢', 'Embedding'],
  reranking: ['🔀', 'Reranking'],
  classifier: ['🛡️', 'Classifier'],
  image: ['🖼️', 'Image'],
  video: ['🎬', 'Video'],
  audio: ['🔊', 'Audio'],
  'not-chat': ['⛔', 'Not chat'],
};
const KIND_CHOICES = ['chat', 'embedding', 'reranking', 'classifier', 'image', 'video', 'audio'];

function kindEditFor(providerId, modelId) {
  const edit = state.kindEdit;
  return edit && edit.providerId === providerId && edit.modelId === modelId ? edit : null;
}

// Type column: icon + name, where it came from, and a pencil to set it by hand.
function kindCellHtml(providerId, model, showActions) {
  const edit = kindEditFor(providerId, model.id);
  if (edit) {
    return `<span class="ctx-edit">
        <select class="ctx-unit kind-select" aria-label="Model type for ${escapeHtml(model.name || model.id)}">
          ${KIND_CHOICES.map(kind => `<option value="${kind}" ${edit.kind === kind ? 'selected' : ''}>${KIND_INFO[kind][0]} ${KIND_INFO[kind][1]}</option>`).join('')}
        </select>
        <button class="btn-ctx-icon btn-kind-save" type="button" title="Save" aria-label="Save">${SAVE_ICON}</button>
        <button class="btn-ctx-icon btn-kind-cancel" type="button" title="Cancel" aria-label="Cancel">${CANCEL_ICON}</button>
        ${model.kindSource === 'manual' ? '<button class="btn-ctx-icon btn-kind-reset" type="button" title="Reset to the detected type" aria-label="Reset">↺</button>' : ''}
      </span>`;
  }
  const info = KIND_INFO[model.kind];
  const shown = info ? `<span class="kind-icon" aria-hidden="true">${info[0]}</span>${info[1]}` : '<span class="kind-unknown">❔ Unknown</span>';
  const pencil = showActions ? `<button class="btn-ctx-edit btn-kind-edit" type="button" title="Set model type" aria-label="Set model type">${PENCIL_ICON}</button>` : '';
  const [label, tip] = model.kindSource === 'manual' ? ['manual', 'Set by you.']
    : model.kindSource === 'test' ? ['tested', model.kind === 'chat' ? 'A Test got a chat reply from this model.' : 'A Test found the server refuses chat requests for this model.']
    : model.kindSource === 'models.dev' ? ['models.dev', 'Type listed on models.dev for this model.']
    : model.kindSource === 'name' ? ['name guess', 'Guessed from the model name. Run Test, or set it with the pencil.']
    : [null, 'Unknown type. Run Test, or set it with the pencil.'];
  const labelHtml = label ? `<span class="ctx-label" title="${tip}">${label}</span>` : '';
  return `<span title="${tip}">${shown}</span>${pencil}${labelHtml}`;
}

function bindKindCell(cell, providerId) {
  const modelId = cell.dataset.modelId;
  const provider = state.providers.find(item => item.id === providerId);
  const model = provider?.models?.find(item => item.id === modelId);
  if (!model) return;
  const rerender = () => {
    cell.innerHTML = kindCellHtml(providerId, model, !isServerAdminUi());
    bindKindCell(cell, providerId);
  };
  cell.querySelector('.btn-kind-edit')?.addEventListener('click', () => {
    state.kindEdit = { providerId, modelId, kind: KIND_CHOICES.includes(model.kind) ? model.kind : 'chat' };
    rerender();
    cell.querySelector('.kind-select')?.focus();
  });
  const select = cell.querySelector('.kind-select');
  const save = async () => {
    const kind = select.value;
    const result = await api('POST', '/api/providers/models/kind', { providerId, modelId, kind });
    if (!result.ok) { showToast(result.error ?? 'Could not save the model type'); return; }
    model.kind = kind;
    model.kindSource = 'manual';
    state.kindEdit = null;
    rerender();
    showToast(`${model.name || modelId}: type set to ${KIND_INFO[kind][1]}`);
  };
  select?.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); save(); }
    if (event.key === 'Escape') { state.kindEdit = null; rerender(); }
  });
  cell.querySelector('.btn-kind-save')?.addEventListener('click', save);
  cell.querySelector('.btn-kind-cancel')?.addEventListener('click', () => { state.kindEdit = null; rerender(); });
  cell.querySelector('.btn-kind-reset')?.addEventListener('click', async () => {
    const result = await api('POST', '/api/providers/models/kind', { providerId, modelId, kind: null });
    if (!result.ok) { showToast(result.error ?? 'Could not reset the model type'); return; }
    state.kindEdit = null;
    await initModels();
    renderProviderModelBrowser();
    showToast(`${model.name || modelId}: type reset`);
  });
}

// Name-guessed kinds that still reply to chat (safety, media) keep their type after a passing Test.
const NAME_KINDS_OVER_CHAT_TEST = ['classifier', 'image', 'video', 'audio'];

// After a Test/Measure: a refusal marks the model "not chat", a chat reply marks it chat (a manual type is kept).
function applyTestKindResult(providerId, modelId, notChat) {
  if (typeof notChat !== 'boolean') return;
  const provider = state.providers.find(item => item.id === providerId);
  const model = provider?.models?.find(item => item.id === modelId);
  if (!model || model.kindSource === 'manual') return;
  if (!notChat && model.kindSource === 'name' && NAME_KINDS_OVER_CHAT_TEST.includes(model.kind)) return;
  model.kind = notChat ? 'not-chat' : 'chat';
  model.kindSource = 'test';
  const cell = document.querySelector(`.kind-cell[data-model-id="${CSS.escape(modelId)}"]`);
  if (cell && !kindEditFor(providerId, modelId)) {
    cell.innerHTML = kindCellHtml(providerId, model, !isServerAdminUi());
    bindKindCell(cell, providerId);
  }
}

function selectionFor(providerId) {
  if (!state.modelSelection.has(providerId)) state.modelSelection.set(providerId, new Set());
  return state.modelSelection.get(providerId);
}

const isKnownNonChat = model => Boolean(model.kind) && model.kind !== 'chat';

function bulkBarHtml(provider) {
  const selected = selectionFor(provider.id);
  const nonChat = (provider.models ?? []).filter(model => isKnownNonChat(model) && !model.hidden).length;
  const select = `<button class="btn btn-ghost" id="model-select-non-chat" type="button" ${nonChat ? '' : 'disabled'} title="Tick every visible model whose type is known and is not chat, so you can review before hiding">Select non-chat (${nonChat})</button>`;
  if (selected.size === 0) return select;
  return `${select}
    <span class="model-bulk-count">${selected.size} selected</span>
    <button class="btn btn-ghost" id="model-bulk-hide" type="button">Hide</button>
    <button class="btn btn-ghost" id="model-bulk-unhide" type="button">Unhide</button>
    <button class="btn btn-ghost" id="model-bulk-clear" type="button">Clear</button>`;
}

function bindModelSelection(container, provider, pageItems) {
  const selected = selectionFor(provider.id);
  container.querySelectorAll('.model-select').forEach(box => {
    box.addEventListener('change', () => {
      if (box.checked) selected.add(box.dataset.modelId);
      else selected.delete(box.dataset.modelId);
      renderProviderModelBrowser();
    });
  });
  document.getElementById('provider-model-select-page')?.addEventListener('change', event => {
    for (const model of pageItems) {
      if (event.target.checked) selected.add(model.id);
      else selected.delete(model.id);
    }
    renderProviderModelBrowser();
  });
  document.getElementById('model-select-non-chat')?.addEventListener('click', () => {
    for (const model of provider.models ?? []) if (isKnownNonChat(model) && !model.hidden) selected.add(model.id);
    renderProviderModelBrowser();
  });
  document.getElementById('model-bulk-clear')?.addEventListener('click', () => { selected.clear(); renderProviderModelBrowser(); });
  const bulk = async hidden => {
    const modelIds = [...selected];
    const result = await api('POST', '/api/providers/models/hide-many', { providerId: provider.id, modelIds, hidden });
    if (!result.ok) { showToast(result.error ?? 'Could not change these models'); return; }
    for (const model of provider.models ?? []) {
      if (!selected.has(model.id)) continue;
      if (hidden) model.hidden = true;
      else delete model.hidden;
    }
    selected.clear();
    provider.modelCount = provider.models.filter(item => !item.hidden).length;
    state.allModels = flattenModelProviders(state.providers);
    state.appModelsByTarget = {};
    renderProviders();
    renderProviderModelBrowser();
    showToast(`${modelIds.length} model${modelIds.length === 1 ? '' : 's'} ${hidden ? 'hidden' : 'visible again'}`);
  };
  document.getElementById('model-bulk-hide')?.addEventListener('click', () => bulk(true));
  document.getElementById('model-bulk-unhide')?.addEventListener('click', () => bulk(false));
}

const MEASURE_CONCURRENCY = 3;

function measureButtonLabel(providerId) {
  const run = state.contextMeasure;
  return run && run.providerId === providerId ? `Measuring ${run.done}/${run.total}… Cancel` : 'Measure context sizes';
}

function updateMeasureButton(providerId) {
  const button = document.getElementById('provider-model-measure');
  if (button) button.textContent = measureButtonLabel(providerId);
}

// Free size check for every visible model of a custom endpoint, a few at a time, after the user confirms.
async function measureAllContextSizes(provider) {
  const running = state.contextMeasure;
  if (running) {
    if (running.providerId === provider.id) {
      running.cancelled = true;
      running.controllers.forEach(controller => controller.abort());
    } else {
      showToast(`Already measuring ${getProviderName(running.providerId)}. Wait for it to finish or cancel it there.`);
    }
    return;
  }
  const models = (provider.models ?? []).filter(model => !model.hidden);
  if (models.length === 0) return;
  const confirmed = window.confirm(
    `This sends ${models.length} small request${models.length === 1 ? '' : 's'} to ${getProviderName(provider.id)}, one per model, `
    + 'asking each server for its real context size. Hidden models are skipped and manual sizes are kept.\n\nContinue?',
  );
  if (!confirmed) return;

  const run = { providerId: provider.id, done: 0, total: models.length, cancelled: false, controllers: new Set() };
  state.contextMeasure = run;
  updateMeasureButton(provider.id);
  const tally = { updated: 0, confirmed: 0, kept: 0, unknown: 0, notChat: 0 };
  let next = 0;
  const worker = async () => {
    while (!run.cancelled && next < models.length) {
      const model = models[next++];
      const controller = new AbortController();
      run.controllers.add(controller);
      try {
        const response = await fetch('/api/providers/models/measure-context', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providerId: provider.id, modelId: model.id }),
          signal: controller.signal,
        });
        const result = await response.json();
        const context = result.ok ? result.context : undefined;
        applyTestKindResult(provider.id, model.id, context?.notChat);
        if (context?.notChat) tally.notChat++;
        if (context?.updated) { tally.updated++; applyTestContextResult(provider.id, model.id, context); }
        else if (context?.saved) { tally.confirmed++; applyTestContextResult(provider.id, model.id, context); }
        else if (context?.keptManual) tally.kept++;
        else if (context?.measured !== undefined) tally.confirmed++;
        else tally.unknown++;
      } catch {
        if (!run.cancelled) tally.unknown++;
      } finally {
        run.controllers.delete(controller);
        if (!run.cancelled) run.done++;
        updateMeasureButton(provider.id);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MEASURE_CONCURRENCY, models.length) }, worker));
  state.contextMeasure = null;
  updateMeasureButton(provider.id);
  const summary = `${tally.updated} updated · ${tally.confirmed} confirmed · ${tally.unknown} not reported${tally.kept ? ` · ${tally.kept} manual kept` : ''}${tally.notChat ? ` · ${tally.notChat} not chat` : ''}`;
  showToast(run.cancelled ? `Measuring stopped (${run.done}/${run.total}) · ${summary}` : `Context sizes: ${summary}`);
}

function contextTestNote(context) {
  if (!context || context.measured === undefined) return '';
  if (context.updated) return ` · context ${fmtCtx(context.previous) || 'unknown'} → ${fmtCtx(context.measured)} (saved)`;
  if (context.keptManual) return ` · server reports ${fmtCtx(context.measured)} context; kept your manual size`;
  if (context.saved) return ` · context ${fmtCtx(context.measured)} confirmed (now measured)`;
  return ` · context ${fmtCtx(context.measured)} confirmed`;
}

async function testModelResponse(button, providerId, modelId, options = {}) {
  button.disabled = true;
  button.textContent = 'Testing…';
  button.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('/api/providers/models/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId, modelId }),
    });
    const result = await response.json();
    const testResult = { ok: Boolean(result.ok), at: new Date().toISOString(), ...(result.ok ? { latencyMs: result.latencyMs, toolsPassed: result.toolsPassed } : { error: result.error, ...(result.transient ? { transient: true } : {}) }) };
    const testedModel = state.providers.find(item => item.id === providerId)?.models?.find(item => item.id === modelId);
    if (testedModel) testedModel.testResult = testResult;
    document.querySelectorAll(`.test-badge-slot[data-model-id="${CSS.escape(modelId)}"]`).forEach(slot => { slot.innerHTML = testBadgeHtml(testResult); });
    button.textContent = formatModelTestLabel(result);
    button.title = result.ok ? `Responded in ${(result.latencyMs / 1000).toFixed(1)}s` : result.error;
    if (result.ok) applyTestContextResult(providerId, modelId, result.context);
    applyTestKindResult(providerId, modelId, result.notChat ?? result.context?.notChat);
    const pool = result.pool;
    const capabilityNote = result.ok ? (result.toolsPassed ? ' · tool calling passed' : ' · tool calling not confirmed') : '';
    const poolNote = pool?.status === 'verified' ? ' · verified for the Relay Free Pool'
      : pool?.reason ? ` · pool: ${pool.reason}` : '';
    const message = result.ok
      ? `${modelId} responded in ${(result.latencyMs / 1000).toFixed(1)}s${capabilityNote}${contextTestNote(result.context)}${poolNote}`
      : `${modelId}: ${result.error || 'Test failed'}`;
    showToast(message, undefined, poolNote ? 5000 : 2200);
    if (pool || options.pool || poolMember(providerId, modelId)) await loadFreePool();
  } catch {
    button.textContent = 'Retry test';
    showToast('Could not complete the model test. Check the connection and try again.');
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

function buildManualModelPanel(provider) {
  let draft = state.manualModelForms.get(provider.id);
  if (!draft) {
    draft = { modelId: '', displayName: '', contextWindow: '', pending: false, message: '', status: '' };
    state.manualModelForms.set(provider.id, draft);
  }
  const panel = document.createElement('section');
  panel.className = 'manual-model-panel';
  const heading = document.createElement('h2');
  heading.textContent = 'Add model manually';
  const note = document.createElement('p');
  note.className = 'section-sub';
  note.id = 'manual-model-note';
  note.textContent = 'Validation makes 3 small API calls and may incur provider charges. The model is saved only after all checks pass.';
  const form = document.createElement('form');
  form.className = 'manual-model-form';
  form.setAttribute('aria-describedby', note.id);
  for (const [name, labelText, type] of [
    ['modelId', 'Model ID (required)', 'text'],
    ['displayName', 'Display name (optional)', 'text'],
    ['contextWindow', 'Context tokens (optional)', 'number'],
  ]) {
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.className = 'key-input';
    input.name = name;
    input.type = type;
    input.value = draft[name];
    input.disabled = draft.pending;
    input.required = name === 'modelId';
    if (type === 'number') { input.min = '1'; input.step = '1'; input.max = String(Number.MAX_SAFE_INTEGER); }
    input.addEventListener('input', () => { draft[name] = input.value; });
    label.appendChild(input);
    form.appendChild(label);
  }
  const addButton = document.createElement('button');
  addButton.type = 'submit';
  addButton.className = 'btn btn-primary';
  addButton.textContent = draft.pending ? 'Please wait…' : 'Test & Add';
  addButton.disabled = draft.pending;
  form.appendChild(addButton);
  const feedback = document.createElement('div');
  feedback.className = `key-feedback ${draft.status}`;
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  feedback.textContent = draft.message;
  panel.append(heading, note, form, feedback);

  async function perform(action, modelId, payload = {}) {
    if (draft.pending) return;
    draft.pending = true;
    draft.status = 'muted';
    draft.message = action === 'add' ? 'Validating model with the provider… This may take a moment.' : 'Removing manual entry…';
    renderProviderModelBrowser();
    try {
      const result = await api('POST', `/api/providers/models/${action}`, { providerId: provider.id, modelId, ...payload });
      if (!result.ok) {
        draft.status = 'error';
        draft.message = result.error || 'The operation failed. Please try again.';
        return;
      }
      draft.status = 'success';
      draft.message = action === 'add' ? `✓ ${modelId} validated and added.` : `✓ Manual entry for ${modelId} removed.`;
      if (action === 'add') {
        draft.modelId = '';
        draft.displayName = '';
        draft.contextWindow = '';
        if (state.activeProviderId === provider.id) {
          state.providerModelFilter = '';
          state.providerModelMinCtx = 0;
          state.providerModelFreeOnly = false;
          state.providerModelPage = 1;
        }
      }
      state.appModelsByTarget = {};
      await initModels();
      if (state.modelsError) draft.message += ' Catalog reload failed; refresh the model list to see the change.';
      renderProviders();
      renderFavList();
      if (!isServerAdminUi()) {
        renderCodexSubagentList();
        renderApps();
      }
    } catch {
      draft.status = 'error';
      draft.message = 'Could not complete the request. Refresh the model list to check whether it saved before retrying.';
    } finally {
      draft.pending = false;
      renderProviderModelBrowser();
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (draft.pending || !form.reportValidity()) return;
    const modelId = draft.modelId.trim();
    const contextWindow = draft.contextWindow === '' ? undefined : Number(draft.contextWindow);
    if (!modelId || (contextWindow !== undefined && (!Number.isSafeInteger(contextWindow) || contextWindow <= 0))) {
      draft.status = 'error';
      draft.message = 'Enter a model ID and, if provided, a positive whole number of context tokens.';
      renderProviderModelBrowser();
      return;
    }
    void perform('add', modelId, {
      ...(draft.displayName.trim() ? { displayName: draft.displayName.trim() } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
    });
  });

  for (const model of provider.manualModels ?? []) {
    const row = document.createElement('div');
    row.className = 'manual-model-entry';
    const badge = document.createElement('span');
    badge.className = 'manual-model-badge';
    badge.textContent = 'Manual';
    const label = document.createElement('span');
    label.className = 'manual-model-entry-name';
    label.textContent = `${model.name || model.id}${model.name && model.name !== model.id ? ` (${model.id})` : ''}`;
    label.title = model.validatedAt ? `Validated ${model.validatedAt}` : '';
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'btn btn-ghost';
    removeButton.textContent = 'Remove manual entry';
    removeButton.setAttribute('aria-label', `Remove manual entry for ${model.id}`);
    removeButton.disabled = draft.pending;
    removeButton.addEventListener('click', () => {
      if (draft.pending || !window.confirm(`Remove the manual entry for ${model.id}? If the provider also lists this model, its discovered entry will remain.`)) return;
      void perform('remove', model.id);
    });
    row.append(badge, label, removeButton);
    panel.appendChild(row);
  }
  return panel;
}

function buildTemplateCard(template) {
  const [c1, c2] = providerPalette(template.id);
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
    <div class="provider-icon" style="background:linear-gradient(135deg,${c1},${c2})">${providerLogoHtml(template.id, template.name)}</div>
    <div class="provider-info">
      <div class="provider-name">${template.name}</div>
      <div class="provider-models-count">${template.addAnother ? 'Already set up · add another account' : 'Not configured'} ${signupLink}</div>
    </div>
    <div class="provider-status">
      <span class="status-chip no-key">${template.addAnother ? 'Add another' : 'Add provider'}</span>
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

// Opt-in "trust this computer's certificates" (corporate/VPN endpoints signed by an
// internal CA). Saved globally; applies at once without restarting Relay.
function buildTrustCertsToggle(feedback) {
  const wrap = document.createElement('div');
  wrap.className = 'trust-certs-row';
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--text-muted,#aaa)';

  const label = document.createElement('label');
  label.style.cssText = 'display:flex;gap:8px;align-items:center;cursor:pointer';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.disabled = true;
  const text = document.createElement('span');
  text.textContent = "Trust this computer's certificates (advanced)";
  label.appendChild(box);
  label.appendChild(text);

  const note = document.createElement('div');
  note.style.cssText = 'margin-left:24px';
  note.textContent = 'Needed for company servers behind a VPN that your browser trusts but Relay does not. Only turn on if you trust this computer.';

  wrap.appendChild(label);
  wrap.appendChild(note);

  let notice = '';
  api('GET', '/api/config').then(cfg => {
    box.checked = cfg.trustSystemCertificates === true;
    box.disabled = cfg.systemCertificatesSupported === false;
    notice = cfg.trustSystemCertificatesNotice ?? '';
    if (box.disabled) note.textContent = 'Not available on this Node version. Update Node to 22.19 or newer.';
  }).catch(() => {});

  box.addEventListener('change', async () => {
    const enable = box.checked;
    if (enable && !window.confirm(`${notice}\n\nTurn it on?`)) { box.checked = false; return; }
    box.disabled = true;
    const result = await api('POST', '/api/config', { trustSystemCertificates: enable });
    box.disabled = false;
    if (result.error) {
      box.checked = !enable;
      feedback.textContent = result.error;
      feedback.className = 'key-feedback error';
      return;
    }
    feedback.textContent = enable
      ? "✓ Trusting this computer's certificates. Click Add Provider to try again."
      : 'Certificate trust turned off.';
    feedback.className = 'key-feedback success';
  });

  return wrap;
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
  content.appendChild(buildTrustCertsToggle(feedback));
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

    let result = await api('POST', '/api/providers/add-custom', { kind, displayName, baseUrl, apiKey, headers });

    if (!result.ok && result.duplicateOf) {
      const proceed = window.confirm(
        `You already have a backend with the same URL, key and headers (${result.duplicateOf}).\n\nAdd another anyway?`,
      );
      if (!proceed) {
        addBtn.disabled = false;
        feedback.textContent = 'Cancelled.';
        feedback.className = 'key-feedback muted';
        return;
      }
      feedback.textContent = 'Connecting and fetching models…';
      result = await api('POST', '/api/providers/add-custom', {
        kind, displayName, baseUrl, apiKey, headers, confirmDuplicate: true,
      });
    }

    addBtn.disabled = false;
    if (result.ok) {
      feedback.textContent = `✓ ${displayName} added · ${result.count} models available${result.incomplete ? ` · ⚠ ${result.incomplete}` : ''}`;
      feedback.className = result.incomplete ? 'key-feedback muted' : 'key-feedback success';
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

function setOAuthFeedback(feedback, message, tone = '') {
  feedback.replaceChildren();
  feedback.className = `key-feedback${tone ? ` ${tone}` : ''}`;
  feedback.textContent = message;
}

function createDeviceAuthorizationPanel(url, userCode) {
  const panel = document.createElement('section');
  panel.className = 'oauth-device-panel';
  panel.setAttribute('aria-label', 'Device authorization');

  const eyebrow = document.createElement('div');
  eyebrow.className = 'oauth-device-eyebrow';
  eyebrow.textContent = 'One-time device code';

  const codeRow = document.createElement('div');
  codeRow.className = 'oauth-device-code-row';

  const code = document.createElement('code');
  code.className = 'oauth-device-code';
  code.textContent = userCode;
  code.setAttribute('aria-label', `Device code ${userCode}`);

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'btn btn-ghost oauth-device-copy';
  copyButton.textContent = 'Copy code';
  copyButton.addEventListener('click', async () => {
    try {
      await copyDeviceCode(userCode);
      copyButton.textContent = 'Copied ✓';
      setTimeout(() => { copyButton.textContent = 'Copy code'; }, 1800);
    } catch {
      copyButton.textContent = 'Copy failed';
      setTimeout(() => { copyButton.textContent = 'Copy code'; }, 1800);
    }
  });

  codeRow.append(code, copyButton);

  const instructions = document.createElement('ol');
  instructions.className = 'oauth-device-steps';
  for (const step of [
    'Copy the code above.',
    'Open the secure sign-in page.',
    'Paste the code there and approve access.',
  ]) {
    const item = document.createElement('li');
    item.textContent = step;
    instructions.appendChild(item);
  }

  const actions = document.createElement('div');
  actions.className = 'oauth-device-actions';

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'btn btn-primary';
  openButton.textContent = 'Open sign-in page ↗';

  const waiting = document.createElement('div');
  waiting.className = 'oauth-device-waiting';
  waiting.setAttribute('role', 'status');
  waiting.textContent = 'Waiting for you to finish sign-in…';

  openButton.addEventListener('click', () => {
    window.open(url, '_blank', 'noopener,noreferrer');
    waiting.textContent = 'Sign-in page opened. Paste the code, then return here…';
  });

  actions.append(openButton, waiting);
  panel.append(eyebrow, codeRow, instructions, actions);
  return panel;
}

// Polls the sign-in session until it finishes, then reports the outcome in `feedback`.
function pollOAuthSession({ sessionId, signInButton, refreshButton, feedback, onDone }) {
  let pollInFlight = false;
  const pollInterval = setInterval(async () => {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      const statusResult = await api('GET', `/api/providers/oauth/status?sessionId=${encodeURIComponent(sessionId)}`);
      if (statusResult.status === 'done') {
        clearInterval(pollInterval);
        setOAuthFeedback(feedback, '✓ Signed in successfully', 'success');
        try {
          await onDone();
        } catch {
          setOAuthFeedback(feedback, 'Signed in, but the provider list could not reload. Refresh the page to continue.', 'error');
        }
      } else if (statusResult.status === 'error' || statusResult.error) {
        clearInterval(pollInterval);
        const message = statusResult.status === 'error'
          ? (statusResult.error ?? 'Authorization failed')
          : 'Session expired — please try again';
        setOAuthFeedback(feedback, message, 'error');
        signInButton.disabled = false;
        if (refreshButton) refreshButton.disabled = false;
      }
    } catch {
      clearInterval(pollInterval);
      setOAuthFeedback(feedback, 'Lost contact with the sign-in session. Please try again.', 'error');
      signInButton.disabled = false;
      if (refreshButton) refreshButton.disabled = false;
    } finally {
      pollInFlight = false;
    }
  }, 2000);
}

// Browser sign-in: the page opens only when the user clicks the button. Antigravity returns to this
// server by itself; Claude Code shows a code on Anthropic's page that the user pastes into the box
// (`codeSessionId` is set for that case).
function showBrowserSignInPrompt(feedback, authUrl, codeSessionId = null) {
  const note = document.createElement('div');
  note.textContent = codeSessionId
    ? 'Open the sign-in page, sign in with the account you want, then copy the code Anthropic shows and paste it below.'
    : 'Open the Google sign-in page, finish signing in there, and this page updates by itself.';
  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'btn btn-primary';
  openButton.textContent = codeSessionId ? 'Open Claude sign-in' : 'Open Google sign-in';
  openButton.style.marginTop = '8px';
  openButton.addEventListener('click', () => {
    window.open(authUrl, '_blank', 'noopener,noreferrer');
  });

  // Sign-in pages reuse whichever account the browser is already logged into. To add a different
  // account, the link can be copied into a private window or another browser.
  const copyLinkButton = document.createElement('button');
  copyLinkButton.type = 'button';
  copyLinkButton.className = 'btn btn-ghost';
  copyLinkButton.textContent = 'Copy sign-in link';
  copyLinkButton.style.cssText = 'margin-top:8px;margin-left:8px';
  copyLinkButton.addEventListener('click', async () => {
    try {
      await copyTextToClipboard(authUrl);
      copyLinkButton.textContent = 'Copied ✓';
    } catch {
      copyLinkButton.textContent = 'Copy failed';
    }
    setTimeout(() => { copyLinkButton.textContent = 'Copy sign-in link'; }, 1800);
  });
  const privateHint = document.createElement('div');
  privateHint.className = 'oauth-device-note';
  privateHint.style.marginTop = '6px';
  privateHint.textContent = 'Signing in as a different account than your browser\'s? Paste the link into a private window.';
  const parts = [note, openButton, copyLinkButton, privateHint];

  if (codeSessionId) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px';
    const codeInput = document.createElement('input');
    codeInput.type = 'text';
    codeInput.className = 'key-input';
    codeInput.placeholder = 'Paste the code from Anthropic…';
    codeInput.autocomplete = 'off';
    codeInput.style.flex = '1';
    codeInput.style.minWidth = '220px';
    const submitButton = document.createElement('button');
    submitButton.type = 'button';
    submitButton.className = 'btn btn-ghost';
    submitButton.textContent = 'Submit code';
    const codeFeedback = document.createElement('div');
    codeFeedback.className = 'key-feedback';
    const submit = async () => {
      const code = codeInput.value.trim();
      if (!code) {
        codeFeedback.textContent = 'Paste the code first.';
        codeFeedback.className = 'key-feedback error';
        return;
      }
      submitButton.disabled = true;
      const result = await api('POST', '/api/providers/oauth/code', { sessionId: codeSessionId, code });
      if (result.ok) {
        codeInput.disabled = true;
        codeFeedback.textContent = 'Checking the code…';
        codeFeedback.className = 'key-feedback muted';
      } else {
        submitButton.disabled = false;
        codeFeedback.textContent = result.error ?? 'Could not submit the code';
        codeFeedback.className = 'key-feedback error';
      }
    };
    submitButton.addEventListener('click', submit);
    codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    row.append(codeInput, submitButton);
    parts.push(row, codeFeedback);
  }

  feedback.replaceChildren(...parts);
  feedback.className = 'key-feedback muted';
}

async function beginDeviceOAuthFlow({ providerId, addAccount = false, signInButton, refreshButton, feedback, onDone }) {
  const reenable = () => {
    signInButton.disabled = false;
    if (refreshButton) refreshButton.disabled = false;
  };
  signInButton.disabled = true;
  if (refreshButton) refreshButton.disabled = true;
  setOAuthFeedback(feedback, 'Preparing a secure one-time code…', 'muted');

  let startResult;
  try {
    startResult = await api('POST', '/api/providers/oauth/start', { providerId, ...(addAccount ? { addAccount: true } : {}) });
    // Subscription sign-ins (Antigravity) need an explicit risk acknowledgement, as in the terminal.
    if (startResult.needsConfirmation) {
      const { title, lines } = startResult.risk;
      if (!window.confirm(`${title}\n\n${lines.join('\n\n')}\n\nAccept the risk and continue?`)) {
        feedback.textContent = '';
        feedback.className = 'key-feedback';
        reenable();
        return;
      }
      startResult = await api('POST', '/api/providers/oauth/start', { providerId, acceptRisk: true, ...(addAccount ? { addAccount: true } : {}) });
    }
  } catch {
    setOAuthFeedback(feedback, 'Could not start sign-in. Check the connection and try again.', 'error');
    reenable();
    return;
  }
  if (startResult.error) {
    setOAuthFeedback(feedback, startResult.error, 'error');
    reenable();
    return;
  }

  if (startResult.pkce) {
    if (!startResult.sessionId || !startResult.authUrl) {
      setOAuthFeedback(feedback, 'The provider did not return a usable sign-in page. Please try again.', 'error');
      reenable();
      return;
    }
    showBrowserSignInPrompt(feedback, startResult.authUrl, startResult.needsCode ? startResult.sessionId : null);
    pollOAuthSession({ sessionId: startResult.sessionId, signInButton, refreshButton, feedback, onDone });
    return;
  }

  const { sessionId, url, userCode } = startResult;
  if (!sessionId || !url || !userCode) {
    setOAuthFeedback(feedback, 'The provider did not return a usable device code. Please try again.', 'error');
    reenable();
    return;
  }

  feedback.replaceChildren(createDeviceAuthorizationPanel(url, userCode));
  feedback.className = 'key-feedback oauth-device-host';
  pollOAuthSession({ sessionId, signInButton, refreshButton, feedback, onDone });
}

function buildOAuthTemplateBodyContent(template) {
  const content = document.createElement('div');
  content.className = 'provider-body-content';

  const note = document.createElement('div');
  note.className = 'oauth-device-note';
  note.textContent = template.subscriptionRisk
    ? 'Sign in with your subscription account — no API key required. This uses a paid subscription outside its official app, which may put that account at risk. You will be asked to confirm before sign-in starts.'
    : 'Sign in with a one-time device code — no API key required.';

  const actionRow = document.createElement('div');
  actionRow.className = 'key-row';

  const signInBtn = document.createElement('button');
  signInBtn.className = 'btn btn-primary';
  signInBtn.textContent = 'Get sign-in code';

  const feedback = document.createElement('div');
  feedback.className = 'key-feedback';

  actionRow.appendChild(signInBtn);
  content.append(note, actionRow, feedback);

  signInBtn.addEventListener('click', () => beginDeviceOAuthFlow({
    providerId: template.id,
    ...(template.addAnother ? { addAccount: true } : {}),
    signInButton: signInBtn,
    feedback,
    onDone: async () => {
      showToast(`${template.name} added`);
      state.modelsLoaded = false;
      await loadTemplates();
      await initModels();
      renderProviders();
    },
  }));

  return content;
}

function buildClinePassBodyContent(template, card, provider) {
  const content = document.createElement('div');
  content.className = 'provider-body-content';

  const note = document.createElement('div');
  note.className = 'oauth-device-note';
  note.textContent = provider
    ? 'Choose API key or ClinePass account sign-in. Switching methods replaces the stored credential safely.'
    : 'Choose an API key or sign in with a one-time device code.';
  content.appendChild(note);

  const apiLabel = document.createElement('div');
  apiLabel.className = 'oauth-device-note';
  apiLabel.textContent = 'API key';
  apiLabel.style.marginTop = '10px';
  content.appendChild(apiLabel);

  const keyRow = document.createElement('div');
  keyRow.className = 'key-row';
  const input = document.createElement('input');
  input.type = 'password';
  input.className = 'key-input';
  input.placeholder = 'Paste ClinePass API key…';
  input.autocomplete = 'off';
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-primary';
  addBtn.textContent = provider ? 'Switch to API key' : 'Add with API key';
  keyRow.append(input, addBtn);
  content.appendChild(keyRow);

  const apiFeedback = document.createElement('div');
  apiFeedback.className = 'key-feedback';
  content.appendChild(apiFeedback);

  addBtn.addEventListener('click', async () => {
    const key = input.value.trim();
    if (!key) {
      apiFeedback.textContent = 'Enter an API key first.';
      apiFeedback.className = 'key-feedback error';
      return;
    }
    addBtn.disabled = true;
    apiFeedback.textContent = 'Validating key and fetching models…';
    apiFeedback.className = 'key-feedback muted';
    const result = await api('POST', '/api/providers/add', {
      templateId: 'cline-pass',
      key,
      replaceExisting: Boolean(provider),
    });
    addBtn.disabled = false;
    if (result.ok) {
      apiFeedback.textContent = `✓ ClinePass API key saved · ${result.count} models available`;
      apiFeedback.className = 'key-feedback success';
      state.modelsLoaded = false;
      await loadTemplates();
      await initModels();
      renderProviders();
      showToast('ClinePass API key saved');
    } else {
      apiFeedback.textContent = result.error ?? 'Failed to save ClinePass API key';
      if (result.hint) apiFeedback.textContent += ` — ${result.hint}`;
      apiFeedback.className = 'key-feedback error';
    }
  });

  const oauthLabel = document.createElement('div');
  oauthLabel.className = 'oauth-device-note';
  oauthLabel.textContent = provider?.account ? `ClinePass account · ${provider.account}` : 'ClinePass account';
  oauthLabel.style.marginTop = '12px';
  content.appendChild(oauthLabel);

  const oauthRow = document.createElement('div');
  oauthRow.className = 'key-row';
  const signInBtn = document.createElement('button');
  signInBtn.className = 'btn btn-ghost';
  signInBtn.textContent = provider?.authType === 'oauth' ? 'Re-authenticate with ClinePass' : 'Sign in with ClinePass';
  oauthRow.appendChild(signInBtn);
  content.appendChild(oauthRow);

  const oauthFeedback = document.createElement('div');
  oauthFeedback.className = 'key-feedback';
  content.appendChild(oauthFeedback);
  signInBtn.addEventListener('click', () => beginDeviceOAuthFlow({
    providerId: 'cline-pass',
    signInButton: signInBtn,
    feedback: oauthFeedback,
    onDone: async () => {
      showToast('ClinePass account connected');
      state.modelsLoaded = false;
      await loadTemplates();
      await initModels();
      renderProviders();
    },
  }));

  if (provider) content.appendChild(buildRenameProviderRow(provider));
  if (provider) content.appendChild(buildDeleteProviderRow(provider));
  return content;
}

function buildTemplateBodyContent(template, card) {
  const isCustom = template.id === '__custom_openai__' || template.id === '__custom_anthropic__';
  if (isCustom) return buildCustomEndpointBodyContent(template, card);
  if (template.oauthOnlyAdd) return buildOAuthTemplateBodyContent(template, card);
  if (template.id === 'cline-pass'
    || (template.authMethods?.includes('api') && template.authMethods?.includes('oauth'))) {
    return buildClinePassBodyContent(template, card);
  }
  if (template.authType === 'oauth') return buildOAuthTemplateBodyContent(template, card);

  const content = document.createElement('div');
  content.className = 'provider-body-content';

  let urlInput = null;
  let accountIdInput = null;

  if (template.accountIdPrompt) {
    const accountLabel = document.createElement('label');
    accountLabel.textContent = template.accountIdPrompt;
    accountLabel.style.cssText = 'font-size:12px;color:var(--text-muted,#aaa);display:block;margin-bottom:4px';
    content.appendChild(accountLabel);

    accountIdInput = document.createElement('input');
    accountIdInput.type = 'text';
    accountIdInput.className = 'key-input';
    accountIdInput.placeholder = 'e.g. 4ff191dac2d0bd7538cb1c9126594de3';
    accountIdInput.autocomplete = 'off';
    accountIdInput.style.marginBottom = '8px';
    content.appendChild(accountIdInput);
  } else if (template.urlPrompt) {
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

  if (template.setupNote) {
    const note = document.createElement('div');
    note.textContent = template.setupNote;
    note.style.cssText = 'font-size:12px;color:var(--text-muted,#aaa);margin-bottom:8px';
    content.appendChild(note);
  }

  if (!template.noApiKey) {
    wrap.appendChild(input);
    keyRow.appendChild(wrap);
  }
  keyRow.appendChild(addBtn);
  content.appendChild(keyRow);
  content.appendChild(feedback);

  addBtn.addEventListener('click', async () => {
    const key = input.value.trim();
    const baseUrl = urlInput ? urlInput.value.trim() : undefined;
    const accountId = accountIdInput ? accountIdInput.value.trim() : undefined;
    if (!key && !template.anonymousFreeModels && !template.apiKeyOptional) { feedback.textContent = 'Enter an API key first.'; feedback.className = 'key-feedback error'; return; }
    if (accountIdInput && !accountId) { feedback.textContent = 'Enter an Account ID.'; feedback.className = 'key-feedback error'; return; }
    if (urlInput && !baseUrl) { feedback.textContent = 'Enter a base URL.'; feedback.className = 'key-feedback error'; return; }
    addBtn.disabled = true;
    feedback.textContent = template.noApiKey ? 'Checking setup and model access…' : key ? 'Validating key and fetching models…' : 'Fetching models…';
    feedback.className = 'key-feedback muted';

    const result = await api('POST', '/api/providers/add', { templateId: template.id, key, baseUrl, accountId, ...(template.addAnother ? { addAccount: true } : {}) });

    addBtn.disabled = false;
    if (result.ok) {
      feedback.textContent = `✓ ${template.name} added · ${result.count} models available${result.notice ? ` — ${result.notice}` : ''}`;
      feedback.className = 'key-feedback success';
      // Reload full catalog so the new provider appears in configured list
      state.modelsLoaded = false;
      await loadTemplates();
      await initModels();
      renderProviders();
      if (result.notice) showToast(`${template.name} added. ${result.notice}`, undefined, 10000);
      else showToast(`${template.name} added successfully`);
    } else {
      feedback.textContent = result.error ?? 'Failed to add provider';
      if (result.hint) feedback.textContent += ` — ${result.hint}`;
      feedback.className = 'key-feedback error';
    }
  });

  return content;
}

function buildProviderBodyContent(provider) {
  if (provider.id === 'cline-pass') {
    return buildClinePassBodyContent({ id: 'cline-pass', name: 'ClinePass' }, null, provider);
  }
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
  testBtn.title = 'Refresh the catalog using the entered key, then optionally save it. Use Test beside a model to verify inference access.';

  const feedback = document.createElement('div');
  feedback.className = 'key-feedback';

  wrap.appendChild(input);
  keyRow.appendChild(wrap);
  keyRow.appendChild(testBtn);
  content.appendChild(keyRow);
  content.appendChild(feedback);

  testBtn.addEventListener('click', async () => {
    const enteredKey = input.value.trim();
    feedback.textContent = 'Refreshing…';
    feedback.className = 'key-feedback muted';
    testBtn.disabled = true;
    const result = await refreshProvider(provider.id, enteredKey || undefined);
    testBtn.disabled = false;
    if (result.ok) {
      let savedMessage = '';
      if (enteredKey && window.confirm('Save this API key for future Relay launches?')) {
        let saved = await saveKey(provider.id, enteredKey);
        if (saved.needsConfirmation && window.confirm('Replace the existing stored API key?')) {
          saved = await saveKey(provider.id, enteredKey, true);
        }
        if (saved.ok) {
          savedMessage = ' · key saved';
          provider.hasKey = true;
          const chip = document.querySelector(`[data-id="${CSS.escape(provider.id)}"] .status-chip`);
          if (chip) { chip.className = 'status-chip has-key'; chip.textContent = 'Key stored'; }
        } else if (saved.needsConfirmation) {
          savedMessage = ' · key used for this refresh only';
        } else {
          feedback.textContent = saved.error ?? 'Failed to save key';
          feedback.className = 'key-feedback error';
          return;
        }
      }
      feedback.textContent = `✓ Catalog refreshed: ${result.count} models${savedMessage}`;
      feedback.className = 'key-feedback success';
      const countEl = document.querySelector(`[data-id="${CSS.escape(provider.id)}"] .provider-models-count`);
      if (countEl) countEl.textContent = `${result.count} models`;
      provider.modelCount = result.count;
      state.modelsLoaded = false;
      await initModels();
    } else {
      feedback.textContent = result.error ?? 'Refresh failed';
      feedback.className = 'key-feedback error';
    }
    setTimeout(() => { feedback.textContent = ''; feedback.className = 'key-feedback'; }, 4000);
  });

  if (provider.supportsManualModels) {
    const manualButton = document.createElement('button');
    manualButton.type = 'button';
    manualButton.className = 'btn btn-ghost';
    manualButton.textContent = 'Add model manually';
    manualButton.addEventListener('click', () => openProviderModelBrowser(provider.id));
    content.appendChild(manualButton);
  }
  if (provider.customEndpoint) content.appendChild(buildEditCustomEndpointRow(provider));
  if (provider.canEditServerUrl) content.appendChild(buildServerUrlRow(provider));
  if (provider.canAddKeyAccount) content.appendChild(buildAddKeyAccountRow(provider));
  content.appendChild(buildRenameProviderRow(provider));
  content.appendChild(buildDeleteProviderRow(provider));
  return content;
}

function buildEditCustomEndpointRow(provider) {
  const custom = provider.customEndpoint;
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px solid oklch(22% 0.015 265)';

  const editBtn = document.createElement('button');
  editBtn.className = 'btn btn-ghost';
  editBtn.textContent = 'Edit Backend Settings';

  const form = document.createElement('div');
  form.style.cssText = 'display:none;flex-direction:column;gap:8px;margin-top:10px';

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
  nameInput.value = provider.name ?? '';

  const urlInput = document.createElement('input');
  urlInput.type = 'url';
  urlInput.className = 'key-input';
  urlInput.value = custom.baseUrl ?? '';

  const keyInput = document.createElement('input');
  keyInput.type = 'password';
  keyInput.className = 'key-input';
  keyInput.placeholder = 'Leave empty to keep current key';
  keyInput.autocomplete = 'off';

  const headersInput = document.createElement('textarea');
  headersInput.className = 'key-input';
  headersInput.rows = 2;
  headersInput.placeholder = 'One per line\nX-Plan: coding';
  headersInput.value = Object.entries(custom.headers ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Save Changes';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-ghost';
  cancelBtn.textContent = 'Cancel';

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px';
  btnRow.appendChild(saveBtn);
  btnRow.appendChild(cancelBtn);

  const feedback = document.createElement('div');
  feedback.className = 'key-feedback';

  form.appendChild(row('Provider name', nameInput));
  form.appendChild(row('Base URL', urlInput));
  form.appendChild(row('API key', keyInput));
  form.appendChild(row('Custom headers (replaces all; empty removes all)', headersInput));
  form.appendChild(btnRow);
  form.appendChild(feedback);

  wrapper.appendChild(editBtn);
  wrapper.appendChild(form);

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

  editBtn.addEventListener('click', () => {
    editBtn.style.display = 'none';
    form.style.display = 'flex';
  });

  cancelBtn.addEventListener('click', () => {
    form.style.display = 'none';
    editBtn.style.display = '';
    feedback.textContent = '';
    feedback.className = 'key-feedback';
  });

  async function submit(saveAnyway) {
    const payload = {
      providerId: provider.id,
      displayName: nameInput.value.trim(),
      baseUrl: urlInput.value.trim(),
      apiKey: keyInput.value.trim(),
      headers: parseHeaders(headersInput.value),
      saveAnyway,
    };
    if (!payload.displayName) {
      feedback.textContent = 'Enter a provider name.';
      feedback.className = 'key-feedback error';
      return null;
    }
    if (!payload.baseUrl) {
      feedback.textContent = 'Enter a base URL.';
      feedback.className = 'key-feedback error';
      return null;
    }
    saveBtn.disabled = true;
    feedback.textContent = 'Testing connection…';
    feedback.className = 'key-feedback muted';
    const result = await api('POST', '/api/providers/edit-custom', payload);
    saveBtn.disabled = false;
    return result;
  }

  saveBtn.addEventListener('click', async () => {
    let result = await submit(false);
    if (!result) return;

    if (!result.ok) {
      const message = [result.error, result.hint].filter(Boolean).join(' ');
      // Only a failed connection test is overridable. A blocked URL or a
      // non-custom provider can never be saved, so never offer the choice.
      if (!result.canSaveAnyway) {
        // "Nothing to change" is a no-op, not a failure — the CLI logs it as
        // info, so don't shout in red here either.
        const benign = result.error === 'Nothing to change.';
        feedback.textContent = message;
        feedback.className = benign ? 'key-feedback muted' : 'key-feedback error';
        return;
      }
      if (!window.confirm(`${message}\n\nSave these settings anyway? The model list will not be refreshed.`)) {
        feedback.textContent = message;
        feedback.className = 'key-feedback error';
        return;
      }
      result = await submit(true);
      if (!result || !result.ok) {
        feedback.textContent = (result && result.error) || 'Update failed';
        feedback.className = 'key-feedback error';
        return;
      }
    }

    feedback.textContent = result.modelsStale
      ? `✓ Saved · model list may be out of date`
      : `✓ ${result.name} updated · ${result.count} models available${result.incomplete ? ` · ⚠ ${result.incomplete}` : ''}`;
    feedback.className = (result.modelsStale || result.incomplete) ? 'key-feedback muted' : 'key-feedback success';
    keyInput.value = '';
    showToast(`${result.name} updated`);
    state.modelsLoaded = false;
    await loadTemplates();
    await initModels();
    renderProviders();
  });

  return wrapper;
}

// A second API key for the same provider becomes its own provider card, numbered and renameable.
function buildAddKeyAccountRow(provider) {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px solid oklch(22% 0.015 265)';

  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-ghost';
  addBtn.textContent = 'Add another account';

  const form = document.createElement('div');
  form.style.cssText = 'display:none;align-items:center;gap:8px;flex-wrap:wrap';

  const keyInput = document.createElement('input');
  keyInput.type = 'password';
  keyInput.className = 'key-input';
  keyInput.placeholder = provider.templateId === 'zen' || provider.templateId === 'go'
    ? 'Paste the other OpenCode key (adds a Zen + Go pair)…'
    : 'Paste the other account\'s API key…';
  keyInput.autocomplete = 'off';
  keyInput.style.flex = '1';
  keyInput.style.minWidth = '220px';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Add account';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-ghost';
  cancelBtn.textContent = 'Cancel';

  const feedback = document.createElement('div');
  feedback.className = 'key-feedback';

  form.append(keyInput, saveBtn, cancelBtn);
  wrapper.append(addBtn, form, feedback);

  addBtn.addEventListener('click', () => {
    addBtn.style.display = 'none';
    form.style.display = 'flex';
    keyInput.focus();
  });

  cancelBtn.addEventListener('click', () => {
    form.style.display = 'none';
    addBtn.style.display = '';
    keyInput.value = '';
    feedback.textContent = '';
    feedback.className = 'key-feedback';
  });

  saveBtn.addEventListener('click', async () => {
    const key = keyInput.value.trim();
    if (!key) {
      feedback.textContent = 'Paste an API key first.';
      feedback.className = 'key-feedback error';
      return;
    }
    saveBtn.disabled = true;
    feedback.textContent = 'Testing the key and fetching models…';
    feedback.className = 'key-feedback muted';
    const result = await api('POST', '/api/providers/add', { templateId: provider.templateId, key, addAccount: true });
    saveBtn.disabled = false;
    if (result.ok) {
      keyInput.value = '';
      showToast(`${result.name} added — rename it from its card`);
      state.modelsLoaded = false;
      await loadTemplates();
      await initModels();
      renderProviders();
    } else {
      feedback.textContent = [result.error ?? 'Could not add the account', result.hint].filter(Boolean).join(' — ');
      feedback.className = 'key-feedback error';
    }
  });

  keyInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveBtn.click();
    if (e.key === 'Escape') cancelBtn.click();
  });

  return wrapper;
}

function buildServerUrlRow(provider) {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px solid oklch(22% 0.015 265)';
  const current = document.createElement('div');
  current.className = 'server-url-current';
  const label = document.createElement('span');
  label.textContent = 'Server address';
  const address = document.createElement('code');
  address.textContent = provider.serverUrl || 'not set';
  const editBtn = document.createElement('button');
  editBtn.className = 'btn btn-ghost';
  editBtn.textContent = 'Edit';
  editBtn.setAttribute('aria-label', 'Edit server address');
  current.append(label, address, editBtn);
  const form = document.createElement('div');
  form.style.cssText = 'display:none;align-items:center;gap:8px;flex-wrap:wrap';
  const urlInput = document.createElement('input');
  urlInput.type = 'url';
  urlInput.className = 'key-input';
  urlInput.value = provider.serverUrl ?? '';
  urlInput.placeholder = 'http://192.168.1.20:11434/v1';
  urlInput.autocomplete = 'off';
  urlInput.style.cssText = 'flex:1;min-width:220px';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Save & refresh';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-ghost';
  cancelBtn.textContent = 'Cancel';
  const feedback = document.createElement('div');
  feedback.className = 'key-feedback';
  form.append(urlInput, saveBtn, cancelBtn);
  wrapper.append(current, form, feedback);
  editBtn.addEventListener('click', () => { current.style.display = 'none'; form.style.display = 'flex'; urlInput.focus(); });
  cancelBtn.addEventListener('click', () => { form.style.display = 'none'; current.style.display = ''; feedback.textContent = ''; });
  saveBtn.addEventListener('click', async () => {
    const baseUrl = urlInput.value.trim();
    if (!baseUrl) { feedback.textContent = 'Enter a server address.'; feedback.className = 'key-feedback error'; return; }
    saveBtn.disabled = true;
    feedback.textContent = 'Checking the new address and reading its models…';
    feedback.className = 'key-feedback muted';
    const result = await api('POST', '/api/providers/edit-url', { providerId: provider.id, baseUrl });
    saveBtn.disabled = false;
    if (!result.ok) {
      feedback.textContent = (result.error ?? 'Could not change the address.') + (result.hint ? ` — ${result.hint}` : '') + ' The old address was kept.';
      feedback.className = 'key-feedback error';
      return;
    }
    showToast(result.unchanged ? 'Address unchanged' : `${provider.name} now points to the new address · ${result.count} models`);
    state.modelsLoaded = false;
    await initModels();
    renderProviders();
  });
  return wrapper;
}

function buildRenameProviderRow(provider) {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px solid oklch(22% 0.015 265)';

  const renameBtn = document.createElement('button');
  renameBtn.className = 'btn btn-ghost';
  renameBtn.textContent = 'Rename Provider';

  const form = document.createElement('div');
  form.style.cssText = 'display:none;align-items:center;gap:8px;flex-wrap:wrap';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'key-input';
  nameInput.maxLength = 60;
  nameInput.value = provider.name ?? '';
  nameInput.style.flex = '1';
  nameInput.style.minWidth = '180px';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Save Name';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-ghost';
  cancelBtn.textContent = 'Cancel';

  const feedback = document.createElement('div');
  feedback.className = 'key-feedback';

  form.appendChild(nameInput);
  form.appendChild(saveBtn);
  form.appendChild(cancelBtn);
  wrapper.appendChild(renameBtn);
  wrapper.appendChild(form);
  wrapper.appendChild(feedback);

  renameBtn.addEventListener('click', () => {
    renameBtn.style.display = 'none';
    form.style.display = 'flex';
    nameInput.focus();
    nameInput.select();
  });

  cancelBtn.addEventListener('click', () => {
    form.style.display = 'none';
    renameBtn.style.display = '';
    feedback.textContent = '';
    feedback.className = 'key-feedback';
    nameInput.value = provider.name ?? '';
  });

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    const result = await api('POST', '/api/providers/rename', { providerId: provider.id, name: nameInput.value });
    saveBtn.disabled = false;
    if (result.ok) {
      showToast(`Renamed to ${result.name}`);
      state.providerNameMap[provider.id] = result.name;
      state.modelsLoaded = false;
      await loadTemplates();
      await initModels();
      renderFavList();
      renderCodexSubagentList();
      renderProviders();
    } else {
      feedback.textContent = result.error ?? 'Rename failed';
      feedback.className = result.error === 'Nothing to change.' ? 'key-feedback muted' : 'key-feedback error';
    }
  });

  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveBtn.click();
    if (e.key === 'Escape') cancelBtn.click();
  });

  return wrapper;
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
      state.generalFavorites = state.generalFavorites.filter(favorite => favorite.providerId !== provider.id);
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
  status.className = 'oauth-device-note';
  status.textContent = provider.hasKey
    ? `Signed in via OAuth${provider.subscription?.label ? ` · ${provider.subscription.label}` : ''}.`
    : provider.needsSignIn
      ? `Sign-in expired${provider.signInIssue ? ` — ${provider.signInIssue}` : ''}. Sign in again to keep using this account.`
      : 'Not signed in. Generate a one-time code to connect this provider.';

  // Who is signed in — a read-only hint for choosing a name; never used as the label.
  const accountNote = document.createElement('div');
  accountNote.className = 'oauth-device-note';
  accountNote.textContent = provider.account ? `Account: ${provider.account}` : '';
  accountNote.style.display = provider.account ? '' : 'none';

  const actionRow = document.createElement('div');
  actionRow.className = 'key-row';
  actionRow.style.flexWrap = 'wrap';
  actionRow.style.gap = '8px';

  const signInBtn = document.createElement('button');
  signInBtn.className = 'btn btn-primary';
  signInBtn.textContent = provider.hasKey ? 'Re-authenticate' : provider.needsSignIn ? 'Sign in again' : 'Get sign-in code';

  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'btn btn-ghost';
  refreshBtn.textContent = 'Refresh Models';
  refreshBtn.style.display = provider.hasKey ? '' : 'none';

  const feedback = document.createElement('div');
  feedback.className = 'key-feedback';

  actionRow.appendChild(signInBtn);
  actionRow.appendChild(refreshBtn);

  // A second sign-in for the same provider shows up as its own card, which can then be renamed.
  const addAccountBtn = document.createElement('button');
  addAccountBtn.className = 'btn btn-ghost';
  addAccountBtn.textContent = 'Add another account';
  addAccountBtn.style.display = provider.hasKey && provider.canAddAccount ? '' : 'none';
  actionRow.appendChild(addAccountBtn);

  content.appendChild(status);
  content.appendChild(accountNote);
  content.appendChild(actionRow);
  content.appendChild(feedback);
  content.appendChild(buildRenameProviderRow(provider));
  content.appendChild(buildDeleteProviderRow(provider));

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
      state.modelsLoaded = false;
      await initModels();
    } else {
      feedback.textContent = result.error ?? 'Refresh failed';
      feedback.className = 'key-feedback error';
    }
    setTimeout(() => { feedback.textContent = ''; feedback.className = 'key-feedback'; }, 4000);
  });

  signInBtn.addEventListener('click', () => beginDeviceOAuthFlow({
    providerId: provider.id,
    signInButton: signInBtn,
    refreshButton: refreshBtn,
    feedback,
    onDone: async () => {
      showToast(`Signed in to ${provider.name ?? provider.id}`);
      state.modelsLoaded = false;
      await initModels();
      renderProviders();
      renderFavList();
    },
  }));

  addAccountBtn.addEventListener('click', () => beginDeviceOAuthFlow({
    providerId: provider.id,
    addAccount: true,
    signInButton: addAccountBtn,
    refreshButton: refreshBtn,
    feedback,
    onDone: async () => {
      showToast('Account added — rename it from its card');
      state.modelsLoaded = false;
      await loadTemplates();
      await initModels();
      renderProviders();
      renderFavList();
    },
  }));

  return content;
}

// ─── Model search results ─────────────────────────────────────────────────────

function buildModelResults(filter, listType) {
  const containerId = listType === 'codex-subagents' ? 'codex-subagent-results' : 'model-results';
  const container = document.getElementById(containerId);
  const currentFavs = listType === 'codex-subagents' ? state.codexSubagentModels : state.generalFavorites;
  const max = listType === 'codex-subagents' ? CODEX_SUBAGENT_MAX : GENERAL_MAX;
  const atCapacity = currentFavs.length >= max;
  const freeOnly = listType === 'codex-subagents' ? state.codexSubagentFreeOnly : state.modelFreeOnly;

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

  if (listType === 'codex-subagents' && !Object.prototype.hasOwnProperty.call(state.appModelsByTarget, 'codex-subagents')) {
    container.innerHTML = Array(3).fill('<div class="skeleton" style="height:36px;margin:4px 12px;border-radius:6px"></div>').join('');
    loadAppModels('codex-subagents').then(() => buildModelResults(filter, listType));
    return;
  }

  const q = filter.trim().toLowerCase();
  const sourceModels = listType === 'codex-subagents'
    ? state.appModelsByTarget['codex-subagents']
    : state.allModels;
  const base = sourceModels.filter(m => !freeOnly || isFreeModel(m));
  const matched = base.filter(m =>
    !q ||
    matchesModelSearch(m.id, q) ||
    (m.name && matchesModelSearch(m.name, q)) ||
    matchesModelSearch(m.providerName, q)
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
      addBtn.title = atCapacity && !isFav ? `${listType === 'codex-subagents' ? 'Codex SubAgent' : 'Favorites'} is full (${max}/${max})` : (isFav ? 'Already added' : 'Add to favorites');
      if (!isFav && !atCapacity) {
        addBtn.addEventListener('click', () => {
          addToFavorites({ providerId: m.providerId, modelId: m.id }, listType);
          buildModelResults(filter, listType);
        });
      }

      row.appendChild(idEl);
      if (state.intelligenceActive && m.intelligence) {
        const iq = document.createElement('span');
        iq.className = 'intel-badge';
        iq.textContent = `IQ ${Number(m.intelligence.score).toFixed(1)}`;
        iq.title = intelTooltipText(m.intelligence);
        row.appendChild(iq);
      }
      if (isFreeModel(m)) row.appendChild(badgeEl);
      row.appendChild(ctxEl);
      row.appendChild(addBtn);
      container.appendChild(row);
    }
  }
}

// ─── Relay Free Pool ─────────────────────────────────────────────────────────
//
// The pool is one virtual model ("Relay Free Pool") in each tool's switcher.
// Membership lives here and never touches Favorites. Eligibility comes from the
// server so this page and the provider table always agree; unknown context is
// allowed to join, and Test reports any routing problem.

const POOL_EFFORT_LEVELS = ['auto', 'low', 'medium', 'high'];

function poolData() {
  return state.pool?.data ?? null;
}

function poolMember(providerId, modelId) {
  const members = poolData()?.members ?? state.freePoolMembers;
  return members.some(item => item.providerId === providerId && item.modelId === modelId);
}

function poolCandidateFor(providerId, modelId) {
  return poolData()?.candidates?.find(item => item.providerId === providerId && item.modelId === modelId);
}

function poolRowState(providerId, model) {
  const candidate = poolCandidateFor(providerId, model.id);
  if (candidate) {
    if (candidate.alreadyAdded) return { state: 'member' };
    if (candidate.canAdd) return { state: 'add' };
    return { state: 'blocked', reason: candidate.addReason || 'This model cannot join the free pool' };
  }
  if (model.hidden) return { state: 'hidden' };
  if (model.testResult && !model.testResult.ok && !model.testResult.transient) return { state: 'blocked', reason: 'Failed its last test. Run Test again; it can be added once a test passes.' };
  if (model.freeStatus === 'verified_free' || (model.cost && model.cost.input === 0 && model.cost.output === 0)) return { state: 'add' };
  if (model.freeStatus === 'free_provider') return { state: 'blocked', reason: 'Requires verified zero pricing' };
  return { state: 'hidden' };
}

// Provider table shortcut. Favorites keep the "+"; the pool uses its own glyph
// so the two destinations stay visually distinct.
function poolRowButton(providerId, model) {
  const info = poolRowState(providerId, model);
  if (info.state === 'hidden') return '';
  const label = escapeHtml(model.name || model.id);
  if (info.state === 'member') {
    return `<button class="btn-model-add btn-model-pool is-pooled" type="button" data-model-id="${escapeHtml(model.id)}" title="In Relay Free Pool · click to remove" aria-label="Remove ${label} from the Relay Free Pool">✓</button>`;
  }
  if (info.state === 'blocked') {
    return `<button class="btn-model-add btn-model-pool" type="button" disabled data-model-id="${escapeHtml(model.id)}" title="${escapeHtml(info.reason)}" aria-label="${escapeHtml(info.reason)}">⇄</button>`;
  }
  return `<button class="btn-model-add btn-model-pool" type="button" data-model-id="${escapeHtml(model.id)}" title="Add to Relay Free Pool" aria-label="Add ${label} to the Relay Free Pool">⇄</button>`;
}

async function toggleFreePoolModel(providerId, modelId, button, action) {
  if (state.poolBusy) return;
  const adding = action ? action === 'add' : !poolMember(providerId, modelId);
  state.poolBusy = true;
  if (button) button.disabled = true;
  try {
    const result = await api('POST', '/api/pool', { action: adding ? 'add' : 'remove', providerId, modelId });
    if (result.error || result.ok === false) {
      showToast(result.error ?? 'Could not update the Relay Free Pool', undefined, 5000);
      await loadFreePool();
      return;
    }
    await loadConfig();
    await loadFreePool();
    if (providerIdFromHash()) renderProviderModelBrowser();
    showToast(adding ? 'Added to Relay Free Pool' : 'Removed from Relay Free Pool');
  } finally {
    state.poolBusy = false;
    if (button) button.disabled = false;
  }
}

let poolLoadSequence = 0;
async function loadFreePool() {
  const panel = document.getElementById('free-pool-panel');
  if (!panel) return;
  const sequence = ++poolLoadSequence;
  if (!state.pool) panel.innerHTML = '<div class="provider-browser-empty">Loading free models…</div>';
  let next;
  try {
    const data = await api('GET', '/api/pool');
    if (data?.error) throw new Error(data.error);
    next = { data, error: null };
  } catch (error) {
    next = { data: state.pool?.data ?? null, error: error?.message || 'Could not load the free pool' };
  }
  // A slower earlier request must never overwrite a newer catalog.
  if (sequence !== poolLoadSequence) return;
  state.pool = next;
  renderFreePool();
}


// Which pool member is answering, and only the moments something happened (failure, failover, switch).
function poolActivityRowHtml(request, label) {
  const when = new Date(request.at);
  const time = Number.isNaN(when.getTime()) ? '' : when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const answered = request.outcome === 'answered' && request.answeredBy;
  const secs = typeof request.ms === 'number' ? `${(request.ms / 1000).toFixed(1)}s` : '';
  const head = answered
    ? `<span class="pool-activity-event">${escapeHtml(label)}</span><span class="provider-pill" style="${providerPillStyle(request.answeredBy.providerId)}">${escapeHtml(request.answeredBy.providerId)}</span><code>${escapeHtml(request.answeredBy.modelId)}</code><span class="pool-activity-reason">${escapeHtml(secs)}</span>`
    : '<span class="pool-activity-event">✗ no model answered</span>';
  const tried = (request.tried ?? []).map(t => `<li><span class="pool-activity-failed">✗ ${escapeHtml(t.providerId)}/${escapeHtml(t.modelId)}</span> ${escapeHtml(t.reason ?? 'failed')}${t.detail ? `<span class="pool-activity-detail">${escapeHtml(t.detail)}</span>` : ''}</li>`).join('');
  return `<li class="pool-activity-row ${answered && !tried ? 'is-served' : (answered ? 'is-failover' : 'is-failed')}"><span class="pool-activity-time">${escapeHtml(time)}</span>${head}${tried ? `<ul class="pool-activity-tried">${tried}</ul>` : ''}</li>`;
}

const POOL_EVENT_LABELS = { 'now-answering': '● answering', switched: '● switched to', failover: '↪ failover, answered by', failed: '✗' };

function poolActivityHtml(activity) {
  const verbose = state.poolActivityVerbose === true;
  const current = activity?.current;
  const quiet = activity?.quiet ?? 0;
  const currentLine = current
    ? `<p class="pool-activity-current"><strong>Current model:</strong> <span class="provider-pill" style="${providerPillStyle(current.providerId)}">${escapeHtml(current.providerId)}</span> <code>${escapeHtml(current.modelId)}</code>${quiet > 0 ? ` <span class="pool-activity-reason">${quiet} request${quiet === 1 ? '' : 's'} answered smoothly since the last event</span>` : ''}</p>`
    : '';
  const rows = verbose
    ? (activity?.recent ?? []).map(request => poolActivityRowHtml(request, '✓ answered'))
    : (activity?.events ?? []).map(block => poolActivityRowHtml(block.request, POOL_EVENT_LABELS[block.kind] ?? '●'));
  const empty = verbose
    ? 'No pool requests yet. When you use Relay Free Pool in a tool, each request shows up here.'
    : 'Nothing to report. Failures, failovers and model switches show up here; turn on "Show every request" to see all of them.';
  return `<div class="pool-section-head"><h2 class="pool-heading">Recent activity</h2><p class="section-sub">${verbose ? 'Every request.' : 'Only when something happens.'} Stored on this computer only (model names and short reasons, never prompts).</p></div>
    ${currentLine}
    <label class="pool-toggle pool-activity-toggle"><input type="checkbox" id="pool-activity-verbose" ${verbose ? 'checked' : ''}><span>Show every request</span></label>
    <ul class="pool-activity">${rows.join('') || `<li class="pool-activity-empty">${escapeHtml(empty)}</li>`}</ul>`;
}

// Activity has its own sidebar page so it never sits between the pool and the models you add.
function renderPoolActivity(pool) {
  const panel = document.getElementById('pool-activity-panel');
  if (!panel) return;
  panel.innerHTML = poolActivityHtml(pool.activity);
  document.getElementById('pool-activity-verbose')?.addEventListener('change', event => {
    state.poolActivityVerbose = event.currentTarget.checked;
    renderPoolActivity(pool);
  });
}

function renderFreePoolStats(pool) {
  const el = document.getElementById('free-pool-stats');
  if (!el) return;
  const total = (pool.candidates ?? []).length;
  el.innerHTML = `
    <div class="provider-stat">
      <div class="provider-stat-value"><span>${total}</span></div>
      <div class="provider-stat-label">free models</div>
    </div>
  `;
}

function poolKindHtml(candidate) {
  const info = KIND_INFO[candidate.kind];
  if (!info) return '<span class="kind-unknown">❔ Unknown</span>';
  const tip = candidate.kindSource === 'manual' ? 'Set by you.'
    : candidate.kindSource === 'test' ? 'Confirmed by a Test.'
    : candidate.kindSource === 'models.dev' ? 'Type listed on models.dev for this model.'
    : 'Detected from the model catalog.';
  return `<span title="${escapeHtml(tip)}"><span class="kind-icon" aria-hidden="true">${info[0]}</span>${info[1]}</span>`;
}

function poolAddCellHtml(candidate, manageable) {
  if (!manageable) return '';
  const label = escapeHtml(candidate.name || candidate.modelId);
  if (candidate.alreadyAdded) {
    return `<button class="btn-model-add btn-model-pool is-pooled" type="button" disabled title="In Relay Free Pool" aria-label="${label} is in the Relay Free Pool">✓</button>`;
  }
  if (!candidate.canAdd) {
    const reason = escapeHtml(candidate.addReason || 'This model cannot join the free pool');
    return `<button class="btn-model-add btn-model-pool" type="button" disabled title="${reason}" aria-label="${reason}">+</button>`;
  }
  return `<button class="btn-model-add btn-model-pool pool-add" type="button" data-provider-id="${escapeHtml(candidate.providerId)}" data-model-id="${escapeHtml(candidate.modelId)}" title="Add to pool" aria-label="Add ${label} to the Relay Free Pool">+</button>`;
}

function poolMemberRowHtml(member, index, manageable) {
  const status = member.status === 'Ready' ? ['is-ready', 'Ready']
    : member.status === 'Disabled' ? ['is-unavailable', 'Disabled']
    : member.status === 'Unavailable' ? ['is-unavailable', 'Unavailable']
    : ['is-pending', 'Needs test'];
  const facts = [];
  const sourceNote = { set: 'set by you', measured: 'measured', estimate: 'estimate' }[member.contextSource];
  if (member.contextWindow) {
    facts.push(`${fmtCtx(member.contextWindow)} context${sourceNote ? ` (${sourceNote})` : ''}`);
    if (member.routingContextWindow && member.routingContextWindow !== member.contextWindow) {
      facts.push(`routing still uses ${fmtCtx(member.routingContextWindow)} until you Test`);
    }
  } else {
    facts.push('context unknown');
  }
  const reason = member.reason ? `<div class="pool-member-reason">${escapeHtml(member.reason)}</div>` : '';
  const actions = manageable ? `
    <div class="pool-member-actions">
      <button class="btn btn-ghost pool-test" type="button" draggable="false" data-provider-id="${escapeHtml(member.providerId)}" data-model-id="${escapeHtml(member.modelId)}" title="One small request, up to 1024 output tokens. No retries or context/reasoning probes.">Test</button>
      <button class="btn btn-ghost pool-move" type="button" draggable="false" data-provider-id="${escapeHtml(member.providerId)}" data-model-id="${escapeHtml(member.modelId)}" data-direction="-1" ${index === 0 ? 'disabled' : ''} title="Move earlier in routing priority" aria-label="Move ${escapeHtml(member.name)} up">↑</button>
      <button class="btn btn-ghost pool-move" type="button" draggable="false" data-provider-id="${escapeHtml(member.providerId)}" data-model-id="${escapeHtml(member.modelId)}" data-direction="1" ${index === poolData().members.length - 1 ? 'disabled' : ''} title="Move later in routing priority" aria-label="Move ${escapeHtml(member.name)} down">↓</button>
      <details class="pool-advanced-menu">
        <summary class="btn btn-ghost" draggable="false">Advanced…</summary>
        <div class="pool-advanced-options">
          <button class="btn btn-ghost pool-context" type="button" draggable="false" data-provider-id="${escapeHtml(member.providerId)}" data-model-id="${escapeHtml(member.modelId)}">Measure context · 1 request</button>
          <button class="btn btn-ghost pool-set-context" type="button" draggable="false" data-provider-id="${escapeHtml(member.providerId)}" data-model-id="${escapeHtml(member.modelId)}" data-current="${member.contextWindow ?? ''}">Set context${member.contextWindow ? ` (now ${fmtCtx(member.contextWindow)})` : ''} · no requests</button>
          ${member.reasoningTestRequests > 1 ? '<button class="btn btn-ghost pool-reasoning" type="button" draggable="false" data-provider-id="' + escapeHtml(member.providerId) + '" data-model-id="' + escapeHtml(member.modelId) + '" data-requests="' + member.reasoningTestRequests + '">Check reasoning · up to ' + member.reasoningTestRequests + ' requests</button>' : ''}
        </div>
      </details>
      <button class="btn btn-ghost pool-remove" type="button" draggable="false" data-provider-id="${escapeHtml(member.providerId)}" data-model-id="${escapeHtml(member.modelId)}" title="Remove from the Relay Free Pool">Remove</button>
    </div>` : '';
  const handle = manageable
    ? `<span class="drag-handle" aria-hidden="true" title="Drag to change routing priority"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="8" y="4" width="3" height="3" rx="1"/><rect x="13" y="4" width="3" height="3" rx="1"/><rect x="8" y="10" width="3" height="3" rx="1"/><rect x="13" y="10" width="3" height="3" rx="1"/><rect x="8" y="16" width="3" height="3" rx="1"/><rect x="13" y="16" width="3" height="3" rx="1"/></svg></span>`
    : '';
  const dragAttrs = manageable
    ? ` draggable="true" tabindex="0" data-index="${index}" data-provider-id="${escapeHtml(member.providerId)}" data-model-id="${escapeHtml(member.modelId)}" aria-grabbed="false" aria-label="${escapeHtml(member.name)}, priority ${index + 1}. Drag or Alt+Arrow to reorder."`
    : '';
  return `<li class="pool-member-row"${dragAttrs}>
    ${handle}
    <span class="pool-rank" aria-hidden="true">${index + 1}</span>
    <div class="pool-member-main">
      <div class="pool-member-title">
        <strong>${escapeHtml(member.name)}</strong>${intelBadgeInline(member)}
        <span class="provider-pill" style="${providerPillStyle(member.providerId)}">${escapeHtml(member.providerName)}</span>
        <span class="pool-status ${status[0]}">${status[1]}</span>
      </div>
      <div class="pool-member-meta">${escapeHtml(member.modelId)}${facts.length ? ' · ' + escapeHtml(facts.join(' · ')) : ''}</div>
      ${reason}
    </div>
    ${actions}
  </li>`;
}

function poolCandidateRowHtml(candidate, manageable) {
  const name = candidate.name || candidate.modelId;
  const estimate = candidate.contextWindowEstimated ? '<span class="ctx-label">estimate</span>' : '';
  const eye = manageable
    ? `<button class="btn-model-hide pool-hide" type="button" data-provider-id="${escapeHtml(candidate.providerId)}" data-model-id="${escapeHtml(candidate.modelId)}" title="Hide this model" aria-label="Hide ${escapeHtml(name)}">${EYE_ICON}</button>`
    : '';
  const test = manageable
    ? `<button class="btn btn-ghost pool-test" type="button" data-provider-id="${escapeHtml(candidate.providerId)}" data-model-id="${escapeHtml(candidate.modelId)}" title="One small request, up to 1024 output tokens. Checks response and tool calling. No retries.">Test</button>`
    : '';
  return `<tr>
    <td><strong>${escapeHtml(name)}</strong><span class="provider-pill" style="${providerPillStyle(candidate.providerId)}">${escapeHtml(candidate.providerName)}</span><code title="${escapeHtml(candidate.modelId)}">${escapeHtml(candidate.modelId)}</code></td>
    <td>${poolKindHtml(candidate)}</td>
    <td>${fmtCtx(candidate.contextWindow) || '—'}${estimate}</td>
    ${intelCellHtml(candidate)}
    <td>${formatModelPrice(candidate.cost, true, 'FREE')}</td>
    <td class="td-actions"><span class="test-badge-slot" data-model-id="${escapeHtml(candidate.modelId)}">${testBadgeHtml(candidate.testResult)}</span>${test}${eye}${poolAddCellHtml(candidate, manageable)}</td>
  </tr>`;
}


function renderFreePool() {
  const panel = document.getElementById('free-pool-panel');
  if (!panel) return;
  const pool = poolData();
  if (!pool) {
    const message = escapeHtml(state.pool?.error || 'Loading free models…');
    const retry = state.pool?.error ? ' <button class="btn btn-ghost" type="button" id="free-pool-retry">Retry</button>' : '';
    panel.innerHTML = `<div class="provider-browser-empty">${message}${retry}</div>`;
    document.getElementById('free-pool-retry')?.addEventListener('click', () => { state.pool = null; void loadFreePool(); });
    return;
  }

  renderFreePoolStats(pool);
  renderPoolActivity(pool);
  const manageable = !isServerAdminUi();
  const tasks = pool.candidates ?? [];
  assignPoolProviderColors([...tasks, ...(pool.members ?? [])].map(item => item.providerId));
  // Provider accounts present in the list, in first-seen order.
  const poolProviders = [];
  const providerNames = new Map();
  for (const candidate of tasks) {
    if (providerNames.has(candidate.providerId)) continue;
    providerNames.set(candidate.providerId, candidate.providerName || candidate.providerId);
    poolProviders.push(candidate.providerId);
  }
  state.poolProviders = state.poolProviders.filter(id => providerNames.has(id));
  const selectedProviders = new Set(state.poolProviders);
  // Search + context narrow the list first; chip counts reflect that.
  const searched = tasks.filter(candidate =>
    matchesModelSearch(`${candidate.name} ${candidate.modelId} ${candidate.providerName}`, state.poolSearch)
    && (!state.poolMinCtx || (candidate.contextWindow ?? 0) >= state.poolMinCtx));
  const providerCounts = new Map();
  for (const candidate of searched) providerCounts.set(candidate.providerId, (providerCounts.get(candidate.providerId) ?? 0) + 1);
  const filtered = selectedProviders.size
    ? searched.filter(candidate => selectedProviders.has(candidate.providerId))
    : searched;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PROVIDER_MODEL_PAGE_SIZE));
  state.poolPage = Math.min(Math.max(1, state.poolPage), totalPages);
  const start = (state.poolPage - 1) * PROVIDER_MODEL_PAGE_SIZE;
  const items = (state.intelligenceActive ? sortByIntelligence(filtered, state.intelligenceSort) : filtered).slice(start, start + PROVIDER_MODEL_PAGE_SIZE);

  const members = pool.members ?? [];
  const memberHtml = members.length
    ? `<ol class="pool-member-list">${members.map((member, index) => poolMemberRowHtml(member, index, manageable)).join('')}</ol>`
    : '<p class="pool-empty">No models yet. Add one from the free model list below.</p>';

  const enabled = pool.enabled === true;
  const effortOptions = POOL_EFFORT_LEVELS
    .map(level => `<option value="${level}" ${pool.effort === level ? 'selected' : ''}>${level === 'auto' ? 'Auto (provider default)' : level}</option>`)
    .join('');
  const notice = state.pool?.error
    ? `<div class="pool-notice">Could not refresh the list. ${escapeHtml(state.pool.error)} <button class="btn btn-ghost" type="button" id="free-pool-retry">Retry</button></div>`
    : '';
  const disabledBanner = (pool.disabled ?? []).length
    ? `<div class="pool-notice pool-disabled-banner"><strong>⛔ ${pool.disabled.length} pool member${pool.disabled.length === 1 ? ' is' : 's are'} disabled.</strong> ${pool.disabled.map(item => `<code>${escapeHtml(item.providerId)}/${escapeHtml(item.modelId)}</code>`).join(', ')} Use Test on ${pool.disabled.length === 1 ? 'it' : 'each'} to re-enable.</div>`
    : '';
  const readyCount = members.filter(member => member.status === 'Ready').length;
  const enabledStatus = !enabled
    ? 'Off. Relay Free Pool is not added to any launch.'
    : members.length === 0
      ? 'On, but the pool is empty, so nothing is added yet. Add a model below.'
      : readyCount === 0
        ? 'On, but no pool model is tested and ready yet, so nothing is added yet. Test a model below.'
        : `On. Relay Free Pool is added to your launches (${readyCount} of ${members.length} model${members.length === 1 ? '' : 's'} ready).`;
  const controls = manageable ? `
    <div class="pool-controls pool-feature">
      <label class="pool-toggle">
        <input type="checkbox" id="free-pool-enabled" ${enabled ? 'checked' : ''}>
        <span>Add Relay Free Pool to my launches</span>
      </label>
      <p class="pool-feature-status ${enabled && readyCount > 0 ? 'is-on' : ''}">${escapeHtml(enabledStatus)}</p>
      <p class="pool-feature-help">When on, every Claude, Codex, ChatGPT app and Antigravity launch also lists <strong>Relay Free Pool</strong> as one extra model in the model switcher, next to the model you picked and your favorites. It is never chosen for you: pick it to use it. When you do, Relay sends each request to the first ready model in the list above and moves to the next if one fails or runs out. It never uses a model outside this pool. A model is only used while its saved Test result is valid, which is until its endpoint changes or you remove it. Turning this off just removes the extra entry.</p>
    </div>
    <div class="pool-controls pool-effort-card">
      <label class="pool-effort">
        <span><strong>Reasoning effort for pool requests</strong></span>
        <select class="filter-select" id="free-pool-effort">${effortOptions}</select>
      </label>
      <p class="pool-hint">How hard pool models think when Relay Free Pool is selected. Auto lets each provider decide. Applies whether or not the pool is turned on above.</p>
    </div>` : `
    <p class="pool-hint">${escapeHtml(enabledStatus)}</p>`;

  const countLabel = filtered.length === tasks.length ? String(tasks.length) : filtered.length + ' of ' + tasks.length;
  const rangeLabel = filtered.length === tasks.length ? String(tasks.length) : filtered.length + ' of ' + tasks.length;
  const pagination = filtered.length > PROVIDER_MODEL_PAGE_SIZE ? `
    <div class="provider-model-pagination">
      <span>${start + 1}–${Math.min(start + PROVIDER_MODEL_PAGE_SIZE, filtered.length)} of ${filtered.length}</span>
      <div>
        <button class="btn btn-ghost" id="free-pool-prev" type="button" ${state.poolPage <= 1 ? 'disabled' : ''}>Previous</button>
        <span>Page ${state.poolPage} of ${totalPages}</span>
        <button class="btn btn-primary" id="free-pool-next" type="button" ${state.poolPage >= totalPages ? 'disabled' : ''}>Next</button>
      </div>
    </div>` : (filtered.length ? `<p class="pool-range">${rangeLabel} shown</p>` : '');

  panel.innerHTML = `
    ${notice}
    ${disabledBanner}
    <div class="pool-section-head">
      <h2 class="pool-heading">In the pool <span class="pool-count">${members.length}</span></h2>
    </div>
    ${memberHtml}
    ${controls}
    <div class="pool-section-head">
      <h2 class="pool-heading">Free models <span class="pool-count">${countLabel}</span></h2>
      <p class="section-sub">Every free model Relay can see, across ${new Set(tasks.map(item => item.providerId)).size} provider accounts. Models without verified zero pricing stay listed so this total matches your free catalog.</p>
    </div>
    <p class="pool-hint">Test uses 1 request with up to 1024 output tokens and no retries. Context and reasoning checks are optional under Advanced after adding a model. Adding models and launching tools never run tests.</p>
    <div class="provider-browser-tools pool-tools">
      <div class="search-field">
        <svg class="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input class="search-input" id="free-pool-search" type="search" value="${escapeHtml(state.poolSearch)}" placeholder="Search free models or provider accounts…" aria-label="Search free models">
      </div>
      <button class="btn btn-ghost" id="free-pool-refresh" type="button" title="Reload the free model list">Refresh</button>
    </div>
    <div class="pool-filter-row">
      <div class="pool-provider-chips" role="group" aria-label="Filter by provider account">
        <button class="pool-chip${selectedProviders.size ? '' : ' is-active'}" type="button" data-pool-provider="" aria-pressed="${selectedProviders.size ? 'false' : 'true'}">All providers <span class="pool-chip-count">${searched.length}</span></button>
        ${poolProviders.map(id => {
          const active = selectedProviders.has(id);
          return `<button class="pool-chip pool-chip-provider${active ? ' is-active' : ''}" type="button" data-pool-provider="${escapeHtml(id)}" aria-pressed="${active}" style="${providerPillStyle(id, active ? 2 : 0.6)}">${escapeHtml(providerNames.get(id))} <span class="pool-chip-count">${providerCounts.get(id) ?? 0}</span></button>`;
        }).join('')}
      </div>
      <select class="filter-select" id="free-pool-ctx" aria-label="Filter by context window size">
          <option value="0" ${state.poolMinCtx === 0 ? 'selected' : ''}>All context sizes</option>
          <option value="128000" ${state.poolMinCtx === 128000 ? 'selected' : ''}>≥ 128k</option>
          <option value="200000" ${state.poolMinCtx === 200000 ? 'selected' : ''}>≥ 200k</option>
          <option value="500000" ${state.poolMinCtx === 500000 ? 'selected' : ''}>≥ 500k</option>
          <option value="1000000" ${state.poolMinCtx === 1000000 ? 'selected' : ''}>≥ 1M</option>
      </select>
    </div>
    <div class="provider-model-table-wrap">
      <table class="provider-model-table">
        <thead><tr><th>Model</th><th>Type</th><th>Context</th>${intelHeaderHtml()}<th>Price in / out <span tabindex="0" class="price-help" aria-label="About price estimates">ⓘ<span role="tooltip">Prices are estimates per 1M tokens and may not reflect the provider’s actual pricing or promotions. Check the provider’s pricing page.</span></span></th><th class="th-actions">Actions</th></tr></thead>
        <tbody>
          ${items.map(candidate => poolCandidateRowHtml(candidate, manageable)).join('')
            || '<tr><td colspan="${state.intelligenceActive ? 6 : 5}" class="provider-model-empty">No free models match your search and filters.</td></tr>'}
        </tbody>
      </table>
    </div>
    ${pagination}
  `;

  const rerender = () => renderFreePool();
  bindIntelSort(panel, () => { state.poolPage = 1; rerender(); });
  document.getElementById('free-pool-retry')?.addEventListener('click', () => { void loadFreePool(); });
  document.getElementById('free-pool-search')?.addEventListener('input', event => {
    state.poolSearch = event.target.value;
    state.poolPage = 1;
    rerender();
    const next = document.getElementById('free-pool-search');
    next?.focus();
    next?.setSelectionRange(next.value.length, next.value.length);
  });
  panel.querySelectorAll('[data-pool-provider]').forEach(chip => {
    chip.addEventListener('click', () => {
      const id = chip.dataset.poolProvider;
      if (!id) {
        state.poolProviders = [];
      } else if (state.poolProviders.includes(id)) {
        state.poolProviders = state.poolProviders.filter(item => item !== id);
      } else {
        state.poolProviders = [...state.poolProviders, id];
        // Every provider picked is the same as no filter.
        if (state.poolProviders.length === poolProviders.length) state.poolProviders = [];
      }
      state.poolPage = 1;
      rerender();
    });
  });
  document.getElementById('free-pool-ctx')?.addEventListener('change', event => {
    state.poolMinCtx = parseInt(event.target.value, 10) || 0;
    state.poolPage = 1;
    rerender();
  });
  document.getElementById('free-pool-refresh')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Refreshing…';
    await loadFreePool();
  });
  document.getElementById('free-pool-prev')?.addEventListener('click', () => {
    state.poolPage -= 1;
    rerender();
  });
  document.getElementById('free-pool-next')?.addEventListener('click', () => {
    state.poolPage += 1;
    rerender();
  });
  document.getElementById('free-pool-enabled')?.addEventListener('change', async event => {
    const input = event.currentTarget;
    const next = input.checked;
    input.disabled = true;
    const result = await api('POST', '/api/pool', { action: 'enabled', enabled: next });
    if (result.error || result.ok === false) {
      input.checked = !next;
      input.disabled = false;
      showToast(result.error ?? 'Could not change the pool', undefined, 5000);
      return;
    }
    showToast(next ? 'Relay Free Pool is on. Pick it as a model in your tool.' : 'Relay Free Pool is off');
    await loadFreePool();
  });
  document.getElementById('free-pool-effort')?.addEventListener('change', async event => {
    const select = event.currentTarget;
    select.disabled = true;
    const result = await api('POST', '/api/pool', { action: 'effort', effort: select.value });
    if (result.error || result.ok === false) {
      showToast(result.error ?? 'Could not save the effort level', undefined, 5000);
    }
    await loadFreePool();
  });
  const outsideMembers = el => !el.closest('.pool-member-list');
  [...panel.querySelectorAll('.pool-test')].filter(outsideMembers).forEach(button => {
    button.addEventListener('click', () => testModelResponse(button, button.dataset.providerId, button.dataset.modelId, { pool: true }));
  });
  const memberList = panel.querySelector('.pool-member-list');
  if (memberList) bindPoolMemberRows(memberList);
  [...panel.querySelectorAll('.pool-add')].forEach(button => {
    button.addEventListener('click', () => toggleFreePoolModel(button.dataset.providerId, button.dataset.modelId, button, 'add'));
  });
  [...panel.querySelectorAll('.pool-remove')].filter(outsideMembers).forEach(button => {
    button.addEventListener('click', () => toggleFreePoolModel(button.dataset.providerId, button.dataset.modelId, button, 'remove'));
  });
  panel.querySelectorAll('.pool-hide').forEach(button => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      await toggleModelHidden(button.dataset.providerId, button.dataset.modelId);
      await loadFreePool();
    });
  });
}

/** Redraw only the "In the pool" list from local state (no request, no full panel render). */
function renderPoolMemberList() {
  const list = document.querySelector('#free-pool-panel .pool-member-list');
  const members = poolData()?.members ?? [];
  if (!list) return;
  const manageable = !isServerAdminUi();
  list.innerHTML = members.map((member, index) => poolMemberRowHtml(member, index, manageable)).join('');
  bindPoolMemberRows(list);
}

function bindPoolMemberRows(list) {
  list.querySelectorAll('.pool-test').forEach(button => {
    button.addEventListener('click', () => testModelResponse(button, button.dataset.providerId, button.dataset.modelId, { pool: true }));
  });
  list.querySelectorAll('.pool-remove').forEach(button => {
    button.addEventListener('click', () => toggleFreePoolModel(button.dataset.providerId, button.dataset.modelId, button, 'remove'));
  });
  list.querySelectorAll('.pool-move').forEach(button => {
    button.addEventListener('click', () => {
      const from = Number.parseInt(button.closest('.pool-member-row')?.dataset.index ?? '', 10);
      if (Number.isInteger(from)) void reorderPoolMember(from, from + Number(button.dataset.direction), { focus: true });
    });
  });
  bindPoolMemberDrag(list);
  list.querySelectorAll('.pool-context, .pool-reasoning, .pool-set-context').forEach(button => {
    button.addEventListener('click', async () => {
      const { providerId, modelId } = button.dataset;
      button.disabled = true;
      try {
        if (button.classList.contains('pool-context')) {
          if (!window.confirm('Measure context: 1 extra request. This may consume quota even if rejected. Continue?')) return;
          const result = await api('POST', '/api/providers/models/measure-context', { providerId, modelId });
          if (result.ok) applyTestContextResult(providerId, modelId, result.context);
          showToast(result.ok ? (contextTestNote(result.context) || 'Provider did not report a context limit.') : (result.error || 'Context check failed'));
        } else if (button.classList.contains('pool-set-context')) {
          const entered = window.prompt('Context size in tokens (e.g. 128000). Enter reset to use provider metadata. No test requests.' + (button.dataset.current ? `\nCurrent: ${button.dataset.current}` : ''), button.dataset.current || '');
          if (entered === null) return;
          const contextWindow = entered.trim() === 'reset' ? null : Number(entered);
          if (contextWindow !== null && (!Number.isSafeInteger(contextWindow) || contextWindow <= 0)) { showToast('Enter a positive token count or reset.'); return; }
          const result = await api('POST', '/api/providers/models/context', { providerId, modelId, contextWindow });
          showToast(result.ok ? 'Context size saved. Run Test to update pool readiness.' : (result.error || 'Could not save context.'));
        } else {
          if (!window.confirm('Check reasoning: up to ' + button.dataset.requests + ' extra requests, with no retries. These consume message and token quota. Continue?')) return;
          const result = await api('POST', '/api/pool', { action: 'verify', providerId, modelId, reasoning: true });
          showToast(result.ok ? 'Reasoning checks complete.' : (result.error || 'Reasoning checks failed'));
        }
        await loadFreePool();
      } catch { showToast('Could not complete this action. Try again.'); }
      finally { button.disabled = false; }
    });
  });
}

/**
 * Reorder locally first so the list updates on the drop, then save. The order is the only thing a move
 * changes, so no pool reload follows; a failed save puts the old order back.
 */
async function reorderPoolMember(fromIndex, toIndex, { focus = false } = {}) {
  const pool = poolData();
  const members = pool?.members ?? [];
  const member = members[fromIndex];
  if (!member || fromIndex === toIndex || toIndex < 0 || toIndex >= members.length) return;
  const previous = members;
  pool.members = moveItem(members, fromIndex, toIndex);
  renderPoolMemberList();
  if (focus) document.querySelector(`#free-pool-panel .pool-member-row[data-index="${toIndex}"]`)?.focus();
  try {
    const result = await api('POST', '/api/pool', {
      action: 'move', providerId: member.providerId, modelId: member.modelId, toIndex,
    });
    if (result.error || result.ok === false) throw new Error(result.error ?? 'Could not change priority.');
  } catch (error) {
    if (poolData() === pool) {
      pool.members = previous;
      renderPoolMemberList();
    }
    showToast(error?.message || 'Could not change priority.', undefined, 5000);
  }
}

/** Where a drag over the member list would land: between two rows, or onto a row (taking its place). */
function poolDropTarget(list, pointerY, from) {
  return dropTarget([...list.querySelectorAll('.pool-member-row')].map(row => row.getBoundingClientRect()), pointerY, from);
}

function clearPoolDropIndicators(list) {
  list.querySelectorAll('.pool-member-row').forEach(el => el.classList.remove('drop-before', 'drop-after', 'drop-onto'));
}

function showPoolDropIndicator(list, target) {
  clearPoolDropIndicators(list);
  if (!target) return;
  const rows = list.querySelectorAll('.pool-member-row');
  if (target.kind === 'onto') rows[target.index]?.classList.add('drop-onto');
  else if (target.slot < rows.length) rows[target.slot]?.classList.add('drop-before');
  else rows[rows.length - 1]?.classList.add('drop-after');
}

function bindPoolMemberDrag(list) {
  let dragFrom = null;
  list.addEventListener('dragover', event => {
    if (dragFrom === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    showPoolDropIndicator(list, poolDropTarget(list, event.clientY, dragFrom));
  });
  list.addEventListener('dragleave', event => {
    if (!list.contains(event.relatedTarget)) clearPoolDropIndicators(list);
  });
  list.addEventListener('drop', event => {
    if (dragFrom === null) return;
    event.preventDefault();
    const target = poolDropTarget(list, event.clientY, dragFrom);
    const from = dragFrom;
    clearPoolDropIndicators(list);
    if (target) void reorderPoolMember(from, target.to);
  });
  list.querySelectorAll('.pool-member-row[draggable="true"]').forEach(row => {
    row.addEventListener('dragstart', event => {
      if (event.target.closest('button, summary, details, a, input, select')) {
        event.preventDefault();
        return;
      }
      dragFrom = Number.parseInt(row.dataset.index ?? '', 10);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', row.dataset.index ?? '');
      row.setAttribute('aria-grabbed', 'true');
      requestAnimationFrame(() => row.classList.add('dragging'));
    });
    row.addEventListener('dragend', () => {
      dragFrom = null;
      row.classList.remove('dragging');
      row.setAttribute('aria-grabbed', 'false');
      clearPoolDropIndicators(list);
    });
    row.addEventListener('keydown', event => {
      const from = Number.parseInt(row.dataset.index ?? '', 10);
      const total = poolData()?.members?.length ?? 0;
      if (!Number.isInteger(from)) return;
      if (event.altKey && event.key === 'ArrowUp' && from > 0) {
        event.preventDefault();
        void reorderPoolMember(from, from - 1, { focus: true });
      } else if (event.altKey && event.key === 'ArrowDown' && from < total - 1) {
        event.preventDefault();
        void reorderPoolMember(from, from + 1, { focus: true });
      }
    });
  });
}

// ─── Favorites CRUD ───────────────────────────────────────────────────────────

function addToFavorites(fav, listType) {
  if (listType === 'codex-subagents') {
    if (state.codexSubagentModels.length >= CODEX_SUBAGENT_MAX) return;
    if (state.codexSubagentModels.some(item => item.providerId === fav.providerId && item.modelId === fav.modelId)) return;
    state.codexSubagentModels = [...state.codexSubagentModels, fav];
    saveFavorites({ codexSubagentModels: state.codexSubagentModels });
    renderCodexSubagentList();
    updateCodexSubagentCounter();
  } else {
    if (state.generalFavorites.some(item => item.providerId === fav.providerId && item.modelId === fav.modelId)) return;
    state.generalFavorites = [...state.generalFavorites, fav];
    saveFavorites({ favoriteModels: state.generalFavorites });
    renderFavList();
  }
}

function removeFromFavorites(index, listType) {
  if (listType === 'codex-subagents') {
    const prev = [...state.codexSubagentModels];
    state.codexSubagentModels = state.codexSubagentModels.filter((_, i) => i !== index);
    saveFavorites({ codexSubagentModels: state.codexSubagentModels });
    renderCodexSubagentList(); updateCodexSubagentCounter();
    showToast('Removed from Codex SubAgent', () => {
      state.codexSubagentModels = prev;
      saveFavorites({ codexSubagentModels: state.codexSubagentModels });
      renderCodexSubagentList(); updateCodexSubagentCounter();
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
  const arr = listType === 'codex-subagents' ? [...state.codexSubagentModels] : [...state.generalFavorites];
  const prev = [...arr];
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item);
  if (listType === 'codex-subagents') {
    state.codexSubagentModels = arr;
    saveFavorites({ codexSubagentModels: state.codexSubagentModels });
    renderCodexSubagentList();
  } else {
    state.generalFavorites = arr;
    saveFavorites({ favoriteModels: state.generalFavorites });
    renderFavList();
  }
  showToast('Order saved', () => {
    if (listType === 'codex-subagents') {
      state.codexSubagentModels = prev;
      saveFavorites({ codexSubagentModels: state.codexSubagentModels });
      renderCodexSubagentList();
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

  const favIntel = intelligenceOfModel(fav.providerId, fav.modelId);
  const intelEl = favIntel ? document.createElement('span') : null;
  if (intelEl) { intelEl.className = 'intel-badge'; intelEl.textContent = `IQ ${favIntel.score.toFixed(1)}`; intelEl.title = intelTooltipText(favIntel); }

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
  if (intelEl) item.appendChild(intelEl);
  item.appendChild(provBadge);
  const testBtn = document.createElement('button');
  testBtn.className = 'btn btn-ghost';
  testBtn.textContent = 'Test';
  testBtn.draggable = false;
  testBtn.title = 'Send a short query to check this model responds. Uses provider quota.';
  testBtn.setAttribute('aria-label', `Test ${fav.modelId}`);
  testBtn.addEventListener('click', event => {
    event.stopPropagation();
    testModelResponse(testBtn, fav.providerId, fav.modelId);
  });
  item.appendChild(testBtn);
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
    const arr = listType === 'codex-subagents' ? state.codexSubagentModels : state.generalFavorites;
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

function renderCodexSubagentList() {
  const list = document.getElementById('codex-subagent-list');
  if (!list) return;
  list.innerHTML = '';
  if (state.codexSubagentModels.length === 0) {
    list.innerHTML = '<div class="fav-empty">No Codex SubAgent configured yet. Search above to add one.</div>';
  } else {
    state.codexSubagentModels.forEach((f, i) => list.appendChild(buildFavItem(f, i, 'codex-subagents')));
  }
  updateCodexSubagentCounter();
}

function updateCodexSubagentCounter() {
  const count = state.codexSubagentModels.length;
  const counter = document.getElementById('codex-subagent-slot-count');
  if (counter) counter.innerHTML = `${count}<span class="agy-slot-max">/${CODEX_SUBAGENT_MAX}</span>`;
  const pips = document.getElementById('codex-subagent-pips');
  if (pips) {
    pips.innerHTML = '';
    for (let i = 0; i < CODEX_SUBAGENT_MAX; i++) {
      const pip = document.createElement('div');
      pip.className = 'agy-pip' + (i < count ? ' filled' : '');
      pips.appendChild(pip);
    }
  }
}

// ─── Sidebar nav highlight ────────────────────────────────────────────────────

function isServerAdminUi() {
  return document.documentElement.dataset.uiMode === 'server';
}

function initNav() {
  const navItems = [...document.querySelectorAll('.nav-item')];
  const content = document.getElementById('content');
  const sections = [...content.querySelectorAll(':scope > .section:not(.provider-model-browser)')];
  const available = navItems.filter(item => !isServerAdminUi()
    || !['apps', 'antigravity'].includes(item.dataset.section));
  content.classList.add('section-navigation');

  function applyRoute(focus = false) {
    const providerId = providerIdFromHash();
    const requested = window.location.hash.slice(1);
    const selected = providerId ? 'providers'
      : available.find(item => item.dataset.section === requested)?.dataset.section ?? 'providers';
    if (!providerId && requested && requested !== selected) {
      window.history.replaceState(null, '', `#${selected}`);
    }
    sections.forEach(section => {
      section.classList.toggle('section-active', section.id === selected);
    });
    navItems.forEach(item => {
      const active = item.dataset.section === selected;
      item.classList.toggle('active', active);
      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    closeModelFavPopover();
    syncProviderModelBrowserFromHash();
    content.scrollTop = 0;
    if (focus) {
      const heading = document.querySelector(providerId
        ? '#provider-model-browser h1' : `#${selected} h1`);
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
    }
  }

  navItems.forEach(item => item.addEventListener('click', event => {
    // Keep modified clicks usable as ordinary links in another tab.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const hash = item.getAttribute('href');
    if (window.location.hash !== hash) window.location.hash = hash;
    // Same-hash clicks have no hashchange event, but must still align the view.
    applyRoute(true);
  }));
  window.addEventListener('hashchange', () => applyRoute(true));
  applyRoute();
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
  await refreshIntelligenceActive();
  try {
    await loadModels();
    state.modelsLoaded = true;
  } catch (err) {
    state.modelsError = String(err);
    state.modelsLoaded = true;
  }
  // Keep the Providers header counts in sync after add / delete / OAuth / refresh.
  renderProviderStats();
  // Saved readings; accounts never checked (new install or sign-in) are checked once by the server.
  void loadUsage();
  // Server tab caches its provider checklist — invalidate so new providers appear without a full reload.
  invalidateServerProviderCache();
}

function invalidateServerProviderCache() {
  state.server.form.providersLoaded = false;
  if (state.server.status?.running) return;
  if (state.server.form.expose !== 'specific') return;
  if (!document.getElementById('server-panel')) return;
  void loadServerProviders().then(() => renderServerPanel());
}

async function init() {
  initTheme();
  initNav();
  void initUpdateIndicator();

  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
  window.addEventListener('hashchange', () => {
    if (window.location.hash === '#free-pool' || window.location.hash === '#pool-activity') void loadFreePool();
  });

  await loadConfig();
  void loadFreePool();
  renderFavList();
  renderCodexSubagentList();
  updateGeneralCounter();
  if (!isServerAdminUi()) {
    await loadApps();
    renderApps();
  }
  renderProviders(); // shows skeletons

  initServerPolling();

  // Load templates in parallel with models — re-render providers when done
  loadTemplates().then(() => renderProviders());

  initModels().then(() => {
    renderProviders();
    renderProviderStats();
    if (!isServerAdminUi()) renderApps();
    // Re-render favorites now that we have full provider names
    renderFavList();
    renderCodexSubagentList();
    if (state.modelFilter) buildModelResults(state.modelFilter, 'general');
    if (!isServerAdminUi() && state.codexSubagentFilter) buildModelResults(state.codexSubagentFilter, 'codex-subagents');
    syncProviderModelBrowserFromHash();
  });

  syncProviderModelBrowserFromHash();

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

  document.getElementById('codex-subagent-search')?.addEventListener('input', e => {
    state.codexSubagentFilter = e.target.value;
    buildModelResults(state.codexSubagentFilter, 'codex-subagents');
  });
  document.getElementById('codex-subagent-free-only')?.addEventListener('change', e => {
    state.codexSubagentFreeOnly = e.target.checked;
    buildModelResults(state.codexSubagentFilter, 'codex-subagents');
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

function claudeHttpProxyAvailable(appId) {
  if (appId !== 'claude') return false;
  const selection = getAppSelection(appId);
  if (selection.mode !== 'model') return true;
  const model = state.allModels.find(
    candidate => candidate.providerId === selection.providerId && candidate.id === selection.modelId,
  );
  return Boolean(model?.claudeTransparentCompatible);
}

function matchedAppModels(appId) {
  const localFilter = state.appModelFilters[appId] ?? '';
  const q = (localFilter || state.appModelFilter).trim().toLowerCase();
  const source = state.appModelsByTarget[appId] ?? state.allModels;
  const matched = source.filter(m => {
    const providerName = getProviderName(m.providerId);
    if (state.appFreeOnly && !isFreeModel(m)) return false;
    if (!q) return true;
    return matchesModelSearch(m.id, q)
      || (m.name && matchesModelSearch(m.name, q))
      || matchesModelSearch(providerName, q)
      || (m.providerName && matchesModelSearch(m.providerName, q));
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
          const badge = isFreeModel(m)
            ? `<span class="free-badge ${m.freeStatus === 'free_provider' ? 'dev-access' : ''}">${escapeHtml(freeBadgeLabel(m))}</span>`
            : (m.cost && (m.cost.input > 0 || m.cost.output > 0)
              ? `<span class="free-badge paid-cost">$${m.cost.input}/$${m.cost.output} 1M</span>`
              : '');
          const ctx = fmtCtx(m.contextWindow);
          const idText = ctx ? `${m.id} · ${ctx} ctx` : m.id;
          const encodedProvider = encodeURIComponent(m.providerId);
          const encodedModel = encodeURIComponent(m.id);
          return `
            <button class="launch-model-row" type="button" onclick="selectLaunchModel('${appId}', '${encodedProvider}', '${encodedModel}')">
              <span class="launch-model-name">${escapeHtml(label)}</span>
              ${badge}
              <span class="launch-model-id">${escapeHtml(idText)}</span>
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
    const httpProxyAvailable = claudeHttpProxyAvailable(app.id);
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
            ${app.id === 'claude' ? `
            <label class="claude-proxy-option${httpProxyAvailable ? '' : ' is-disabled'}">
              <input type="checkbox" ${state.appHttpProxy[app.id] && httpProxyAvailable ? 'checked' : ''} ${httpProxyAvailable ? '' : 'disabled'} onchange="setClaudeHttpProxy('${app.id}', this.checked)">
              <span class="claude-proxy-label">
                Native + Relay models
                <span class="claude-proxy-tooltip" tabindex="0" role="img" aria-label="Launches Claude Code through a temporary local connection. Your normal Anthropic login and models continue to work, while compatible Relay AI favorites become available for model switching. The connection closes automatically when Claude Code exits." data-tooltip="Launches Claude Code through a temporary local connection. Your normal Anthropic login and models continue to work, while compatible Relay AI favorites become available for model switching. The connection closes automatically when Claude Code exits.">?</span>
                ${httpProxyAvailable ? '' : '<span class="claude-proxy-unavailable">This selected model cannot be combined with your Anthropic login.</span>'}
              </span>
            </label>
            ` : ''}
            ${app.id === 'codex' || app.id === 'codex-app' ? `
            <label class="claude-proxy-option codex-native-option">
              <input type="checkbox" ${state.appWithNative[app.id] ? 'checked' : ''} onchange="setCodexNativeMode('${app.id}', this.checked)">
              <span class="claude-proxy-label">
                Native + Relay models
                <span class="claude-proxy-tooltip" tabindex="0" role="img" aria-label="Your normal Codex models plus your Relay models (and Codex SubAgent), for this launch only." data-tooltip="Your normal Codex models plus your Relay models (and Codex SubAgent), for this launch only.">?</span>
              </span>
            </label>
            ` : ''}
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

function setCodexNativeMode(appId, enabled) {
  state.appWithNative[appId] = Boolean(enabled);
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
  if (appId === 'claude' && state.appHttpProxy[appId] && claudeHttpProxyAvailable(appId)) {
    body.httpProxy = true;
  }
  if ((appId === 'codex' || appId === 'codex-app') && state.appWithNative[appId]) {
    body.withNative = true;
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
  // Shows the unfiltered list immediately, then swaps in the target-filtered one (hides
  // models incompatible with this app, e.g. too-small context windows) once it loads.
  if (!state.appModelsByTarget[appId] && APP_ID_NEEDS_TARGET_FILTER.has(appId)) {
    loadAppModels(appId).then(() => {
      if (state.appModelOpen === appId) updateLaunchModelMenu(appId, false);
    });
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
  if (appId === 'claude' && !model?.claudeTransparentCompatible) {
    state.appHttpProxy[appId] = false;
  }
  state.appModelOpen = null;
  state.appModelFilters[appId] = '';
  renderApps();
}

function setLaunchFolder(appId, value) {
  state.appLaunchFolders[appId] = value;
}

function setClaudeHttpProxy(appId, checked) {
  state.appHttpProxy[appId] = claudeHttpProxyAvailable(appId) && Boolean(checked);
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
window.setClaudeHttpProxy = setClaudeHttpProxy;
window.setCodexNativeMode = setCodexNativeMode;
window.selectLaunchFolder = selectLaunchFolder;
window.browseLaunchFolder = browseLaunchFolder;
window.saveAppPath = saveAppPath;
window.clearAppPath = clearAppPath;

// Close the launch model picker when clicking outside
document.addEventListener('click', (e) => {
  if (!state.appModelOpen) return;
  // Let the label activate its checkbox before replacing the launch cards.
  // Re-rendering during the label click can remove the input before activation.
  if (e.target.closest('.codex-native-option')) return;
  const wrap = e.target.closest('.launch-model-input-wrap');
  if (!wrap) {
    state.appModelOpen = null;
    renderApps();
  }
});

// ─── Server Gateway ────────────────────────────────────────────────────────
// Runs `relay-ai server` in-process from the browser: same wizard, same
// URLs/model-catalog output, no terminal needed.

async function refreshServerStatus() {
  try {
    const data = await api('GET', '/api/server/status');
    const wasRunning = Boolean(state.server.status?.running);
    state.server.status = data;
    if (!data.running) seedServerFormFromSaved(data.saved);
    const runningChanged = wasRunning !== Boolean(data.running);
    // Full innerHTML replace steals focus from password / search fields — skip while typing.
    if (runningChanged || !isEditingInside(document.getElementById('server-panel'))) {
      renderServerPanel();
    }
  } catch {
    // Transient poll failure — keep showing the last known state.
  }
  updateServerNavBadge();
}

function isEditingInside(root) {
  if (!root) return false;
  const el = document.activeElement;
  if (!el || !root.contains(el)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
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
  f.autostart = Boolean(saved.autostart);
  // Published Docker ports only reach 0.0.0.0 inside the container.
  f.listenMode = isServerAdminUi() || saved.listenMode === 'network' ? 'network' : 'local';
  // Env password (Docker): prefill the field so Start works and clients can copy it.
  // Keychain-saved password: keep "Use saved" (value never sent to the browser).
  if (saved.prefillPassword && !f.password) {
    f.password = saved.prefillPassword;
    f.passwordMode = 'new';
  } else {
    f.passwordMode = saved.hasSavedPassword ? 'saved' : 'new';
  }
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
  // Lazy-load (or re-load after invalidate) when the specific-provider checklist is visible.
  if (!s.status.running && s.form.expose === 'specific' && !s.form.providersLoaded) {
    void loadServerProviders().then(() => renderServerPanel());
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
  const allFreeNote = s.form.freeModelsOnly && s.form.exposedProviders.length === 0
    ? '<div class="server-field-hint">No providers selected — exposing free models from every available provider.</div>'
    : '';

  return `
    <div class="server-providers-picker">
      ${chips ? `<div class="server-provider-chips">${chips}</div>` : ''}
      ${allFreeNote}
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
  const hasEnv = Boolean(s.status?.saved?.hasEnvPassword);
  const showPasswordInput = f.passwordMode === 'new' || !hasSaved;
  const inputType = f.passwordVisible ? 'text' : 'password';

  return `
    <div class="server-network-options">
      ${hasSaved && !hasEnv ? toggleGroupHtml([
        { label: 'Use saved password', active: f.passwordMode === 'saved', onClick: "setServerPasswordMode('saved')" },
        { label: 'Enter new password', active: f.passwordMode === 'new', onClick: "setServerPasswordMode('new')" },
      ]) : ''}
      ${hasEnv && f.passwordMode === 'new' ? '<div class="server-field-hint">Prefilled from RELAY_AI_SERVER_PASSWORD</div>' : ''}
      ${showPasswordInput ? `
        <div class="server-password-row">
          <input type="${inputType}" class="key-input" id="server-password-input" placeholder="Server password" value="${escapeHtml(f.password)}" oninput="setServerPassword(this.value)" autocomplete="off">
          <button type="button" class="btn btn-ghost server-password-reveal" onclick="toggleServerPasswordVisible()" aria-pressed="${f.passwordVisible ? 'true' : 'false'}">${f.passwordVisible ? 'Hide' : 'Reveal'}</button>
        </div>
        <label class="server-toggle-row">
          <input type="checkbox" ${f.savePassword ? 'checked' : ''} onchange="setServerSavePassword(this.checked)">
          <span>Save this password for next time</span>
        </label>
      ` : ''}
    </div>
  `;
}

function renderServerListenField(f) {
  if (isServerAdminUi()) {
    return `<div class="server-field-hint">Network (required in container — use the published host port from the URL cards)</div>${renderServerNetworkOptions()}`;
  }
  const toggle = toggleGroupHtml([
    { label: 'Local only', active: f.listenMode === 'local', onClick: "setServerListenMode('local')" },
    { label: 'Network', active: f.listenMode === 'network', onClick: "setServerListenMode('network')" },
  ]);
  return f.listenMode === 'network' ? `${toggle}${renderServerNetworkOptions()}` : toggle;
}

function renderServerSetup(s) {
  const f = s.form;
  const specific = f.expose === 'specific';
  const hasProviders = f.exposedProviders.length > 0;
  // Free-only with no providers selected = expose free models from every provider
  // (backend: exposedProviders null + freeModelsOnly). Otherwise require a selection.
  const providersOk = f.expose === 'favorites'
    || (specific && hasProviders)
    || (specific && f.freeModelsOnly);
  const passwordOk = f.listenMode !== 'network' || f.passwordMode === 'saved' || f.password.trim().length > 0;
  const canStart = providersOk && passwordOk && !s.starting;

  let hint = '';
  if (!providersOk) {
    hint = f.freeModelsOnly
      ? 'Select at least one provider, or leave none selected to expose free models from all providers.'
      : 'Select at least one provider to expose.';
  } else if (!passwordOk) {
    hint = 'Enter a server password for network mode.';
  }

  const freeModelsHint = specific
    ? 'With providers selected, only their free models are exposed. With none selected, free models from every available provider are exposed.'
    : 'Includes verified $0 models and free developer access.';

  return `
    <div class="server-setup">
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
        <label class="server-toggle-row">
          <input type="checkbox" ${f.autostart ? 'checked' : ''} onchange="setServerAutostart(this.checked)">
          <span>Auto-start API Gateway when relay-ai starts <span class="server-field-hint">(port 17645 auto-starts on service boot)</span></span>
        </label>
        <div class="server-field-hint">${escapeHtml(freeModelsHint)}</div>
      </div>

      <div class="server-field">
        <div class="server-field-label">Listen</div>
        ${renderServerListenField(f)}
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
      <div class="server-models-header">
        <div class="search-field">
          <svg class="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input type="search" class="search-input" placeholder="Search exposed models…" value="${escapeHtml(state.server.modelSearch)}" oninput="setServerModelSearch(this.value)">
        </div>
        <span class="server-models-count" id="server-models-count">${serverModelsCountText()}</span>
      </div>
      <div class="server-model-table-wrap">
        <table class="server-model-table">
          <thead><tr><th>Provider</th><th>Model</th><th>Anthropic ID</th><th>OpenAI ID</th></tr></thead>
          <tbody id="server-model-tbody">${buildServerModelRows()}</tbody>
        </table>
      </div>
    </div>
  `;
}

function filteredServerModels() {
  const models = state.server.status?.models ?? [];
  const q = state.server.modelSearch.trim().toLowerCase();
  if (!q) return models;
  return models.filter(m =>
    m.providerLabel.toLowerCase().includes(q)
    || m.name.toLowerCase().includes(q)
    || m.anthropicId.toLowerCase().includes(q)
    || m.openaiId.toLowerCase().includes(q)
  );
}

function buildServerModelRows() {
  const rows = filteredServerModels().map(m => `
    <tr>
      <td>${escapeHtml(m.providerLabel)}</td>
      <td>${escapeHtml(m.name)}</td>
      <td>${serverIdCell(m.anthropicId)}</td>
      <td>${serverIdCell(m.openaiId)}</td>
    </tr>
  `).join('');
  const total = state.server.status?.models?.length ?? 0;
  if (rows) return rows;
  return `<tr><td colspan="4" class="fav-empty">${total === 0 ? 'No models exposed.' : 'No models match your search.'}</td></tr>`;
}

function serverModelsCountText() {
  const total = state.server.status?.models?.length ?? 0;
  const shown = filteredServerModels().length;
  return shown === total ? `${total} model${total !== 1 ? 's' : ''}` : `Showing ${shown} of ${total} models`;
}

function setServerModelSearch(value) {
  state.server.modelSearch = value;
  const tbody = document.getElementById('server-model-tbody');
  if (tbody) tbody.innerHTML = buildServerModelRows();
  const count = document.getElementById('server-models-count');
  if (count) count.textContent = serverModelsCountText();
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
  state.server.error = null;
  renderServerPanel();
}

function setServerAutostart(checked) {
  state.server.form.autostart = checked;
  api('POST', '/api/server/config', { autostart: checked }).catch(() => {});
  renderServerPanel();
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

function toggleServerPasswordVisible() {
  state.server.form.passwordVisible = !state.server.form.passwordVisible;
  renderServerPanel();
  document.getElementById('server-password-input')?.focus();
}

function setServerSavePassword(checked) {
  state.server.form.savePassword = checked;
}

async function submitServerStart() {
  const f = state.server.form;
  state.server.starting = true;
  state.server.error = null;
  renderServerPanel();

  const body = {
    favoritesOnly: f.expose === 'favorites',
    freeModelsOnly: f.freeModelsOnly,
    // Empty specific selection + free-only → null (all providers, free filter applied server-side).
    exposedProviders: f.expose === 'specific' && f.exposedProviders.length > 0
      ? f.exposedProviders
      : null,
    maskGatewayIds: f.maskGatewayIds,
    listenMode: f.listenMode,
    autostart: f.autostart,
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
    showToast('Server started');
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

function serverIdCell(id) {
  const value = String(id ?? '');
  if (!value) return '<span class="server-id-empty">—</span>';
  return `
    <div class="server-id-cell">
      <code title="${escapeHtml(value)}">${escapeHtml(value)}</code>
      <button type="button" class="btn btn-ghost btn-sm server-id-copy" onclick='copyPlainText(${JSON.stringify(value)})'>Copy</button>
    </div>
  `;
}

async function copyPlainText(text) {
  try {
    await copyTextToClipboard(text);
    showToast('Copied to clipboard');
  } catch {
    showToast('Could not copy — copy manually');
  }
}

async function copyServerValue(id) {
  const el = document.getElementById(id);
  if (!el) return;
  await copyPlainText(el.dataset.value ?? el.textContent);
}

function toggleServerApiKeyVisibility() {
  const el = document.getElementById('server-api-key-value');
  if (!el) return;
  const masked = el.classList.toggle('masked');
  el.textContent = masked ? '••••••••••••' : (el.dataset.value ?? '');
}

window.setServerExpose = setServerExpose;
window.toggleServerProvider = toggleServerProvider;
window.setServerProviderSearch = setServerProviderSearch;
window.setServerModelSearch = setServerModelSearch;
window.setServerMask = setServerMask;
window.setServerFreeModelsOnly = setServerFreeModelsOnly;
window.setServerListenMode = setServerListenMode;
window.setServerAutostart = setServerAutostart;
window.setServerPasswordMode = setServerPasswordMode;
window.setServerPassword = setServerPassword;
window.toggleServerPasswordVisible = toggleServerPasswordVisible;
window.setServerSavePassword = setServerSavePassword;
window.submitServerStart = submitServerStart;
window.stopServerGateway = stopServerGateway;
window.copyServerValue = copyServerValue;
window.copyPlainText = copyPlainText;
window.toggleServerApiKeyVisibility = toggleServerApiKeyVisibility;


// ─── Intelligence score (Artificial Analysis, optional, user's own key) ───────

const INTEL_EXPLAIN = 'A single score from Artificial Analysis that combines many tests of reasoning, knowledge and coding. Higher means smarter overall. Use it to compare models, not as a promise for your task. Shown when the model id matches an Artificial Analysis entry (including dated checkpoints like Flash → Flash 1017). Effort variants are not guessed.';

function intelTooltipText(intel) {
  return `Intelligence score ${Number(intel.score).toFixed(1)} (matched to "${intel.name}"). ${INTEL_EXPLAIN} Source: artificialanalysis.ai`;
}

function intelligenceOfModel(providerId, modelId) {
  if (!state.intelligenceActive) return null;
  const provider = state.providers.find(p => p.id === providerId);
  return provider?.models?.find(m => m.id === modelId)?.intelligence ?? null;
}

function intelBadgeInline(item) {
  if (!state.intelligenceActive || !item.intelligence) return '';
  return ` <span class="intel-badge" title="${escapeHtml(intelTooltipText(item.intelligence))}">IQ ${Number(item.intelligence.score).toFixed(1)}</span>`;
}

/** Table header: sortable, with the explanation and the attribution Artificial Analysis requires. */
function intelHeaderHtml() {
  if (!state.intelligenceActive) return '';
  const arrow = state.intelligenceSort === 'desc' ? '▼' : state.intelligenceSort === 'asc' ? '▲' : '↕';
  const label = state.intelligenceSort === 'desc' ? 'smartest first' : state.intelligenceSort === 'asc' ? 'lowest first' : 'click to sort';
  return `<th class="th-intel"><button type="button" class="th-sort" data-intel-sort aria-label="Sort by intelligence score (${label})">Intelligence <span class="sort-arrow" aria-hidden="true">${arrow}</span></button>`
    + ` <span tabindex="0" class="price-help" aria-label="About the intelligence score">ⓘ<span role="tooltip">${escapeHtml(INTEL_EXPLAIN)}</span></span>`
    + `<a class="intel-attrib" href="https://artificialanalysis.ai/" target="_blank" rel="noopener">via artificialanalysis.ai</a></th>`;
}

function intelCellHtml(item) {
  if (!state.intelligenceActive) return '';
  if (!item.intelligence) return '<td class="intel-cell"><span class="intel-none" title="No matching score on artificialanalysis.ai (only models they publish an Intelligence Index for)">—</span></td>';
  return `<td class="intel-cell"><span class="intel-score" title="${escapeHtml(intelTooltipText(item.intelligence))}">${Number(item.intelligence.score).toFixed(1)}</span></td>`;
}

/** Wire the header click: smartest first → lowest first → original order. */
function bindIntelSort(root, rerender) {
  root?.querySelectorAll('[data-intel-sort]').forEach(button => button.addEventListener('click', () => {
    state.intelligenceSort = state.intelligenceSort === null ? 'desc' : state.intelligenceSort === 'desc' ? 'asc' : null;
    rerender();
  }));
}

async function refreshIntelligenceActive() {
  try {
    const status = await api('GET', '/api/intelligence/status');
    state.intelligenceActive = Boolean(status?.hasKey) && Number(status?.modelCount) > 0;
  } catch { state.intelligenceActive = false; }
  if (!state.intelligenceActive) state.intelligenceSort = null;
}

async function loadIntelligencePanel() {
  const panel = document.getElementById('intelligence-panel');
  if (!panel) return;
  let status;
  try { status = await api('GET', '/api/intelligence/status'); } catch { status = null; }
  if (!status) { panel.innerHTML = '<div class="fav-empty">Could not load. Try again.</div>'; return; }
  const when = status.fetchedAt ? new Date(status.fetchedAt).toLocaleString() : null;
  panel.innerHTML = `
    <div class="intel-card">
      <h3>What the score means</h3>
      <p>Artificial Analysis tests models on many hard tasks (reasoning, knowledge, coding) and combines the results into one <strong>Intelligence Index</strong>. Higher is smarter. It is a comparison aid, not a guarantee for your own work, and it only shows for models whose name matches exactly.</p>
      <p class="intel-source">Data: <a href="${escapeHtml(status.sourceUrl)}" target="_blank" rel="noopener">artificialanalysis.ai</a></p>
    </div>
    <div class="intel-card">
      <h3>How to get a free key</h3>
      <ol class="intel-steps">
        <li>Create a free account at <a href="https://artificialanalysis.ai/login" target="_blank" rel="noopener">artificialanalysis.ai/login</a>.</li>
        <li>Open <a href="https://artificialanalysis.ai/api-key-management-redirect" target="_blank" rel="noopener">API key management</a> and create a key.</li>
        <li>Paste it below. The free plan allows 100 requests a day; a refresh uses about 4.</li>
      </ol>
      <p class="intel-tip"><strong>Google sign-in blocked?</strong> If you see "Access blocked" or any problem signing in with Google, create the account with your <strong>email address</strong> instead on that same page, then create the key.</p>
    </div>
    <div class="intel-card">
      <h3>${status.hasKey ? 'Connected' : 'Connect your key'}</h3>
      ${status.hasKey ? `<p>${status.modelCount} scored models${status.indexVersion ? ` · Index v${escapeHtml(String(status.indexVersion))}` : ''}${when ? ` · updated ${escapeHtml(when)}` : ''}. Refreshes automatically once a day.</p>` : ''}
      <div class="key-row">
        <input id="intel-key" class="key-input" type="password" autocomplete="off" placeholder="${status.hasKey ? 'Paste a new key to replace the current one' : 'Paste Artificial Analysis API key'}">
        <button id="intel-save" class="btn btn-primary" type="button">${status.hasKey ? 'Replace key' : 'Save & download'}</button>
      </div>
      <div class="key-row">
        ${status.hasKey ? '<button id="intel-refresh" class="btn btn-ghost" type="button">Refresh now</button><button id="intel-remove" class="btn btn-ghost" type="button">Remove key &amp; scores</button>' : ''}
      </div>
      <div id="intel-feedback" class="key-feedback"></div>
    </div>`;
  const feedback = document.getElementById('intel-feedback');
  const say = (text, tone) => { feedback.textContent = text; feedback.className = `key-feedback ${tone}`; };
  const reload = async () => { await loadIntelligencePanel(); state.modelsLoaded = false; await initModels(); renderProviders(); };
  document.getElementById('intel-save').addEventListener('click', async () => {
    const key = document.getElementById('intel-key').value.trim();
    if (!key) { say('Paste your API key first.', 'error'); return; }
    say('Checking the key and downloading scores…', 'muted');
    const result = await api('POST', '/api/intelligence/key', { key });
    if (!result.ok) { say(result.error ?? 'Could not use that key.', 'error'); return; }
    showToast(`Intelligence scores downloaded (${result.modelCount} models)`);
    await reload();
  });
  document.getElementById('intel-refresh')?.addEventListener('click', async () => {
    say('Downloading scores…', 'muted');
    const result = await api('POST', '/api/intelligence/refresh');
    if (!result.ok) { say(result.error ?? 'Refresh failed.', 'error'); return; }
    showToast(`Scores updated (${result.modelCount} models)`);
    await reload();
  });
  document.getElementById('intel-remove')?.addEventListener('click', async () => {
    if (!window.confirm('Remove your Artificial Analysis key and the downloaded scores?')) return;
    await api('POST', '/api/intelligence/remove');
    await reload();
  });
}

window.addEventListener('hashchange', () => { if (window.location.hash === '#intelligence') void loadIntelligencePanel(); });
if (window.location.hash === '#intelligence') void loadIntelligencePanel();
