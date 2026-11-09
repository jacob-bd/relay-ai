import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../src/ui/public/app.js', import.meta.url), 'utf8');
const controller = source.slice(source.indexOf('function initNav() {'), source.indexOf('// ─── Provider stats'));
function setup(hash = '', server = false) {
  const classes = () => {
    const values = new Set<string>();
    return { add: (s: string) => values.add(s), contains: (s: string) => values.has(s),
      toggle: (s: string, on: boolean) => on ? values.add(s) : values.delete(s) };
  };
  const ids = ['providers', 'favorites', 'section-codex-subagents', 'apps', 'server'];
  const items = ids.map(id => ({ dataset: { section: id }, classList: classes(), attrs: new Map(),
    click: (_event: any) => {}, addEventListener(_name: string, fn: any) { this.click = fn; },
    getAttribute: () => `#${id}`, setAttribute(k: string, v: string) { this.attrs.set(k, v); },
    removeAttribute(k: string) { this.attrs.delete(k); } }));
  const sections = ids.map(id => ({ id, classList: classes() }));
  const heading = { setAttribute: vi.fn(), focus: vi.fn() };
  const content = { classList: classes(), scrollTop: 900, querySelectorAll: () => sections };
  const events = new Map<string, () => void>();
  const window = { location: { hash }, history: { replaceState: vi.fn((_s, _t, h) => { window.location.hash = h; }) },
    addEventListener: (name: string, fn: any) => events.set(name, fn) };
  const sync = vi.fn();
  runInNewContext(controller + '\ninitNav();', {
    document: { querySelectorAll: () => items, getElementById: () => content, querySelector: () => heading },
    window, isServerAdminUi: () => server,
    providerIdFromHash: () => window.location.hash.startsWith('#provider/') ? 'groq' : null,
    syncProviderModelBrowserFromHash: sync, closeModelFavPopover: vi.fn(),
  });
  return { items, sections, content, window, heading, sync, navigate(hash: string) {
    window.location.hash = hash; events.get('hashchange')!();
  }, click(id: string, extra = {}) {
    const preventDefault = vi.fn();
    items.find(i => i.dataset.section === id)!.click({ button: 0, preventDefault, ...extra });
    return preventDefault;
  }, selected: () => items.filter(i => i.classList.contains('active')).map(i => i.dataset.section),
  visible: () => sections.filter(s => s.classList.contains('section-active')).map(s => s.id) };
}

describe('sidebar section routing', () => {
  it('selects a deep link immediately, before any asynchronous model loading', () => {
    const ui = setup('#apps');
    expect(ui.selected()).toEqual(['apps']); expect(ui.visible()).toEqual(['apps']);
    expect(ui.content.scrollTop).toBe(0);
  });
  it.each(['favorites', 'apps', 'server', 'section-codex-subagents'])('one click exits provider browser to %s', id => {
    const ui = setup('#provider/groq');
    ui.click(id);
    expect(ui.window.location.hash).toBe(`#${id}`);
    expect(ui.selected()).toEqual([id]); expect(ui.visible()).toEqual([id]);
    expect(ui.content.scrollTop).toBe(0);
    expect(ui.heading.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(ui.items.find(i=>i.dataset.section===id)!.attrs.get('aria-current')).toBe('page');
  });
  it('realigns on same-section clicks without requiring a hashchange', () => {
    const ui = setup('#favorites'); ui.content.scrollTop=800; ui.click('favorites');
    expect(ui.content.scrollTop).toBe(0); expect(ui.selected()).toEqual(['favorites']);
  });
  it('handles back/forward and provider deep links through the same route handler', () => {
    const ui=setup('#apps'); ui.navigate('#favorites'); expect(ui.visible()).toEqual(['favorites']);
    ui.navigate('#provider/groq'); expect(ui.selected()).toEqual(['providers']); expect(ui.sync).toHaveBeenCalledTimes(3);
    ui.navigate('#apps'); expect(ui.selected()).toEqual(['apps']);
  });
  it('does not hijack modified link clicks', () => {
    const ui=setup(); expect(ui.click('favorites',{ctrlKey:true})).not.toHaveBeenCalled();
    expect(ui.window.location.hash).toBe('');
  });
  it.each(['#missing','#apps'])('normalizes unsupported/hidden server routes %s', hash => {
    const ui=setup(hash,true); expect(ui.visible()).toEqual(['providers']); expect(ui.window.location.hash).toBe('#providers');
  });
  it('keeps the visible Codex SubAgent link usable in server mode', () => {
    expect(setup('#section-codex-subagents',true).visible()).toEqual(['section-codex-subagents']);
  });
});

describe('provider model browser state reset', () => {
  const browserCode = source.slice(
    source.indexOf('function openProviderModelBrowser(providerId) {'),
    source.indexOf('let activeModelFavPopover = null;'),
  );

  it('clears providerModelFreeOnly when switching providers or exiting to a section', () => {
    const state: any = {
      activeProviderId: 'provider-1',
      providerModelFilter: 'gpt',
      providerModelMinCtx: 128000,
      providerModelFreeOnly: true,
      providerModelPage: 3,
    };
    const content = { classList: { toggle: vi.fn() }, scrollTop: 0 };
    const navItems = [{ classList: { toggle: vi.fn() }, dataset: { section: 'providers' } }];
    const window = { location: { hash: '#provider/provider-1' } };
    let hashProviderId: string | null = 'provider-1';
    const renderProviderModelBrowser = vi.fn();

    const ctx = {
      state,
      window,
      document: {
        getElementById: () => content,
        querySelectorAll: () => navItems,
      },
      providerIdFromHash: () => hashProviderId,
      renderProviderModelBrowser,
      encodeURIComponent,
    };

    runInNewContext(browserCode, ctx);

    // 1. Same provider: does not reset freeOnly while browsing
    (ctx as any).syncProviderModelBrowserFromHash();
    expect(state.providerModelFreeOnly).toBe(true);

    // 2. Switch provider via openProviderModelBrowser: resets freeOnly
    (ctx as any).openProviderModelBrowser('provider-2');
    expect(state.providerModelFreeOnly).toBe(false);
    expect(state.providerModelFilter).toBe('');
    expect(state.providerModelMinCtx).toBe(0);
    expect(state.providerModelPage).toBe(1);
    expect(window.location.hash).toBe('provider/provider-2');

    // 3. User checks freeOnly again in provider-2
    state.providerModelFreeOnly = true;
    hashProviderId = 'provider-2';
    state.activeProviderId = 'provider-2';

    // 4. Exiting to a section (hashProviderId becomes null): clears freeOnly
    hashProviderId = null;
    (ctx as any).syncProviderModelBrowserFromHash();
    expect(state.providerModelFreeOnly).toBe(false);
    expect(state.activeProviderId).toBeNull();
  });
});

describe('pool activity timestamp formatting', () => {
  const formatCode = source.slice(
    source.indexOf('function formatPoolActivityTime(when) {'),
    source.indexOf('// Which pool member is answering'),
  );

  it('formats activity timestamps with date and time', () => {
    const ctx = {};
    runInNewContext(formatCode, ctx);
    const date = new Date(2026, 10, 8, 17, 45, 50); // Nov 8 2026 17:45:50
    const formatted = (ctx as any).formatPoolActivityTime(date);
    expect(formatted).toContain('Nov 8');
    expect(formatted).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });
});
