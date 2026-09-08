import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// Exercise the browser controller without bootstrapping unrelated app launch APIs.
const source = readFileSync(new URL('../src/ui/public/app.js', import.meta.url), 'utf8');
const controller = source.slice(source.indexOf('function buildManualModelPanel('), source.indexOf('function buildTemplateCard('));

class Element {
  children: Element[] = [];
  listeners = new Map<string, (event: any) => void>();
  attributes = new Map<string, string>();
  textContent = '';
  className = '';
  name = '';
  value = '';
  type = '';
  disabled = false;
  constructor(public tag: string) {}
  append(...children: Element[]) { this.children.push(...children); }
  appendChild(child: Element) { this.append(child); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  addEventListener(name: string, callback: (event: any) => void) { this.listeners.set(name, callback); }
  reportValidity() { return true; }
  set innerHTML(_value: string) { throw new Error('Manual model values must use DOM text, not HTML'); }
  fire(name: string) { this.listeners.get(name)?.({ preventDefault() {} }); }
  all(): Element[] { return [this, ...this.children.flatMap(child => child.all())]; }
}

function setup(manualModels: any[] = []) {
  const provider = { id: 'custom-test', manualModels };
  const state = { manualModelForms: new Map(), activeProviderId: provider.id, appModelsByTarget: { codex: ['stale'] }, modelsError: null };
  const api = vi.fn().mockResolvedValue({ ok: true });
  const confirm = vi.fn().mockReturnValue(true);
  const initModels = vi.fn().mockResolvedValue(undefined);
  const sandbox: any = {
    state, api, window: { confirm }, document: { createElement: (tag: string) => new Element(tag) },
    initModels, renderProviders: vi.fn(), renderFavList: vi.fn(), isServerAdminUi: () => true,
    renderCodexSubagentList: vi.fn(), renderAgyList: vi.fn(), renderApps: vi.fn(),
    renderProviderModelBrowser: () => { panel = sandbox.buildManualModelPanel(provider); },
  };
  runInNewContext(controller, sandbox);
  let panel: Element = sandbox.buildManualModelPanel(provider);
  const input = (name: string, value: string) => {
    const field = panel.all().find(e => e.name === name)!;
    field.value = value;
    field.fire('input');
  };
  return { state, api, confirm, initModels, input, sandbox,
    panel: () => panel, submit: () => panel.all().find(e => e.tag === 'form')!.fire('submit'),
    remove: () => panel.all().find(e => e.textContent === 'Remove manual entry')!.fire('click'),
    draft: () => state.manualModelForms.get(provider.id),
  };
}

describe('manual model UI', () => {
  it('preserves input and blocks duplicate requests across re-renders while validation is pending', async () => {
    const ui = setup();
    let finish!: (result: any) => void;
    ui.api.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    ui.input('modelId', ' model/new ');
    ui.input('displayName', ' Test model ');
    ui.input('contextWindow', '128000');
    ui.submit();
    expect(ui.draft().pending).toBe(true);
    expect(ui.panel().all().filter(e => e.tag === 'input').every(e => e.disabled)).toBe(true);
    ui.submit();
    expect(ui.api).toHaveBeenCalledExactlyOnceWith('POST', '/api/providers/models/add', {
      providerId: 'custom-test', modelId: 'model/new', displayName: 'Test model', contextWindow: 128000,
    });
    finish({ ok: false, error: '<img src=x onerror=alert(1)> failed validation' });
    await vi.waitFor(() => expect(ui.draft().pending).toBe(false));
    expect(ui.draft()).toMatchObject({ modelId: ' model/new ', displayName: ' Test model ', contextWindow: '128000', status: 'error' });
    expect(ui.panel().all().find(e => e.attributes.get('role') === 'status')?.textContent)
      .toBe('<img src=x onerror=alert(1)> failed validation');
    expect(ui.initModels).not.toHaveBeenCalled();
  });

  it('clears successful input and invalidates launch catalogs in server admin mode', async () => {
    const ui = setup();
    ui.input('modelId', 'model/new');
    ui.submit();
    await vi.waitFor(() => expect(ui.draft().pending).toBe(false));
    expect(ui.draft()).toMatchObject({ modelId: '', displayName: '', contextWindow: '', status: 'success' });
    expect(ui.state.appModelsByTarget).toEqual({});
    expect(ui.initModels).toHaveBeenCalledOnce();
    expect(ui.sandbox.renderApps).not.toHaveBeenCalled();
  });

  it('retains input and releases controls after a network error', async () => {
    const ui = setup();
    ui.api.mockRejectedValue(new Error('offline'));
    ui.input('modelId', 'model/new');
    ui.submit();
    await vi.waitFor(() => expect(ui.draft().pending).toBe(false));
    expect(ui.draft()).toMatchObject({ modelId: 'model/new', status: 'error' });
    expect(ui.panel().all().find(e => e.type === 'submit')?.disabled).toBe(false);
  });

  it.each(['0', '-1', '1.5', 'NaN', '9007199254740992'])('rejects invalid context tokens %s before making paid requests', value => {
    const ui = setup();
    ui.input('modelId', 'model/new');
    ui.input('contextWindow', value);
    ui.submit();
    expect(ui.api).not.toHaveBeenCalled();
    expect(ui.draft().status).toBe('error');
  });

  it('renders manual names safely and requires confirmation before removal', async () => {
    const ui = setup([{ id: 'model/new', name: '<img src=x onerror=alert(1)>', validatedAt: '2026-09-08T12:00:00Z' }]);
    expect(ui.panel().all().find(e => e.className === 'manual-model-entry-name')?.textContent)
      .toBe('<img src=x onerror=alert(1)> (model/new)');
    ui.confirm.mockReturnValue(false);
    ui.remove();
    expect(ui.api).not.toHaveBeenCalled();
    ui.confirm.mockReturnValue(true);
    ui.remove();
    await vi.waitFor(() => expect(ui.draft().pending).toBe(false));
    expect(ui.api).toHaveBeenCalledExactlyOnceWith('POST', '/api/providers/models/remove', { providerId: 'custom-test', modelId: 'model/new' });
    expect(ui.draft().status).toBe('success');
  });
});
