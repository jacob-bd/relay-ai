// Shared helpers for Anthropic ↔ upstream translation proxies.

export type FullStreamPart = {
  type: string;
  id?: string;
  text?: string;
  delta?: string;
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  finishReason?: string;
  totalUsage?: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number };
  providerMetadata?: {
    google?: { thoughtSignature?: string; thought_signature?: string };
    openai?: { reasoningEncryptedContent?: string | null };
  };
  error?: unknown;
  reason?: string;
};

export function grabRoundTripSignature(part: FullStreamPart): string | undefined {
  const md = part.providerMetadata;
  return md?.google?.thoughtSignature
    ?? md?.google?.thought_signature
    ?? md?.openai?.reasoningEncryptedContent
    ?? undefined;
}

let sdkWarningsSilenced = false;

export function silenceSdkWarnings(): void {
  if (sdkWarningsSilenced) return;
  sdkWarningsSilenced = true;
  (globalThis as { AI_SDK_LOG_WARNINGS?: false }).AI_SDK_LOG_WARNINGS = false;
}

const TOOL_USE_SIG_SEP = '__ts__';
const MAX_INLINE_TOOL_SIGNATURE_BYTES = 256;
const MAX_STORED_TOOL_SIGNATURES = 1000;
const toolSignatureRegistry = new Map<string, string>();

function rememberToolSignature(rawId: string, thoughtSignature: string): void {
  toolSignatureRegistry.set(rawId, thoughtSignature);
  if (toolSignatureRegistry.size <= MAX_STORED_TOOL_SIGNATURES) return;
  const oldest = toolSignatureRegistry.keys().next().value as string | undefined;
  if (oldest) toolSignatureRegistry.delete(oldest);
}

export function parseToolArguments(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch { /* fall through */ }
  }
  return {};
}

export function sseChunk(eventType: string, data: unknown): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * DeepSeek V4's "DSML" tool-calling protocol: an XML-style block using the fullwidth
 * pipe `｜` as a marker character, e.g. `<｜DSML｜tool_calls><｜DSML｜invoke name="x">
 * <｜DSML｜parameter name="y" string="true">value</｜DSML｜parameter></｜DSML｜invoke>
 * </｜DSML｜tool_calls>`. Not officially documented by DeepSeek, but widely reported
 * (vLLM issue #41240, Cherry Studio issue #14714) as leaking into plain assistant text
 * instead of firing real tool calls when a serving backend's tool-call parser doesn't
 * fully handle it — observed live via OpenCode Zen's free deepseek-v4-flash-free.
 * The marker is also observed rendered with stray ASCII pipes/whitespace instead of the
 * clean fullwidth character, so matching tolerates either.
 */
const DSML_NOISE = '[|｜\\s]*';
const DSML_BLOCK_RE = new RegExp(`<${DSML_NOISE}DSML${DSML_NOISE}tool_calls>([\\s\\S]*?)<\\/${DSML_NOISE}DSML${DSML_NOISE}tool_calls>`, 'i');
const DSML_INVOKE_RE = new RegExp(`<${DSML_NOISE}DSML${DSML_NOISE}invoke\\s+name="([^"]+)"[^>]*>([\\s\\S]*?)<\\/${DSML_NOISE}DSML${DSML_NOISE}invoke>`, 'gi');
const DSML_PARAM_RE = new RegExp(`<${DSML_NOISE}DSML${DSML_NOISE}parameter\\s+name="([^"]+)"(?:\\s+string="(true|false)")?[^>]*>([\\s\\S]*?)<\\/${DSML_NOISE}DSML${DSML_NOISE}parameter>`, 'gi');

export interface DsmlToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface DsmlParseResult {
  /** Any text before the <DSML tool_calls> block (usually empty). */
  leadingText: string;
  calls: DsmlToolCall[];
}

/** Returns null when no complete DSML tool_calls block is present (including a
 *  truncated/unclosed one — safer to leave a partial block as visible text than
 *  guess at incomplete arguments). */
export function parseDsmlToolCalls(text: string): DsmlParseResult | null {
  const outer = DSML_BLOCK_RE.exec(text);
  if (!outer) return null;

  const calls: DsmlToolCall[] = [];
  for (const invokeMatch of outer[1]!.matchAll(DSML_INVOKE_RE)) {
    const name = invokeMatch[1]!;
    const body = invokeMatch[2]!;
    const args: Record<string, unknown> = {};
    for (const paramMatch of body.matchAll(DSML_PARAM_RE)) {
      const paramName = paramMatch[1]!;
      const isJson = paramMatch[2] === 'false';
      const rawValue = paramMatch[3] ?? '';
      if (isJson) {
        try {
          args[paramName] = JSON.parse(rawValue.trim());
        } catch {
          args[paramName] = rawValue;
        }
      } else {
        args[paramName] = rawValue;
      }
    }
    calls.push({ name, args });
  }
  if (!calls.length) return null;

  return { leadingText: text.slice(0, outer.index).trim(), calls };
}

/** Parse one SSE line into a JSON payload string, or null if not a data line. */
export function extractSseDataPayload(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':')) return null;
  if (trimmed.startsWith('data:')) {
    const payload = trimmed.slice(5).trimStart();
    if (!payload || payload === '[DONE]') return null;
    return payload;
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;
  return null;
}

export function splitToolUseId(id: string): { rawId: string; thoughtSignature?: string } {
  let sep = id.lastIndexOf(TOOL_USE_SIG_SEP);
  if (sep !== -1) {
    return {
      rawId: id.slice(0, sep),
      thoughtSignature: Buffer.from(id.slice(sep + TOOL_USE_SIG_SEP.length), 'base64url').toString('utf8'),
    };
  }

  // Legacy fallback for active sessions that used ::ts:: before the restart
  sep = id.lastIndexOf('::ts::');
  if (sep !== -1) {
    return {
      rawId: id.slice(0, sep),
      thoughtSignature: id.slice(sep + 6),
    };
  }

  return { rawId: id, thoughtSignature: toolSignatureRegistry.get(id) };
}

export function encodeToolUseId(rawId: string, thoughtSignature?: string, inline = true): string {
  if (!thoughtSignature) return rawId;
  rememberToolSignature(rawId, thoughtSignature);
  if (!inline) return rawId;
  if (Buffer.byteLength(thoughtSignature, 'utf8') > MAX_INLINE_TOOL_SIGNATURE_BYTES) {
    return rawId;
  }
  const encoded = Buffer.from(thoughtSignature, 'utf8').toString('base64url');
  return `${rawId}${TOOL_USE_SIG_SEP}${encoded}`;
}

export function stripToolUseIdSuffix(toolUseId: string): string {
  return splitToolUseId(toolUseId).rawId;
}

export function serializeToolResultContent(content: unknown): string {
  return typeof content === 'string' ? content : JSON.stringify(content);
}

/** Incrementally read SSE lines from an upstream stream without re-splitting the full buffer. */
export function attachSseLineReader(
  upstream: NodeJS.ReadableStream,
  onLine: (line: string) => void,
  onDone: () => void,
): void {
  const decoder = new TextDecoder();
  let buffer = '';

  const flushRemainder = () => {
    const trimmed = buffer.trim();
    if (trimmed) onLine(trimmed);
    buffer = '';
  };

  upstream.on('data', (chunk: Buffer) => {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      onLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  });

  upstream.on('end', () => {
    flushRemainder();
    onDone();
  });

  upstream.on('error', () => onDone());
}
