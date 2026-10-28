import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VERTEX_ANTHROPIC_NPM } from '../src/constants.js';
import { getTemplateById, listSupportedTemplates } from '../src/provider-templates.js';
import { aliasModelId } from '../src/proxy.js';
import { addProviderFromTemplate } from '../src/registry/add-template.js';
import { loadRegistry, saveRegistry } from '../src/registry/io.js';
import { loadRegistryProviders } from '../src/registry/load.js';
import { getProviderModels } from '../src/registry/provider-models.js';
import { isVertexAnthropicRegistered } from '../src/registry/vertex-anthropic.js';

vi.mock('@napi-rs/keyring', () => ({
  Entry: class { constructor() { throw new Error('isolated test keyring'); } },
}));

const adc = vi.hoisted(() => ({ present: true }));
vi.mock('../src/vertex-env.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/vertex-env.js')>(),
  hasApplicationDefaultCredentials: () => adc.present,
}));

const home = () => process.env.RELAY_AI_HOME!;
const template = getTemplateById('vertex-anthropic')!;

describe('Vertex AI (Claude) registry provider', () => {
  const savedProject = process.env.ANTHROPIC_VERTEX_PROJECT_ID;

  beforeEach(() => {
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
});
