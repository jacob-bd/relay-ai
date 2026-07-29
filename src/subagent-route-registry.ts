import { randomUUID } from 'node:crypto';

const DEFAULT_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_ENTRIES = 1_024;
const ROUTE_MARKER_PATTERN = /(?:\n\n)?<relay-ai-subagent-route token="([0-9a-f-]{36})"\s*\/>/i;

type HeaderValue = string | string[] | undefined;
type HeaderMap = Record<string, HeaderValue>;
type JsonBody = Record<string, any>;

interface RegistryEntry {
  sessionId: string;
  modelId: string;
  createdAt: number;
}

export interface SubagentRouteRegistryOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

export interface CorrelatedSubagentRequest {
  modelId: string;
  body: JsonBody;
}

function firstHeader(value: HeaderValue): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' && first.trim() ? first.trim() : undefined;
}

export function extractClaudeSessionId(headers: HeaderMap, body: unknown): string | undefined {
  const headerSession = firstHeader(headers['x-claude-code-session-id']);
  if (headerSession) return headerSession;

  const userId = (body as JsonBody | undefined)?.metadata?.user_id;
  if (typeof userId !== 'string') return undefined;
  try {
    const parsed = JSON.parse(userId) as { session_id?: unknown };
    return typeof parsed.session_id === 'string' && parsed.session_id.trim()
      ? parsed.session_id.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

export function appendSubagentRouteMarker(prompt: string, token: string): string {
  return `${prompt}\n\n<relay-ai-subagent-route token="${token}"/>`;
}

function findMarkerInUserMessages(body: JsonBody): { token: string; body: JsonBody } | undefined {
  if (!Array.isArray(body.messages)) return undefined;

  for (let messageIndex = 0; messageIndex < body.messages.length; messageIndex++) {
    const message = body.messages[messageIndex];
    if (!message || message.role !== 'user') continue;

    if (typeof message.content === 'string') {
      const match = message.content.match(ROUTE_MARKER_PATTERN);
      if (!match?.[1]) continue;
      const messages = [...body.messages];
      messages[messageIndex] = {
        ...message,
        content: message.content.replace(ROUTE_MARKER_PATTERN, '').trimEnd(),
      };
      return { token: match[1], body: { ...body, messages } };
    }

    if (!Array.isArray(message.content)) continue;
    for (let partIndex = 0; partIndex < message.content.length; partIndex++) {
      const part = message.content[partIndex];
      if (!part || part.type !== 'text' || typeof part.text !== 'string') continue;
      const match = part.text.match(ROUTE_MARKER_PATTERN);
      if (!match?.[1]) continue;

      const content = [...message.content];
      content[partIndex] = {
        ...part,
        text: part.text.replace(ROUTE_MARKER_PATTERN, '').trimEnd(),
      };
      const messages = [...body.messages];
      messages[messageIndex] = { ...message, content };
      return { token: match[1], body: { ...body, messages } };
    }
  }
  return undefined;
}

export class SubagentRouteRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: SubagentRouteRegistryOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
  }

  register(sessionId: string, modelId: string): string {
    this.cleanup();
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
    const token = randomUUID();
    this.entries.set(token, { sessionId, modelId, createdAt: this.now() });
    return token;
  }

  consume(headers: HeaderMap, body: JsonBody): CorrelatedSubagentRequest | undefined {
    this.cleanup();
    if (!firstHeader(headers['x-claude-code-agent-id'])) return undefined;

    const sessionId = extractClaudeSessionId(headers, body);
    if (!sessionId) return undefined;
    const marked = findMarkerInUserMessages(body);
    if (!marked) return undefined;
    const entry = this.entries.get(marked.token);
    if (!entry || entry.sessionId !== sessionId) return undefined;

    this.entries.delete(marked.token);
    return { modelId: entry.modelId, body: marked.body };
  }

  private cleanup(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [token, entry] of this.entries) {
      if (entry.createdAt < cutoff) this.entries.delete(token);
    }
  }
}
