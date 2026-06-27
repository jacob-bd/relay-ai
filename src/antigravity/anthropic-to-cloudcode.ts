// src/antigravity/anthropic-to-cloudcode.ts — Translate Anthropic /v1/messages request
// into the Cloud Code Assist envelope format for cloudcode-pa.googleapis.com.

import { randomUUID } from 'node:crypto';
import { normalizeJsonSchema } from './request-adapter.js';
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
const DISABLE_CLOUD_CODE_THINKING = { thinkingBudget: 0, includeThoughts: false };

// Draft-meta keywords that Cloud Code rejects — strip them from tool schemas.
const STRIP_KEYS = new Set([
  '$schema', '$defs', 'definitions', '$ref', '$comment',
  'additionalProperties', 'propertyNames', 'patternProperties', 'title',
  'exclusiveMinimum', 'exclusiveMaximum', 'minimum', 'maximum',
  'multipleOf', 'minLength', 'maxLength', 'pattern', 'format',
  'minItems', 'maxItems', 'uniqueItems', 'contains', 'minContains', 'maxContains',
  'minProperties', 'maxProperties', 'dependencies', 'dependentRequired', 'dependentSchemas',
  'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
  'const', 'default', 'examples', 'readOnly', 'writeOnly', 'deprecated',
]);

function stripDraftMeta(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripDraftMeta);
  const out: JsonRecord = {};
  for (const [k, v] of Object.entries(obj as JsonRecord)) {
    if (STRIP_KEYS.has(k) || k.startsWith('x-')) continue;
    out[k] = stripDraftMeta(v);
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
    decls.push({
      name: t.name,
      description: typeof t.description === 'string' ? t.description : '',
      parameters: stripDraftMeta(normalizeJsonSchema(t.input_schema ?? { type: 'object', properties: {} })),
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
  generationConfig.thinkingConfig = DISABLE_CLOUD_CODE_THINKING;

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
