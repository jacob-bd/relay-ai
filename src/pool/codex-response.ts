import { writeResponsesStream, type CodexToolContext } from '../codex-responses-adapter.js';
import type { FullStreamPart } from '../proxy-shared.js';
import type { PoolEvent } from './attempt.js';

/** Formats the shared pool stream through the same Responses formatter as concrete routes. */
export async function writeCodexPoolResponse(
  stream: AsyncIterable<PoolEvent>,
  modelId: string,
  write: (chunk: string) => void,
  options: { toolContext?: CodexToolContext; getToolContext?: () => CodexToolContext | undefined; maxResponseBytes?: number; nonstream?: boolean; beforeComplete?: (response: Record<string, unknown>) => void } = {},
): Promise<Record<string, unknown>> {
  let completed: Record<string, unknown> | undefined;
  let bytes = 0;
  const context: CodexToolContext = options.toolContext ?? { namespaceByFlatName: new Map(), customToolNames: new Set() };
  let ready = false;
  let finalizing = false;
  const terminalChunks: string[] = [];
  let terminalBytes = 0;
  const preamble: string[] = [];
  const contextualStream = (async function* () {
    for await (const part of stream) {
      if (!ready) {
        ready = true;
        if (!options.nonstream) for (const chunk of preamble) write(chunk);
        preamble.length = 0;
      }
      const selected = options.getToolContext?.();
      if (selected) {
        context.namespaceByFlatName = selected.namespaceByFlatName;
        context.customToolNames = selected.customToolNames;
      }
      if (part.type === 'finish') finalizing = true;
      yield part;
    }
  })();
  await writeResponsesStream(contextualStream as AsyncIterable<FullStreamPart>, modelId, chunk => {
    for (const line of chunk.split(String.fromCharCode(10))) {
      if (!line.startsWith('data:')) continue;
      const event = JSON.parse(line.slice(5)) as { type?: string; response?: Record<string, unknown> };
      if (event.type === 'response.completed' || event.type === 'response.incomplete') {
        if (!event.response) throw new Error('Pool response missing terminal result');
        options.beforeComplete?.(event.response);
        completed = event.response;
      }
      if (event.type === 'response.failed') throw new Error('Pool response failed');
    }
    if (options.nonstream) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > (options.maxResponseBytes ?? 4 * 1024 * 1024)) throw new Error('Pool response buffer exceeded');
    } else if (finalizing) {
      terminalBytes += Buffer.byteLength(chunk);
      if (terminalBytes > (options.maxResponseBytes ?? 4 * 1024 * 1024)) throw new Error('Pool response buffer exceeded');
      terminalChunks.push(chunk);
    } else if (ready) write(chunk);
    else preamble.push(chunk);
  }, undefined, undefined, { toolContext: context });
  if (!completed) throw new Error('Pool response missing terminal result');
  for (const chunk of terminalChunks) write(chunk);
  return completed;
}
