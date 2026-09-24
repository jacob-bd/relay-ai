/**
 * JSON Schema fixups applied to client tool definitions before the Vercel AI
 * SDK converts them.
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

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

/**
 * Rewrite the JavaScript NUL escape (`\0`) inside a `pattern` to `\x00`, the
 * form every regex engine parses. Returns null when nothing needed rewriting so
 * callers can keep the original string — and, above, the original schema object.
 *
 * `\012` is an octal escape, not a NUL followed by "12", so a `\0` followed by
 * another digit is left alone. A `\0` behind an escaped backslash is a literal
 * backslash plus "0" and must also survive untouched.
 */
function rewriteNulEscapesInPattern(pattern: string): string | null {
  let out = '';
  let escaped = false;
  let changed = false;
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]!;
    if (escaped) {
      escaped = false;
      if (ch === '0' && !isDigit(pattern[i + 1])) {
        out += 'x00';
        changed = true;
      } else {
        out += ch;
      }
      continue;
    }
    if (ch === '\\') escaped = true;
    out += ch;
  }
  return changed ? out : null;
}

/**
 * Make every `pattern` in a tool schema portable across provider regex engines.
 *
 * Command Code compiles each `pattern` it receives and rejects the JS NUL escape
 * *inside a character class* while accepting it bare. Claude Code ships exactly
 * that shape: its Artifact tool declares `file_paths` as
 * `z.array(z.string().min(1).max(1024).regex(/^[^\0]*$/))`, so the request is
 * refused before any token is generated — `Invalid schema for function
 * 'Artifact': "^[^\0]*$" is not a "regex"` when the pattern sits directly on a
 * property, or the vaguer `... is not valid under any of the schemas listed in
 * the 'anyOf' keyword` when it sits inside `items` or an `anyOf` branch. The
 * Artifact tool is REPL-only, so this only fires in interactive Claude Code —
 * `claude -p` sends 12 tools and never hits it.
 *
 * `\x00` is the same character to every engine, so the constraint survives;
 * dropping `pattern` outright would silently weaken validation instead.
 */
export function rewriteNulPatternEscapes(value: unknown): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map(entry => {
      const next = rewriteNulPatternEscapes(entry);
      if (next !== entry) changed = true;
      return next;
    });
    return changed ? out : value;
  }
  if (!value || typeof value !== 'object') return value;

  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = key === 'pattern' && typeof child === 'string'
      ? rewriteNulEscapesInPattern(child) ?? child
      : rewriteNulPatternEscapes(child);
    if (next !== child) changed = true;
    out[key] = next;
  }
  return changed ? out : value;
}

/**
 * Pick the `items` schema for a Gemini array that declares none.
 *
 * A tuple (`prefixItems`) collapses to its element type when the entries agree;
 * otherwise — and for an array with no element info at all — we fall back to
 * `{ type: 'string' }`. Gemini's OpenAPI subset requires every array to carry a
 * typed `items`, and has no "any" type, so a lossy-but-valid default beats a
 * 400 that takes down every tool (and plain chat) on the request.
 */
function synthesizeGoogleItems(prefixItems: unknown): Record<string, unknown> {
  if (Array.isArray(prefixItems) && prefixItems.length > 0) {
    const types = new Set(
      prefixItems
        .map(entry => (entry && typeof entry === 'object' ? (entry as { type?: unknown }).type : undefined))
        .filter((t): t is string => typeof t === 'string'),
    );
    if (types.size === 1) return { type: [...types][0]! };
  }
  return { type: 'string' };
}

/**
 * Make array schemas valid for Gemini function declarations.
 *
 * Gemini rejects two shapes Claude Code / MCP tools ship freely:
 *   - a `type: 'array'` with no `items` (e.g. Claude Docs' `batch`) →
 *     `properties[batch].items: missing field`
 *   - a tuple array via `prefixItems` (e.g. ArtifactData's `query.where`) →
 *     `...where.items.items: missing field`
 * Both 400 the whole request, killing every tool and plain chat with it. We add
 * a typed `items` where absent and collapse `prefixItems` into one `items`
 * schema, dropping `prefixItems` since Gemini's dialect does not accept it.
 */
export function fixGoogleArraySchemas(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fixGoogleArraySchemas);
  if (!value || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = fixGoogleArraySchemas(child);
  }
  if (out.type === 'array') {
    if (out.items === undefined) out.items = synthesizeGoogleItems(out.prefixItems);
    delete out.prefixItems;
  }
  return out;
}

/**
 * Every route gets NUL pattern escapes rewritten. Union types and array shapes
 * stay intact except on Google, which cannot represent them.
 */
export function normalizeToolSchemaForNpm<T>(schema: T, npm: string | undefined): T {
  const portable = rewriteNulPatternEscapes(schema) as T;
  if (!npm || !GOOGLE_NPM.has(npm)) return portable;
  return fixGoogleArraySchemas(collapseSchemaUnionTypes(portable)) as T;
}
