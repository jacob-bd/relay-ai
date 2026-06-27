// ─── State ───────────────────────────────────────────────────────────────────

const AGY_MAX = 6;

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
  agyFilter: '',
  providerNameMap: {}, // providerId → full display name
};

// ─── Provider logos via Simple Icons CDN ─────────────────────────────────────
// https://simpleicons.org — monochrome SVG brand marks, white on dark bg.
// Format: https://cdn.simpleicons.org/{slug}/ffffff

// Inline SVGs for providers whose official domains block hotlinking.
// White fill, renders on gradient background.
const PROVIDER_INLINE_SVGS = {
  openai: `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg" style="width:20px;height:20px"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.896zm16.597 3.855l-5.843-3.368L15.115 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.403-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>`,
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
  // xAI — official favicon from x.ai
  xai:          'https://x.ai/favicon.ico',
  'xai-oauth':  'https://x.ai/favicon.ico',
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

  // Always use full display names
  state.providerNameMap['zen'] = 'OpenCode Zen';
  state.providerNameMap['go']  = 'OpenCode Go';

  for (const p of state.providers) {
    state.providerNameMap[p.id] = p.name;
    for (const m of p.models ?? []) flat.push({ id: m.id, name: m.name, providerId: p.id, providerName: p.name, contextWindow: null });
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
  for (const m of data.zenModels ?? []) flat.push(m);
  for (const m of data.goModels ?? []) flat.push(m);
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
      ? `<img src="${logo.content}" class="provider-logo-img" alt="${displayName}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="provider-logo-fallback" style="display:none">${initial}</span>`
      : initial;

  header.innerHTML = `
    <div class="provider-icon" style="background:linear-gradient(135deg,${c1},${c2})">${logoHtml}</div>
    <div class="provider-info">
      <div class="provider-name">${displayName}</div>
      <div class="provider-models-count">${provider.modelCount ?? provider.models?.length ?? 0} models</div>
    </div>
    <div class="provider-status">
      <span class="status-chip ${provider.hasKey ? 'has-key' : 'no-key'}">
        ${provider.hasKey ? 'Key stored' : 'Not configured'}
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

  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-primary';
  addBtn.textContent = 'Add Provider';
  addBtn.style.marginTop = '4px';

  const feedback = document.createElement('div');
  feedback.className = 'key-feedback';

  content.appendChild(row('Provider name', nameInput));
  content.appendChild(row('Base URL', urlInput));
  content.appendChild(row('API key', keyInput));
  content.appendChild(addBtn);
  content.appendChild(feedback);

  addBtn.addEventListener('click', async () => {
    const displayName = nameInput.value.trim();
    const baseUrl = urlInput.value.trim();
    const apiKey = keyInput.value.trim();

    if (!displayName) { feedback.textContent = 'Enter a provider name.'; feedback.className = 'key-feedback error'; return; }
    if (!baseUrl) { feedback.textContent = 'Enter a base URL.'; feedback.className = 'key-feedback error'; return; }
    if (isAnthropicKind && !apiKey) { feedback.textContent = 'API key is required for Anthropic-compatible providers.'; feedback.className = 'key-feedback error'; return; }

    addBtn.disabled = true;
    feedback.textContent = 'Connecting and fetching models…';
    feedback.className = 'key-feedback muted';

    const result = await api('POST', '/api/providers/add-custom', { kind, displayName, baseUrl, apiKey });

    addBtn.disabled = false;
    if (result.ok) {
      feedback.textContent = `✓ ${displayName} added · ${result.count} models available`;
      feedback.className = 'key-feedback success';
      nameInput.value = '';
      urlInput.value = '';
      keyInput.value = '';
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

  const isPkce = template.subscriptionRisk === true;

  const note = document.createElement('div');
  note.style.cssText = 'font-size:13px;color:var(--text-secondary,#aaa);margin-bottom:10px';
  note.textContent = isPkce
    ? 'Opens a browser for Google / Anthropic sign-in — no API key required.'
    : 'Sign in via device code — no API key required.';

  const actionRow = document.createElement('div');
  actionRow.className = 'key-row';

  const signInBtn = document.createElement('button');
  signInBtn.className = 'btn btn-primary';
  signInBtn.textContent = 'Sign in';

  const feedback = document.createElement('div');
  feedback.className = 'key-feedback';

  // Subscription-risk providers require explicit acknowledgment before sign-in.
  let riskAcknowledged = !isPkce;
  if (isPkce) {
    signInBtn.disabled = true;

    const isGoogle = template.id === 'antigravity';
    const riskWarn = document.createElement('div');
    riskWarn.style.cssText = 'background:oklch(30% 0.06 60);border:1px solid oklch(60% 0.18 60);border-radius:6px;padding:10px 12px;margin-bottom:10px;font-size:12px;line-height:1.6';
    riskWarn.innerHTML = `<strong style="color:oklch(85% 0.18 60)">⚠ Account risk</strong><br>
      This uses your subscription OAuth token. Routing it through relay-ai may violate
      ${isGoogle ? 'Google' : 'Anthropic'}'s Terms of Service.<br>
      ${isGoogle ? '<strong style="color:oklch(80% 0.18 20)">Do not use your primary Google account.</strong><br>' : ''}
      <label style="display:flex;align-items:center;gap:6px;margin-top:8px;cursor:pointer">
        <input type="checkbox" id="risk-ack-${template.id}" style="cursor:pointer">
        <span style="color:oklch(85% 0.12 60)">I understand the risk and accept it</span>
      </label>`;
    content.appendChild(riskWarn);

    const checkbox = riskWarn.querySelector(`#risk-ack-${template.id}`);
    checkbox.addEventListener('change', () => {
      riskAcknowledged = checkbox.checked;
      signInBtn.disabled = !riskAcknowledged;
    });
  }

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

  const keyRow = document.createElement('div');
  keyRow.className = 'key-row';

  const wrap = document.createElement('div');
  wrap.className = 'key-input-wrap';

  const input = document.createElement('input');
  input.type = 'password';
  input.className = 'key-input';
  input.placeholder = 'Paste API key to add this provider…';
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
    if (!key) { feedback.textContent = 'Enter an API key first.'; feedback.className = 'key-feedback error'; return; }
    addBtn.disabled = true;
    feedback.textContent = 'Validating key and fetching models…';
    feedback.className = 'key-feedback muted';

    const result = await api('POST', '/api/providers/add', { templateId: template.id, key });

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
  input.placeholder = provider.hasKey ? '••••••••  (key already stored)' : 'Paste API key…';
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

  const q = filter.toLowerCase();
  const matched = state.allModels.filter(m =>
    m.id.toLowerCase().includes(q) ||
    (m.name && m.name.toLowerCase().includes(q)) ||
    m.providerName.toLowerCase().includes(q)
  ).slice(0, 40);

  if (matched.length === 0) { container.innerHTML = '<div class="model-results-empty">No models found.</div>'; return; }

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
    return;
  }
  state.generalFavorites.forEach((f, i) => list.appendChild(buildFavItem(f, i, 'general')));
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
  const sectionIds = ['providers', 'favorites', 'antigravity'];
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
  renderProviders(); // shows skeletons

  // Load templates in parallel with models — re-render providers when done
  loadTemplates().then(() => renderProviders());

  initModels().then(() => {
    renderProviders();
    renderProviderStats();
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

  document.getElementById('agy-search').addEventListener('input', e => {
    state.agyFilter = e.target.value;
    buildModelResults(state.agyFilter, 'agy');
  });
}

init();
