import { randomUUID } from 'node:crypto';
import { tool, jsonSchema, type ModelMessage } from 'ai';

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
}

export interface TranslateRequestOptions {
  fallbackAssistantReasoning?: string[];
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
): Record<string, ReturnType<typeof tool>> | undefined {
  if (!ccTools?.length) return undefined;
  const tools: Record<string, ReturnType<typeof tool>> = {};
  for (const t of ccTools) {
    if (t.functionDeclarations) {
      for (const fd of t.functionDeclarations) {
        tools[fd.name] = tool({
          description: fd.description || '',
          inputSchema: jsonSchema(
            normalizeJsonSchema(fd.parameters || { type: 'object', properties: {} }),
          ),
        });
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
        contentParts.push({
          type: 'image',
          image: part.inlineData.data,
          mimeType: part.inlineData.mimeType,
        });
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
          output: {
            type: 'text',
            value: typeof part.functionResponse.response === 'string'
              ? part.functionResponse.response
              : JSON.stringify(part.functionResponse.response || {}),
          },
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
  const tools = translateTools(request.tools);

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
