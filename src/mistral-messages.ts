// Mistral API enforces strict chat message ordering (code 3230).
// Claude Code may inject { role: 'system' } mid-conversation after tool results.

export interface OpenAIChatMessage {
  role: string;
  content?: string | null | unknown[];
  tool_calls?: unknown[];
  tool_call_id?: string;
  reasoning_content?: string;
  [key: string]: unknown;
}

export interface MistralNormalizeResult {
  messages: OpenAIChatMessage[];
  hoistedSystemBlocks: number;
  insertedAssistantFillers: number;
}

const MISTRAL_MODEL_PATTERN = /mistral|ministral|devstral|pixtral/i;

export function isMistralUpstream(completionsUrl: string | undefined, modelId: string | undefined): boolean {
  if (completionsUrl?.includes('api.mistral.ai')) return true;
  if (modelId && MISTRAL_MODEL_PATTERN.test(modelId)) return true;
  return false;
}

function systemContent(msg: OpenAIChatMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  if (msg.content === null || msg.content === undefined) return '';
  return JSON.stringify(msg.content);
}

/** Hoist all system messages to the front; insert assistant filler between tool→user. */
export function normalizeMistralMessages(messages: OpenAIChatMessage[]): MistralNormalizeResult {
  const systemParts: string[] = [];
  const body: OpenAIChatMessage[] = [];
  let hoistedSystemBlocks = 0;

  for (const msg of messages) {
    if (msg.role === 'system') {
      const text = systemContent(msg).trim();
      if (text) systemParts.push(text);
      hoistedSystemBlocks++;
      continue;
    }
    body.push(msg);
  }

  const merged: OpenAIChatMessage[] = [];
  if (systemParts.length > 0) {
    merged.push({ role: 'system', content: systemParts.join('\n\n') });
  }

  let insertedAssistantFillers = 0;
  for (let i = 0; i < body.length; i++) {
    merged.push(body[i]);
    const curr = body[i];
    const next = body[i + 1];
    if (curr.role === 'tool' && next?.role === 'user') {
      merged.push({ role: 'assistant', content: '' });
      insertedAssistantFillers++;
    }
  }

  return { messages: merged, hoistedSystemBlocks, insertedAssistantFillers };
}
