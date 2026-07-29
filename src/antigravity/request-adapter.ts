import { randomUUID } from 'node:crypto';
import { tool, jsonSchema, type ModelMessage } from 'ai';
import { serializeToolResultContent } from '../proxy-shared.js';

export interface CloudCodePart {
  text?: string;
  thought?: boolean;
  inlineData?: {
    mimeType: string;
    data: string;
  };
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
}

export interface CloudCodeMessage {
  role: 'user' | 'model' | 'system';
  parts: CloudCodePart[];
}

export interface CloudCodeGenerateRequest {
  model: string;
  request: {
    contents?: CloudCodeMessage[];
    systemInstruction?: {
      parts: CloudCodePart[];
    };
    tools?: Array<{
      functionDeclarations?: Array<{
        name: string;
        description?: string;
        parameters?: Record<string, unknown>;
      }>;
    }>;
    toolConfig?: {
      functionCallingConfig?: {
        mode?: string;
      };
    };
  };
}

export interface SdkRequest {
  system?: string;
  messages: ModelMessage[];
  tools?: Record<string, ReturnType<typeof tool>>;
  toolChoice?: 'auto' | 'required';
  providerOptions?: Record<string, Record<string, unknown>>;
}

export interface TranslateRequestOptions {
  fallbackAssistantReasoning?: string[];
  maxTools?: number;
}

export const UNSUPPORTED_VOICE_MESSAGE =
  'Voice transcription isn’t supported by Relay AI yet. Please type your message. Your coding session remains active.';

const OMITTED_VOICE_TEXT =
  '[Voice recording omitted because transcription is not supported by Relay AI.]';

function isSupportedImage(part: CloudCodePart): boolean {
  return part.inlineData?.mimeType.toLowerCase().startsWith('image/') ?? false;
}

function isUnsupportedInlineData(part: CloudCodePart): boolean {
  return !!part.inlineData && !isSupportedImage(part);
}

export function sanitizeUnsupportedInlineData(
  ccReq: CloudCodeGenerateRequest,
): { request: CloudCodeGenerateRequest; latestUserTurnHasUnsupportedMedia: boolean } {
  const contents = ccReq.request?.contents ?? [];
  let latestUserIndex = -1;
  for (let i = contents.length - 1; i >= 0; i--) {
    if (contents[i]!.role === 'user') {
      latestUserIndex = i;
      break;
    }
  }

  let latestUserTurnHasUnsupportedMedia = false;
  const sanitizedContents = contents.map((message, index) => ({
    ...message,
    parts: message.parts.map(part => {
      if (!isUnsupportedInlineData(part)) return part;
      if (index === latestUserIndex) latestUserTurnHasUnsupportedMedia = true;
      return { text: OMITTED_VOICE_TEXT };
    }),
  }));

  return {
    request: {
      ...ccReq,
      request: {
        ...ccReq.request,
        contents: sanitizedContents,
      },
    },
    latestUserTurnHasUnsupportedMedia,
  };
}

export interface SdkRequestTracePart {
  type: string;
  chars?: number;
  toolName?: string;
  toolCallId?: string;
}

export interface SdkRequestTraceSummary {
  systemChars: number;
  messages: Array<{ role: string; parts: SdkRequestTracePart[] }>;
  toolNames: string[];
  toolChoice?: 'auto' | 'required';
}

function tracePartChars(part: Record<string, unknown>): number | undefined {
  if (typeof part.text === 'string') return part.text.length;
  if (part.type !== 'tool-result') return undefined;

  const output = part.output;
  if (typeof output === 'string') return output.length;
  if (output && typeof output === 'object' && typeof (output as { value?: unknown }).value === 'string') {
    return (output as { value: string }).value.length;
  }
  try {
    return output === undefined ? undefined : JSON.stringify(output).length;
  } catch {
    return undefined;
  }
}

/** Content-free SDK request structure for trace logs. */
export function summarizeSdkRequestForTrace(request: SdkRequest): SdkRequestTraceSummary {
  const messages = request.messages.map(message => {
    const content = message.content;
    if (typeof content === 'string') {
      return { role: message.role, parts: [{ type: 'text', chars: content.length }] };
    }

    const parts = Array.isArray(content)
      ? content.map(rawPart => {
          const part = rawPart as unknown as Record<string, unknown>;
          const summary: SdkRequestTracePart = {
            type: typeof part.type === 'string' ? part.type : typeof rawPart,
          };
          const chars = tracePartChars(part);
          if (chars !== undefined) summary.chars = chars;
          if (typeof part.toolName === 'string') summary.toolName = part.toolName;
          if (typeof part.toolCallId === 'string') summary.toolCallId = part.toolCallId;
          return summary;
        })
      : [{ type: typeof content }];

    return { role: message.role, parts };
  });

  return {
    systemChars: request.system?.length ?? 0,
    messages,
    toolNames: Object.keys(request.tools ?? {}),
    ...(request.toolChoice ? { toolChoice: request.toolChoice } : {}),
  };
}

const JSON_SCHEMA_TYPES = new Map([
  ['ARRAY', 'array'],
  ['BOOLEAN', 'boolean'],
  ['INTEGER', 'integer'],
  ['NULL', 'null'],
  ['NUMBER', 'number'],
  ['OBJECT', 'object'],
  ['STRING', 'string'],
]);

/** Split Cloud Code text that embeds `<thinking>...</thinking>` into SDK reasoning/text parts. */
export function expandTextWithThinking(text: string): Array<{ type: 'text' | 'reasoning'; text: string }> {
  if (!text.includes('<thinking>')) {
    return [{ type: 'text', text }];
  }
  const out: Array<{ type: 'text' | 'reasoning'; text: string }> = [];
  const tokens = text.split(/<thinking>([\s\S]*?)<\/thinking>/);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? '';
    if (!token.trim()) continue;
    out.push({ type: i % 2 === 1 ? 'reasoning' : 'text', text: token });
  }
  return out.length > 0 ? out : [{ type: 'text', text }];
}

function normalizeSchemaType(value: unknown): unknown {
  if (typeof value === 'string') {
    return JSON_SCHEMA_TYPES.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeSchemaType);
  }
  return value;
}

export function normalizeJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJsonSchema);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      key === 'type' ? normalizeSchemaType(child) : normalizeJsonSchema(child),
    ]),
  );
}

/**
 * Translate Cloud Code tool declarations into Vercel AI SDK tool objects.
 */
function translateTools(
  ccTools?: CloudCodeGenerateRequest['request']['tools'],
  options: TranslateRequestOptions = {},
): Record<string, ReturnType<typeof tool>> | undefined {
  if (!ccTools?.length) return undefined;
  const tools: Record<string, ReturnType<typeof tool>> = {};
  let toolCount = 0;
  for (const t of ccTools) {
    if (t.functionDeclarations) {
      for (const fd of t.functionDeclarations) {
        if (options.maxTools !== undefined && toolCount >= options.maxTools) break;
        tools[fd.name] = tool({
          description: fd.description || '',
          inputSchema: jsonSchema(
            normalizeJsonSchema(fd.parameters || { type: 'object', properties: {} }),
          ),
        });
        toolCount++;
      }
    }
  }
  return Object.keys(tools).length > 0 ? tools : undefined;
}

/**
 * Translate a Cloud Code/Gemini generation request into Vercel AI SDK params.
 *
 * Handles text, images, function calls (tool-call), function responses (tool-result),
 * and tool declarations — following the same pattern as gemini-proxy.ts.
 */
export function translateRequest(
  ccReq: CloudCodeGenerateRequest,
  options: TranslateRequestOptions = {},
): SdkRequest {
  const systemInstructions: string[] = [];
  const sdkMessages: ModelMessage[] = [];
  const nameToIdList = new Map<string, string[]>();
  const fallbackAssistantReasoning = [...(options.fallbackAssistantReasoning ?? [])];

  const request = ccReq.request || {};

  // 1. Extract system instructions from request.systemInstruction
  if (request.systemInstruction?.parts) {
    for (const part of request.systemInstruction.parts) {
      if (part.text) {
        systemInstructions.push(part.text);
      }
    }
  }

  // 2. Process contents messages
  const contents = request.contents || [];
  for (const msg of contents) {
    const role = msg.role;

    if (role === 'system') {
      for (const part of msg.parts) {
        if (part.text) {
          systemInstructions.push(part.text);
        }
      }
      continue;
    }

    const sdkRole = role === 'model' ? 'assistant' : 'user';

    // Check if the message is a simple single-text message (most common case)
    const hasFunctionCall = msg.parts.some(p => p.functionCall);
    const hasAssistantReasoning = role === 'model' && msg.parts.some(p => p.thought || p.text?.includes('<thinking>'));
    const hasComplexParts = msg.parts.some(p => p.thought || p.inlineData || p.functionCall || p.functionResponse);
    const singleText = msg.parts.length === 1 ? msg.parts[0]?.text : undefined;
    if (!hasComplexParts && singleText !== undefined && !singleText.includes('<thinking>')) {
      sdkMessages.push({
        role: sdkRole,
        content: singleText,
      } as ModelMessage);
      continue;
    }

    const contentParts: any[] = [];
    const toolResults: any[] = [];

    if (role === 'model' && hasFunctionCall && !hasAssistantReasoning) {
      const fallback = fallbackAssistantReasoning.shift();
      if (fallback?.trim()) {
        contentParts.push({ type: 'reasoning', text: fallback });
      }
    }

    for (const part of msg.parts) {
      if (part.text !== undefined) {
        if (part.thought) {
          contentParts.push({ type: 'reasoning', text: part.text });
        } else {
          for (const piece of expandTextWithThinking(part.text)) {
            contentParts.push(piece);
          }
        }
      } else if (part.inlineData) {
        if (isSupportedImage(part)) {
          contentParts.push({
            type: 'image',
            image: part.inlineData.data,
            mimeType: part.inlineData.mimeType,
          });
        } else {
          contentParts.push({ type: 'text', text: OMITTED_VOICE_TEXT });
        }
      } else if (part.functionCall) {
        const id = 'call_' + randomUUID().replace(/-/g, '');
        const name = part.functionCall.name;
        if (!nameToIdList.has(name)) nameToIdList.set(name, []);
        nameToIdList.get(name)!.push(id);
        contentParts.push({
          type: 'tool-call',
          toolCallId: id,
          toolName: name,
          input: part.functionCall.args || {},
        });
      } else if (part.functionResponse) {
        const name = part.functionResponse.name;
        const idList = nameToIdList.get(name) || [];
        const id = idList.shift() || ('call_' + randomUUID().replace(/-/g, ''));
        toolResults.push({
          type: 'tool-result',
          toolCallId: id,
          toolName: name,
          output: { type: 'text', value: serializeToolResultContent(part.functionResponse.response) },
        });
      }
    }

    if (toolResults.length > 0) {
      sdkMessages.push({
        role: 'tool',
        content: toolResults,
      } as unknown as ModelMessage);
    }
    if (contentParts.length > 0) {
      sdkMessages.push({
        role: sdkRole,
        content: contentParts,
      } as ModelMessage);
    }
  }

  const system = systemInstructions.length > 0 ? systemInstructions.join('\n\n') : undefined;

  // 3. Tools translation
  const tools = translateTools(request.tools, options);

  // 4. Tool choice
  let toolChoice: 'auto' | 'required' | undefined;
  const mode = request.toolConfig?.functionCallingConfig?.mode;
  if (mode === 'ANY') {
    toolChoice = 'required';
  } else if (mode === 'AUTO' || tools) {
    toolChoice = 'auto';
  }

  return {
    system,
    messages: sdkMessages,
    tools,
    toolChoice,
  };
}
