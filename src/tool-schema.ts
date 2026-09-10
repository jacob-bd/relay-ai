/**
 * Google-only JSON Schema fixups applied to client tool definitions before the
 * Vercel AI SDK converts them.
 */

const GOOGLE_NPM = new Set(['@ai-sdk/google', '@ai-sdk/google-vertex']);

/**
 * Collapse a union type (`type: ['array', 'null']`) into its single non-null
 * type plus `nullable`.
 *
 * @ai-sdk/google's JSON Schema -> OpenAPI converter turns a union into
 * `anyOf: [{ type }]` and never sets `type` on the node itself, leaving a
 * sibling `items` orphaned. Gemini then rejects the whole request with
 * `properties[x].items: field predicate failed: $type == Type.ARRAY` (HTTP 400).
 * Codex declares optional list arguments this way (image_gen's
 * `referenced_image_paths`), and because tool definitions ride on every request,
 * one such argument 400s plain text prompts too. Still reproducible on
 * @ai-sdk/google 4.0.67.
 */
export function collapseSchemaUnionTypes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(collapseSchemaUnionTypes);
  if (!value || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'type' && Array.isArray(child)) {
      const nonNull = child.filter(entry => entry !== 'null');
      if (nonNull.length === 1) {
        out.type = nonNull[0];
        if (nonNull.length < child.length) out.nullable = true;
        continue;
      }
    }
    out[key] = collapseSchemaUnionTypes(child);
  }
  return out;
}

/**
 * Union types are the correct — and for strict schemas required — shape everywhere
 * except Google, so only Google routes are rewritten.
 */
export function normalizeToolSchemaForNpm<T>(schema: T, npm: string | undefined): T {
  if (!npm || !GOOGLE_NPM.has(npm)) return schema;
  return collapseSchemaUnionTypes(schema) as T;
}
