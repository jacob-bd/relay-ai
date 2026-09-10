import { describe, it, expect } from 'vitest';
import { collapseSchemaUnionTypes, normalizeToolSchemaForNpm } from '../src/tool-schema.js';

// Codex's image_gen tool, the shape that 400s Gemini in issue #72.
const IMAGE_GEN_PARAMETERS = {
  type: 'object',
  properties: {
    prompt: { type: 'string' },
    referenced_image_paths: {
      type: ['array', 'null'],
      items: { type: 'string' },
      description: 'Local image paths to reference',
    },
  },
  required: ['prompt'],
};

describe('collapseSchemaUnionTypes', () => {
  it('collapses a nullable array union so items keeps a parent type', () => {
    const out = collapseSchemaUnionTypes(IMAGE_GEN_PARAMETERS) as any;
    expect(out.properties.referenced_image_paths.type).toBe('array');
    expect(out.properties.referenced_image_paths.nullable).toBe(true);
    expect(out.properties.referenced_image_paths.items).toEqual({ type: 'string' });
  });

  it('leaves plain single types untouched', () => {
    const out = collapseSchemaUnionTypes(IMAGE_GEN_PARAMETERS) as any;
    expect(out.properties.prompt).toEqual({ type: 'string' });
    expect(out.required).toEqual(['prompt']);
  });

  it('collapses nested schemas', () => {
    const out = collapseSchemaUnionTypes({
      type: 'object',
      properties: {
        outer: {
          type: 'object',
          properties: { inner: { type: ['string', 'null'] } },
        },
      },
    }) as any;
    expect(out.properties.outer.properties.inner).toEqual({ type: 'string', nullable: true });
  });

  it('leaves multi-type unions alone rather than guessing', () => {
    const out = collapseSchemaUnionTypes({ type: ['string', 'number'] }) as any;
    expect(out.type).toEqual(['string', 'number']);
    expect(out.nullable).toBeUndefined();
  });

  it('does not add nullable when the union has no null member', () => {
    const out = collapseSchemaUnionTypes({ type: ['array'], items: { type: 'string' } }) as any;
    expect(out.type).toBe('array');
    expect(out.nullable).toBeUndefined();
  });
});

describe('normalizeToolSchemaForNpm', () => {
  it('rewrites google routes', () => {
    const out = normalizeToolSchemaForNpm(IMAGE_GEN_PARAMETERS, '@ai-sdk/google') as any;
    expect(out.properties.referenced_image_paths.type).toBe('array');
  });

  it('rewrites vertex routes', () => {
    const out = normalizeToolSchemaForNpm(IMAGE_GEN_PARAMETERS, '@ai-sdk/google-vertex') as any;
    expect(out.properties.referenced_image_paths.type).toBe('array');
  });

  it('leaves openai untouched — the union form is required for strict schemas', () => {
    const out = normalizeToolSchemaForNpm(IMAGE_GEN_PARAMETERS, '@ai-sdk/openai');
    expect(out).toBe(IMAGE_GEN_PARAMETERS);
  });

  it('leaves an unknown npm untouched', () => {
    expect(normalizeToolSchemaForNpm(IMAGE_GEN_PARAMETERS, undefined)).toBe(IMAGE_GEN_PARAMETERS);
  });
});
