// src/antigravity/anthropic-to-cloudcode.ts — Translate Anthropic /v1/messages request
// into the Cloud Code Assist envelope format for cloudcode-pa.googleapis.com.

import { randomUUID } from 'node:crypto';
import { splitToolUseId } from '../proxy-shared.js';

type JsonRecord = Record<string, unknown>;

// Safety settings that disable all harm filters — prevents false-positive blocks on
// legitimate coding content. Mirrors OmniRoute's DEFAULT_SAFETY_SETTINGS (MIT).
const DEFAULT_SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
];

const ANTIGRAVITY_USER_AGENT = 'vscode/1.X.X (Antigravity/4.2.0)';
const MIN_ANTIGRAVITY_OUTPUT_TOKENS = 1024;

// Draft-meta keywords that Cloud Code rejects — strip them from tool schemas.
const STRIP_KEYS = new Set([
  '$schema', '$defs', 'definitions', '$ref', '$comment',
  'additionalProperties', 'propertyNames', 'patternProperties', 'prefixItems', 'title',
  'exclusiveMinimum', 'exclusiveMaximum', 'minimum', 'maximum',
  'multipleOf', 'minLength', 'maxLength', 'pattern', 'format',
  'minItems', 'maxItems', 'uniqueItems', 'contains', 'minContains', 'maxContains',
  'minProperties', 'maxProperties', 'dependencies', 'dependentRequired', 'dependentSchemas',
  'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
  'const', 'default', 'examples', 'readOnly', 'writeOnly', 'deprecated',
  // Codex app tool schemas can include this internal annotation. It is not a
  // JSON Schema keyword and Cloud Code's Schema protobuf rejects it.
  'encrypted',
]);

const CLOUD_CODE_SCHEMA_TYPES = new Map([
  ['array', 'ARRAY'],
  ['boolean', 'BOOLEAN'],
  ['integer', 'INTEGER'],
  ['null', 'NULL'],
  ['number', 'NUMBER'],
  ['object', 'OBJECT'],
  ['string', 'STRING'],
]);

function normalizeCloudCodeSchemaType(value: unknown): unknown {
  if (typeof value === 'string') {
    return CLOUD_CODE_SCHEMA_TYPES.get(value.toLowerCase()) ?? value;
  }
  return value;
}

function isNullSchema(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const type = (obj as JsonRecord).type;
  return type === 'null' || type === 'NULL'
    || (Array.isArray(type) && type.every(value => value === 'null' || value === 'NULL'));
}

function resolveLocalSchemaRef(ref: string, root: JsonRecord): unknown {
  if (!ref.startsWith('#/$defs/')) return undefined;
  const name = ref.slice('#/$defs/'.length).replace(/~1/g, '/').replace(/~0/g, '~');
  const defs = root.$defs;
  if (!defs || typeof defs !== 'object' || Array.isArray(defs)) return undefined;
  return (defs as JsonRecord)[name];
}

function stripDraftMeta(
  obj: unknown,
  root: JsonRecord | undefined = undefined,
  resolvingRefs: ReadonlySet<string> = new Set(),
): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(value => stripDraftMeta(value, root, resolvingRefs));
  const source = obj as JsonRecord;
  const schemaRoot = root ?? source;

  if (typeof source.$ref === 'string') {
    const resolved = resolveLocalSchemaRef(source.$ref, schemaRoot);
    if (resolved !== undefined) {
      if (resolvingRefs.has(source.$ref)) return { type: 'OBJECT' };
      const nextRefs = new Set(resolvingRefs);
      nextRefs.add(source.$ref);
      const dereferenced = stripDraftMeta(resolved, schemaRoot, nextRefs);
      if (dereferenced && typeof dereferenced === 'object' && !Array.isArray(dereferenced)) {
        const siblings = { ...source };
        delete siblings.$ref;
        const sanitizedSiblings = stripDraftMeta(siblings, schemaRoot, resolvingRefs);
        return {
          ...(dereferenced as JsonRecord),
          ...(sanitizedSiblings as JsonRecord),
        };
      }
      return dereferenced;
    }
  }

  const out: JsonRecord = {};
  for (const [k, v] of Object.entries(source)) {
    if (STRIP_KEYS.has(k) || k.startsWith('x-')) continue;
    if (k === 'properties' && v && typeof v === 'object' && !Array.isArray(v)) {
      out.properties = Object.fromEntries(
        Object.entries(v as JsonRecord).map(([name, schema]) => [
          name,
          stripDraftMeta(schema, schemaRoot, resolvingRefs),
        ]),
      );
      continue;
    }
    if (k === 'type') {
      const types = (Array.isArray(v) ? v : [v])
        .map(normalizeCloudCodeSchemaType)
        .filter((type): type is string => typeof type === 'string');
      const concreteType = types.find(type => type !== 'NULL');
      out.type = concreteType ?? 'STRING';
      if (types.includes('NULL')) out.nullable = true;
      continue;
    }
    if (k === 'enum' && Array.isArray(v)) {
      out.enum = v.filter(value => value !== null && value !== undefined).map(String);
      continue;
    }
    if (k === 'items' && Array.isArray(v)) {
      out.items = stripDraftMeta(v[0] ?? {}, schemaRoot, resolvingRefs);
      continue;
    }
    out[k] = stripDraftMeta(v, schemaRoot, resolvingRefs);
  }

  const union = Array.isArray(source.anyOf)
    ? source.anyOf
    : Array.isArray(source.oneOf)
      ? source.oneOf
      : undefined;
  if (union) {
    const nullable = union.some(isNullSchema);
    const alternatives = union
      .filter(branch => !isNullSchema(branch))
      .map(branch => stripDraftMeta(branch, schemaRoot, resolvingRefs))
      .filter((branch): branch is JsonRecord => Boolean(branch) && typeof branch === 'object' && !Array.isArray(branch));
    if (alternatives.length === 1) Object.assign(out, alternatives[0], out);
    else if (alternatives.length > 1) out.anyOf = alternatives;
    if (nullable) out.nullable = true;
  }
  if (!out.type) {
    if (out.properties && typeof out.properties === 'object' && !Array.isArray(out.properties)) {
      out.type = 'OBJECT';
    } else if (out.items && typeof out.items === 'object' && !Array.isArray(out.items)) {
      out.type = 'ARRAY';
    }
  }
  // Trim `required` to only list fields that survived in `properties`.
  if (Array.isArray(out.required) && out.properties && typeof out.properties === 'object') {
    const props = out.properties as JsonRecord;
    const valid = (out.required as unknown[]).filter(
      f => typeof f === 'string' && Object.prototype.hasOwnProperty.call(props, f),
    );
    if (valid.length === 0) delete out.required; else out.required = valid;
  }
  return out;
}

// ── Message translation ─────────────────────────────────────────────────────

function stringToParts(text: string): JsonRecord[] {
  return [{ text }];
}

function anthropicContentToParts(
  content: unknown,
  toolUseIdToName: Map<string, string>,
): JsonRecord[] {
  if (typeof content === 'string') return stringToParts(content);
  if (!Array.isArray(content)) return [];

  const parts: JsonRecord[] = [];
  for (const block of content as JsonRecord[]) {
    const type = block.type as string | undefined;
    if (type === 'text' && typeof block.text === 'string') {
      parts.push({ text: block.text });
    } else if (type === 'thinking' && typeof block.thinking === 'string') {
      parts.push({ thought: true, text: block.thinking });
    } else if (type === 'tool_use') {
      const name = block.name as string;
      const id = block.id as string;
      const { thoughtSignature } = id ? splitToolUseId(id) : { thoughtSignature: undefined };
      if (id && name) toolUseIdToName.set(id, name);
      const part: JsonRecord = { functionCall: { name, args: block.input ?? {} } };
      if (thoughtSignature) part.thoughtSignature = thoughtSignature;
      parts.push(part);
    } else if (type === 'tool_result') {
      const toolUseId = block.tool_use_id as string;
      const name = toolUseIdToName.get(toolUseId) ?? toolUseId;
      const rawContent = block.content;
      let result: unknown;
      if (typeof rawContent === 'string') {
        result = rawContent;
      } else if (Array.isArray(rawContent)) {
        result = (rawContent as JsonRecord[]).filter(b => b.type === 'text').map(b => b.text).join('');
      } else {
        result = rawContent ?? '';
      }
      parts.push({ functionResponse: { name, response: { result } } });
    }
  }
  return parts;
}

function extractSystem(system: unknown): JsonRecord | undefined {
  if (!system) return undefined;
  if (typeof system === 'string' && system) {
    return { parts: [{ text: system }] };
  }
  if (Array.isArray(system)) {
    const text = (system as JsonRecord[])
      .filter(b => b.type === 'text')
      .map(b => b.text as string)
      .join('\n');
    return text ? { parts: [{ text }] } : undefined;
  }
  return undefined;
}

// ── Tool schema translation ─────────────────────────────────────────────────

function translateTools(tools: unknown): JsonRecord[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const decls: JsonRecord[] = [];
  for (const t of tools as JsonRecord[]) {
    if (typeof t.name !== 'string') continue;
    const translated = stripDraftMeta(t.input_schema ?? { type: 'object', properties: {} });
    const parameters = translated && typeof translated === 'object' && !Array.isArray(translated)
      ? translated as JsonRecord
      : { type: 'OBJECT', properties: {} };
    if (!parameters.type) parameters.type = 'OBJECT';
    decls.push({
      name: t.name,
      description: typeof t.description === 'string' ? t.description : '',
      parameters,
    });
  }
  return decls.length > 0
    ? [{ functionDeclarations: decls }]
    : undefined;
}

// ── Main translation entry ─────────────────────────────────────────────────

export interface CloudCodeEnvelope {
  project: string;
  requestId: string;
  model: string;
  userAgent: string;
  requestType: 'agent';
  enabledCreditTypes: string[];
  request: JsonRecord;
}

/**
 * Translate an Anthropic /v1/messages body into a Cloud Code Assist request envelope.
 * projectId comes from the stored OAuth credential's providerData.projectId.
 */
export function anthropicToCloudCode(
  body: JsonRecord,
  realModelId: string,
  projectId: string,
): CloudCodeEnvelope {
  const toolUseIdToName = new Map<string, string>();
  const messages = (body.messages as JsonRecord[] | undefined) ?? [];

  // Build contents — collect tool_use ids as we go so tool_result can find names.
  // Gemini requires strict user/model alternation; merge consecutive same-role messages
  // (Claude Code's Skill tool inserts two consecutive user-role messages after a tool result).
  const contents: JsonRecord[] = [];
  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'model' : 'user';
    const parts = anthropicContentToParts(msg.content, toolUseIdToName);
    if (parts.length === 0) continue;
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      (last.parts as JsonRecord[]).push(...parts);
    } else {
      contents.push({ role, parts });
    }
  }

  const generationConfig: JsonRecord = {};
  if (typeof body.max_tokens === 'number') {
    generationConfig.maxOutputTokens = Math.max(body.max_tokens, MIN_ANTIGRAVITY_OUTPUT_TOKENS);
  }
  if (typeof body.temperature === 'number') generationConfig.temperature = body.temperature;
  if (typeof body.top_p === 'number') generationConfig.topP = body.top_p;

  const ccTools = translateTools(body.tools);
  const systemInstruction = extractSystem(body.system);

  const request: JsonRecord = {
    contents,
    generationConfig,
    safetySettings: DEFAULT_SAFETY_SETTINGS,
  };
  if (systemInstruction) request.systemInstruction = systemInstruction;
  if (ccTools) {
    request.tools = ccTools;
    request.toolConfig = { functionCallingConfig: { mode: 'VALIDATED' } };
  }

  return {
    project: projectId,
    requestId: randomUUID(),
    model: realModelId,
    userAgent: ANTIGRAVITY_USER_AGENT,
    requestType: 'agent',
    enabledCreditTypes: ['GOOGLE_ONE_AI'],
    request,
  };
}
