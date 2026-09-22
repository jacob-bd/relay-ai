import { describe, it, expect } from 'vitest';
import {
  collapseSchemaUnionTypes,
  normalizeToolSchemaForNpm,
  rewriteNulPatternEscapes,
} from '../src/tool-schema.js';

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

// Claude Code's Artifact tool, as sent in interactive REPL sessions. `file_paths`
// is `z.array(z.string().min(1).max(1024).regex(/^[^\0]*$/))`, and Command Code's
// gateway refuses the entire request over that NUL escape.
const ARTIFACT_PARAMETERS = {
  type: 'object',
  properties: {
    file_paths: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 1024, pattern: '^[^\\0]*$' },
      minItems: 1,
    },
  },
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

  it('rewrites NUL pattern escapes on openai-compatible routes', () => {
    const out = normalizeToolSchemaForNpm(ARTIFACT_PARAMETERS, '@ai-sdk/openai-compatible') as any;
    expect(out.properties.file_paths.items.pattern).toBe('^[^\\x00]*$');
  });

  it('rewrites NUL pattern escapes on google routes too', () => {
    const out = normalizeToolSchemaForNpm(ARTIFACT_PARAMETERS, '@ai-sdk/google') as any;
    expect(out.properties.file_paths.items.pattern).toBe('^[^\\x00]*$');
  });

  it('keeps the original reference when no pattern needs rewriting', () => {
    expect(normalizeToolSchemaForNpm(IMAGE_GEN_PARAMETERS, '@ai-sdk/openai-compatible'))
      .toBe(IMAGE_GEN_PARAMETERS);
  });
});

describe('rewriteNulPatternEscapes', () => {
  const patternOf = (schema: unknown) =>
    (schema as any).properties.x.pattern as string;

  it('rewrites the NUL escape inside a character class', () => {
    const out = rewriteNulPatternEscapes({ properties: { x: { pattern: '^[^\\0]*$' } } }) as any;
    expect(out.properties.x.pattern).toBe('^[^\\x00]*$');
  });

  it('rewrites a bare NUL escape', () => {
    const out = rewriteNulPatternEscapes({ properties: { x: { pattern: '\\0' } } }) as any;
    expect(out.properties.x.pattern).toBe('\\x00');
  });

  it('leaves octal escapes alone', () => {
    const schema = { properties: { x: { pattern: '^\\012$' } } };
    expect(patternOf(rewriteNulPatternEscapes(schema))).toBe('^\\012$');
  });

  it('leaves a NUL behind an escaped backslash alone', () => {
    const schema = { properties: { x: { pattern: '^\\\\0$' } } };
    expect(patternOf(rewriteNulPatternEscapes(schema))).toBe('^\\\\0$');
  });

  it('leaves patterns with nothing to rewrite at their original reference', () => {
    const schema = { properties: { x: { pattern: '^[a-z]+$' } } };
    expect(rewriteNulPatternEscapes(schema)).toBe(schema);
  });

  it('reaches patterns nested in array items and anyOf branches', () => {
    const schema = {
      properties: {
        x: {
          anyOf: [
            { type: 'array', items: { pattern: '^[^\\0]*$' } },
            { type: 'null' },
          ],
        },
      },
    };
    const out = rewriteNulPatternEscapes(schema) as any;
    expect(out.properties.x.anyOf[0].items.pattern).toBe('^[^\\x00]*$');
    expect(out.properties.x.anyOf[1]).toEqual({ type: 'null' });
  });

  it('leaves non-string pattern values untouched', () => {
    const schema = { properties: { x: { pattern: 0 } } };
    expect(rewriteNulPatternEscapes(schema)).toBe(schema);
  });
});
