import { describe, it, expect } from 'vitest';
import {
  breakRecursiveSchemaRefs,
  collapseSchemaUnionTypes,
  fixGoogleArraySchemas,
  normalizeToolSchemaForNpm,
  rewriteNulPatternEscapes,
} from '../src/tool-schema.js';

// ArtifactData's `query.where`, the tuple-array shape that 400s Gemini with
// `properties[query].properties[where].items.items: missing field` — the inner
// array uses `prefixItems` (a tuple), which Gemini's schema dialect can't read.
const TUPLE_ARRAY_PARAMETERS = {
  type: 'object',
  properties: {
    query: {
      type: 'object',
      properties: {
        where: {
          type: 'array',
          items: {
            type: 'array',
            prefixItems: [{ type: 'string' }, { type: 'string' }, {}],
          },
        },
      },
    },
  },
};

// Claude Docs' `batch`, declared `{ type: 'array' }` with no `items` at all —
// Gemini rejects with `properties[batch].items: missing field`.
const MISSING_ITEMS_PARAMETERS = {
  type: 'object',
  properties: {
    batch: { type: 'array' },
  },
};

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

describe('fixGoogleArraySchemas', () => {
  it('gives a tuple (prefixItems) array a single items schema and drops prefixItems', () => {
    const out = fixGoogleArraySchemas(TUPLE_ARRAY_PARAMETERS) as any;
    const inner = out.properties.query.properties.where.items;
    expect(inner.type).toBe('array');
    expect(inner.items).toEqual({ type: 'string' });
    expect(inner.prefixItems).toBeUndefined();
  });

  it('adds items to an array that declares none', () => {
    const out = fixGoogleArraySchemas(MISSING_ITEMS_PARAMETERS) as any;
    expect(out.properties.batch.items).toEqual({ type: 'string' });
  });

  it('collapses a homogeneous tuple to that element type', () => {
    const out = fixGoogleArraySchemas({
      type: 'array',
      prefixItems: [{ type: 'number' }, { type: 'number' }],
    }) as any;
    expect(out.items).toEqual({ type: 'number' });
    expect(out.prefixItems).toBeUndefined();
  });

  it('leaves a valid array with real items untouched', () => {
    const schema = { type: 'array', items: { type: 'string', minLength: 1 } };
    const out = fixGoogleArraySchemas(schema) as any;
    expect(out.items).toEqual({ type: 'string', minLength: 1 });
  });

  it('leaves non-array nodes alone', () => {
    const out = fixGoogleArraySchemas({ type: 'object', properties: { x: { type: 'string' } } }) as any;
    expect(out).toEqual({ type: 'object', properties: { x: { type: 'string' } } });
  });
});

describe('normalizeToolSchemaForNpm array fixups', () => {
  it('fixes tuple arrays on google routes', () => {
    const out = normalizeToolSchemaForNpm(TUPLE_ARRAY_PARAMETERS, '@ai-sdk/google') as any;
    const inner = out.properties.query.properties.where.items;
    expect(inner.items).toEqual({ type: 'string' });
    expect(inner.prefixItems).toBeUndefined();
  });

  it('adds missing items on vertex routes', () => {
    const out = normalizeToolSchemaForNpm(MISSING_ITEMS_PARAMETERS, '@ai-sdk/google-vertex') as any;
    expect(out.properties.batch.items).toEqual({ type: 'string' });
  });

  it('does not touch array shapes on non-google routes', () => {
    const out = normalizeToolSchemaForNpm(MISSING_ITEMS_PARAMETERS, '@ai-sdk/openai') as any;
    expect(out.properties.batch.items).toBeUndefined();
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

// The Codex app's request_environment_input tool: `secrets[].target` is a
// self-referencing "any JSON value". Meta (via Command Code) rejects the whole
// request with "Recursive JSON schemas are not currently supported" (HTTP 400).
const JSON_VALUE_DEF = {
  anyOf: [
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
    { type: 'null' },
    { type: 'array', items: { $ref: '#/$defs/__schema0' } },
    { type: 'object', properties: {}, additionalProperties: { $ref: '#/$defs/__schema0' } },
  ],
};
const REQUEST_ENVIRONMENT_INPUT = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['repositories', 'secrets'] },
    secrets: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, target: { $ref: '#/$defs/__schema0' } },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  required: ['mode'],
  additionalProperties: false,
  $defs: { __schema0: JSON_VALUE_DEF },
};

describe('breakRecursiveSchemaRefs', () => {
  it('inlines a self-referencing definition, cutting the loop with an any-value schema', () => {
    const out = breakRecursiveSchemaRefs(REQUEST_ENVIRONMENT_INPUT) as any;
    expect(JSON.stringify(out)).not.toContain('$ref');
    expect(out.$defs).toBeUndefined();
    expect(out.properties.secrets.items.properties.target).toEqual({
      anyOf: [
        { type: 'string' },
        { type: 'number' },
        { type: 'boolean' },
        { type: 'null' },
        { type: 'array', items: {} },
        { type: 'object', properties: {}, additionalProperties: {} },
      ],
    });
    expect(out.properties.mode).toEqual(REQUEST_ENVIRONMENT_INPUT.properties.mode);
  });

  it('leaves schemas whose references do not loop untouched', () => {
    const schema = {
      type: 'object',
      properties: { a: { $ref: '#/$defs/A' } },
      $defs: { A: { type: 'object', properties: { b: { $ref: '#/$defs/B' } } }, B: { type: 'string' } },
    };
    expect(breakRecursiveSchemaRefs(schema)).toBe(schema);
    const plain = { type: 'object', properties: {} };
    expect(breakRecursiveSchemaRefs(plain)).toBe(plain);
  });

  it('is applied for non-OpenAI providers but not for OpenAI, which supports recursion', () => {
    expect(JSON.stringify(normalizeToolSchemaForNpm(REQUEST_ENVIRONMENT_INPUT, '@ai-sdk/openai-compatible'))).not.toContain('$ref');
    expect(normalizeToolSchemaForNpm(REQUEST_ENVIRONMENT_INPUT, '@ai-sdk/openai')).toEqual(REQUEST_ENVIRONMENT_INPUT);
  });
});
