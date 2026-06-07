// Shared types for Anthropic ↔ upstream proxy translation.

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

export interface AnthropicThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature: string;
}

export interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicThinkingBlock
  | AnthropicToolUseBlock;

export interface AnthropicMessage {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  stop_reason: string;
  stop_sequence: null;
  model: string;
  usage: AnthropicUsage;
}

export interface AnthropicToolDefinition {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
  /** When true, tool is discovered via tool search instead of loaded upfront. */
  defer_loading?: boolean;
  /** Anthropic tool-search tool types (e.g. tool_search_tool_regex_20251119). */
  type?: string;
}

export interface AnthropicMessageRequest {
  model?: string;
  messages?: AnthropicRequestMessage[];
  system?: string | Array<{ type?: string; text: string }>;
  tools?: AnthropicToolDefinition[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  stop_sequences?: string[];
}

export interface AnthropicRequestMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | AnthropicRequestContentPart[];
}

export type AnthropicRequestContentPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'tool_use'; id: string; name: string; input?: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: unknown }
  | { type: 'tool_reference'; tool_name: string }
  | { type: 'image'; source: AnthropicImageSource };

export type AnthropicImageSource =
  | { type: 'base64'; media_type: string; data: string }
  | { type: 'url'; url: string };

export interface GeminiFunctionCall {
  name: string;
  args?: unknown;
  thoughtSignature?: string;
  thought_signature?: string;
}

export interface GeminiPart {
  thought?: boolean;
  text?: string;
  thought_signature?: string;
  thoughtSignature?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: { name: string; response: { content: string } };
  inlineData?: { mimeType: string; data: string };
  fileData?: { fileUri: string };
}

export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  cachedContentTokenCount?: number;
}

export interface GeminiApiResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: GeminiPart[] };
  }>;
  usageMetadata?: GeminiUsageMetadata;
}

export type ParsedGeminiPart =
  | { kind: 'thinking'; text: string; signature: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool_use'; id: string; name: string; input: Record<string, unknown>; signature?: string };

export interface OpenAIToolCall {
  id?: string;
  index?: number;
  type?: string;
  thought_signature?: string;
  function?: { name?: string; arguments?: string };
}

export interface OpenAIChatMessage {
  role: string;
  content?: string | null;
  reasoning_content?: string;
  tool_calls?: OpenAIToolCall[];
}

export interface OpenAIChatCompletion {
  choices?: Array<{
    finish_reason?: string;
    message?: OpenAIChatMessage;
  }>;
  usage?: Record<string, unknown>;
}

export interface OpenAIStreamDelta {
  content?: string;
  reasoning_content?: string;
  tool_calls?: OpenAIToolCall[];
}

export interface OpenAIStreamChunk {
  choices?: Array<{ finish_reason?: string; delta?: OpenAIStreamDelta }>;
  usage?: Record<string, unknown>;
}
