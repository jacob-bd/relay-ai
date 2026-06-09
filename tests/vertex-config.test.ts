import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DEFAULT_VERTEX_MODELS,
  buildVertexRuntimeConfig,
  createVertexModelCatalog,
  vertexClientModelLookupCandidates,
  loadVertexModelEntries,
  resolveVertexLocation,
  resolveVertexProject,
  vertexModelsToServerModels,
} from '../src/server/vertex-config.js';
import { VERTEX_ANTHROPIC_NPM } from '../src/constants.js';

describe('vertex-config', () => {
  let tempHome = '';

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'relay-ai-vertex-'));
  });

  afterEach(() => {
    if (tempHome) rmSync(tempHome, { recursive: true, force: true });
  });

  it('resolves project from standard env vars', () => {
    expect(resolveVertexProject({
      ANTHROPIC_VERTEX_PROJECT_ID: 'my-gcp-project',
    })).toBe('my-gcp-project');

    expect(resolveVertexProject({
      GOOGLE_CLOUD_PROJECT: 'fallback-project',
    })).toBe('fallback-project');
  });

  it('resolves location with global default', () => {
    expect(resolveVertexLocation({})).toBe('global');
    expect(resolveVertexLocation({ GOOGLE_CLOUD_LOCATION: 'us-east5' })).toBe('us-east5');
    expect(resolveVertexLocation({ CLOUD_ML_REGION: 'europe-west1' })).toBe('europe-west1');
  });

  it('uses public-safe default models when no override file exists', () => {
    const env = { RELAY_AI_HOME: tempHome };
    expect(loadVertexModelEntries(env)).toEqual(DEFAULT_VERTEX_MODELS);
  });

  it('loads optional user catalog override from app home', () => {
    mkdirSync(tempHome, { recursive: true });
    writeFileSync(
      join(tempHome, 'vertex-models.json'),
      JSON.stringify([
        { id: 'claude-sonnet-4-6', display_name: 'Sonnet' },
        { id: 'claude-opus-4-6', display_name: 'Opus', upstream_id: 'claude-opus-4-6' },
      ]),
    );

    const models = loadVertexModelEntries({ RELAY_AI_HOME: tempHome });
    expect(models).toHaveLength(2);
    expect(models[1]?.upstream_id).toBe('claude-opus-4-6');
  });

  it('builds server models for the Vertex SDK adapter', () => {
    const config = buildVertexRuntimeConfig({
      ANTHROPIC_VERTEX_PROJECT_ID: 'test-project-123',
      GOOGLE_CLOUD_LOCATION: 'global',
      RELAY_AI_HOME: tempHome,
    });
    expect(config).toMatchObject({
      project: 'test-project-123',
      location: 'global',
    });

    const serverModels = vertexModelsToServerModels(config!);
    expect(serverModels).toHaveLength(3);
    expect(serverModels[0]).toMatchObject({
      id: 'claude-sonnet-4-6',
      modelFormat: 'openai',
      npm: VERTEX_ANTHROPIC_NPM,
      sourceBackend: 'vertex',
      providerId: 'vertex',
    });
  });

  it('returns null when project env is missing', () => {
    expect(buildVertexRuntimeConfig({ RELAY_AI_HOME: tempHome })).toBeNull();
  });

  it('resolves Claude Code shorthand model aliases', () => {
    const config = buildVertexRuntimeConfig({
      ANTHROPIC_VERTEX_PROJECT_ID: 'test-project-123',
      RELAY_AI_HOME: tempHome,
    })!;
    const catalog = createVertexModelCatalog(vertexModelsToServerModels(config));
    expect(catalog.get('haiku')?.id).toBe('claude-haiku-4-5');
    expect(catalog.get('sonnet')?.id).toBe('claude-sonnet-4-6');
    expect(catalog.get('opus')?.id).toBe('claude-opus-4-6');
    expect(catalog.get('claude-sonnet-4-6[1m]')?.id).toBe('claude-sonnet-4-6');
    expect(catalog.get('sonnet[1m]')?.id).toBe('claude-sonnet-4-6');
    expect(catalog.get('haiku[1m]')).toBeUndefined();
    expect(catalog.get('claude-haiku-4-5[1m]')).toBeUndefined();
    expect(catalog.get('claude-haiku-4-5-20251001')?.id).toBe('claude-haiku-4-5');
  });

  it('normalizes Claude Code dated model build ids', () => {
    expect(vertexClientModelLookupCandidates('claude-haiku-4-5-20251001')).toEqual([
      'claude-haiku-4-5-20251001',
      'claude-haiku-4-5',
      'claude-haiku-4-5[1m]',
    ]);
    expect(vertexClientModelLookupCandidates('claude-sonnet-4-6[1m]')).toEqual([
      'claude-sonnet-4-6[1m]',
      'claude-sonnet-4-6',
    ]);
  });
});
