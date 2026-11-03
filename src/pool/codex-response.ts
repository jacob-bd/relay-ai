import { writeResponsesStream, type CodexToolContext } from '../codex-responses-adapter.js';
import type { FullStreamPart } from '../proxy-shared.js';
import type { PoolEvent } from './attempt.js';

/** Formats the shared pool stream through the same Responses formatter as concrete routes. */
export async function writeCodexPoolResponse(
  stream: AsyncIterable<PoolEvent>,
  modelId: string,
  write: (chunk: string) => void,
  options: { toolContext?: CodexToolContext; getToolContext?: () => CodexToolContext | undefined; maxResponseBytes?: number; nonstream?: boolean } = {},
): Promise<Record<string, unknown>> {
  let completed: Record<string, unknown> | undefined;
  let bytes = 0;
  const context: CodexToolContext = options.toolContext ?? { namespaceByFlatName: new Map(), customToolNames: new Set() };
  const contextualStream = (async function* () {
    for await (const part of stream) {
      const selected = options.getToolContext?.();
      if (selected) {
        context.namespaceByFlatName = selected.namespaceByFlatName;
        context.customToolNames = selected.customToolNames;
      }
      yield part;
    }
  })();
  await writeResponsesStream(contextualStream as AsyncIterable<FullStreamPart>, modelId, chunk => {
    if (options.nonstream) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > (options.maxResponseBytes ?? 4 * 1024 * 1024)) throw new Error('Pool response buffer exceeded');
    } else write(chunk);
    for (const line of chunk.split(String.fromCharCode(10))) {
      if (!line.startsWith('data:')) continue;
      const event = JSON.parse(line.slice(5)) as { type?: string; response?: Record<string, unknown> };
      if (event.type === 'response.completed' || event.type === 'response.incomplete') completed = event.response;
      if (event.type === 'response.failed') throw new Error('Pool response failed');
    }
  }, undefined, undefined, { toolContext: context });
  if (!completed) throw new Error('Pool response missing terminal result');
  return completed;
}
