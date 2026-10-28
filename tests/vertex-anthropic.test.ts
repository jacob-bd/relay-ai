import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VERTEX_ANTHROPIC_NPM } from '../src/constants.js';
import { getTemplateById, listSupportedTemplates } from '../src/provider-templates.js';
import { aliasModelId } from '../src/proxy.js';
import { addProviderFromTemplate } from '../src/registry/add-template.js';
import { loadRegistry, saveRegistry } from '../src/registry/io.js';
import { loadRegistryProviders } from '../src/registry/load.js';
import { getProviderModels } from '../src/registry/provider-models.js';
import {
  addVertexModelEntry,
  isVertexAnthropicRegistered,
  removeVertexModelEntries,
  vertexModelDisplayName,
} from '../src/registry/vertex-anthropic.js';
import { DEFAULT_VERTEX_MODELS, loadVertexModelEntries, resetVertexModelEntries } from '../src/vertex-env.js';

vi.mock('@napi-rs/keyring', () => ({
  Entry: class { constructor() { throw new Error('isolated test keyring'); } },
}));

const adc = vi.hoisted(() => ({ present: true }));
vi.mock('../src/vertex-env.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/vertex-env.js')>(),
  hasApplicationDefaultCredentials: () => adc.present,
}));

// Fake Vertex: model id → simulated access result (default: allowed).
const access = vi.hoisted(() => ({ results: new Map<string, { ok: boolean; status?: number; error?: string }>() }));
vi.mock('../src/registry/vertex-model-check.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/registry/vertex-model-check.js')>();
  return {
    ...actual,
    filterVertexModelsByAccess: (entries: Parameters<typeof actual.filterVertexModelsByAccess>[0]) =>
      actual.filterVertexModelsByAccess(entries, async id => access.results.get(id) ?? { ok: true }),
  };
});

const POLICY = { ok: false, status: 400, error: 'Organization Policy constraint constraints/vertexai.allowedModels violated' };

const home = () => process.env.RELAY_AI_HOME!;
const template = getTemplateById('vertex-anthropic')!;

describe('Vertex AI (Claude) registry provider', () => {
  const savedProject = process.env.ANTHROPIC_VERTEX_PROJECT_ID;

  beforeEach(() => {
    access.results.clear();
    adc.present = true;
    process.env.ANTHROPIC_VERTEX_PROJECT_ID = 'test-project';
    saveRegistry({ schemaVersion: 1, providers: [] } as never);
    writeFileSync(join(home(), 'vertex-models.json'), JSON.stringify([
      { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' },
      { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', upstream_id: 'claude-opus-5-5@default' },
    ]));
  });

  afterEach(() => {
    if (savedProject === undefined) delete process.env.ANTHROPIC_VERTEX_PROJECT_ID;
    else process.env.ANTHROPIC_VERTEX_PROJECT_ID = savedProject;
    rmSync(join(home(), 'vertex-models.json'), { force: true });
    rmSync(join(home(), 'secrets.json'), { force: true });
  });

  it('is an addable template that never asks for an API key', () => {
    expect(listSupportedTemplates().some(t => t.id === 'vertex-anthropic')).toBe(true);
    expect(template).toMatchObject({ noApiKey: true, apiKeyOptional: true, npm: VERTEX_ANTHROPIC_NPM });
  });

  it('adds without a key and lists vertex-models.json entries in every picker', async () => {
    const result = await addProviderFromTemplate(template, template.id);
    expect(result).toMatchObject({ added: true, modelCount: 2 });
    expect(isVertexAnthropicRegistered()).toBe(true);

    const provider = (await loadRegistryProviders()).find(p => p.id === 'vertex-anthropic');
    expect(provider?.models.map(m => [m.id, m.upstreamModelId, m.npm, m.modelFormat])).toEqual([
      ['claude-sonnet-5-5', 'claude-sonnet-5-5', VERTEX_ANTHROPIC_NPM, 'openai'],
      ['claude-opus-5-5', 'claude-opus-5-5@default', VERTEX_ANTHROPIC_NPM, 'openai'],
    ]);
    expect(provider?.models[0]?.contextWindow).toBe(1_000_000);
  });

  it('reads model edits live, without a refresh', async () => {
    await addProviderFromTemplate(template, template.id);
    writeFileSync(join(home(), 'vertex-models.json'), JSON.stringify([
      { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' },
    ]));
    const stored = loadRegistry().providers.find(p => p.id === 'vertex-anthropic')!;
    expect(getProviderModels(stored).map(m => m.id)).toEqual(['claude-haiku-5-5']);
  });

  it('refuses to add without gcloud credentials or a project', async () => {
    adc.present = false;
    expect(await addProviderFromTemplate(template, template.id)).toMatchObject({
      added: false, hint: 'Run: gcloud auth application-default login',
    });

    adc.present = true;
    delete process.env.ANTHROPIC_VERTEX_PROJECT_ID;
    const noProject = await addProviderFromTemplate(template, template.id);
    expect(noProject.added).toBe(false);
    expect(noProject.hint).toContain('ANTHROPIC_VERTEX_PROJECT_ID');
    expect(isVertexAnthropicRegistered()).toBe(false);
  });

  it('scopes Vertex claude ids so they never collide with a Claude subscription', () => {
    expect(aliasModelId('claude-sonnet-5-5', 'vertex-anthropic')).toBe('anthropic-vertex-anthropic__claude-sonnet-5-5');
    expect(aliasModelId('claude-sonnet-5-5', 'claude-code')).toBe('claude-sonnet-5-5');
  });

  it('defaults to the current Claude lineup, newest first', () => {
    rmSync(join(home(), 'vertex-models.json'), { force: true });
    expect(loadVertexModelEntries().map(m => m.id)).toEqual([
      'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-sonnet-5',
      'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5',
    ]);
  });

  it('adds to the default list on first edit instead of replacing it', () => {
    rmSync(join(home(), 'vertex-models.json'), { force: true });
    expect(addVertexModelEntry({ id: 'claude-fable-5-1', display_name: 'Claude Fable 5.1' })).toEqual({ ok: true });
    const ids = loadVertexModelEntries().map(m => m.id);
    expect(ids).toHaveLength(DEFAULT_VERTEX_MODELS.length + 1);
    expect(ids.at(-1)).toBe('claude-fable-5-1');
    expect(addVertexModelEntry({ id: 'claude-fable-5-1', display_name: 'dup' }).ok).toBe(false);
    expect(addVertexModelEntry({ id: 'bad id', display_name: 'x' }).ok).toBe(false);
  });

  it('removes models but always keeps one, and preserves upstream ids', () => {
    expect(removeVertexModelEntries(['claude-sonnet-5-5'])).toEqual({ ok: true });
    expect(loadVertexModelEntries()).toEqual([
      { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', upstream_id: 'claude-opus-5-5@default' },
    ]);
    expect(removeVertexModelEntries(['claude-opus-5-5']).ok).toBe(false);
    expect(removeVertexModelEntries(['not-there']).ok).toBe(false);
  });

  it('reset returns to the defaults', () => {
    resetVertexModelEntries();
    expect(loadVertexModelEntries()).toEqual(DEFAULT_VERTEX_MODELS);
  });

  it('derives display names from Vertex model ids', () => {
    expect(vertexModelDisplayName('claude-haiku-5-5')).toBe('Claude Haiku 5.5');
    expect(vertexModelDisplayName('claude-sonnet-5')).toBe('Claude Sonnet 5');
    expect(vertexModelDisplayName('claude-opus-4-5@20251101')).toBe('Claude Opus 4.5');
    expect(vertexModelDisplayName('gemini-3-pro')).toBe('gemini-3-pro');
  });

  it('keeps only the models the project can use when adding, and says why', async () => {
    access.results.set('claude-sonnet-5-5', POLICY);
    const result = await addProviderFromTemplate(template, template.id);
    expect(result).toMatchObject({ added: true, modelCount: 1 });
    expect(result.notice).toContain("Claude Sonnet 5.5 (blocked by your organization's model policy)");
    expect(loadVertexModelEntries().map(m => m.id)).toEqual(['claude-opus-5-5']);
  });

  it('leaves the defaults untouched when every model is allowed', async () => {
    rmSync(join(home(), 'vertex-models.json'), { force: true });
    expect((await addProviderFromTemplate(template, template.id)).notice).toBeUndefined();
    expect(existsSync(join(home(), 'vertex-models.json'))).toBe(false);
  });

  it('refuses to add when no model or the account is rejected', async () => {
    access.results.set('claude-sonnet-5-5', POLICY);
    access.results.set('claude-opus-5-5@default', { ok: false, status: 404, error: 'not found' });
    expect((await addProviderFromTemplate(template, template.id)).error).toContain('None of the 2 Claude models');

    access.results.clear();
    access.results.set('claude-sonnet-5-5', { ok: false, status: 403, error: 'Permission denied on project' });
    const denied = await addProviderFromTemplate(template, template.id);
    expect(denied).toMatchObject({ added: false, error: 'Permission denied on project' });
    expect(isVertexAnthropicRegistered()).toBe(false);
    expect(loadVertexModelEntries()).toHaveLength(2);
  });
});
