import { createHash, randomUUID } from 'node:crypto';
import type { PoolEvent } from './attempt.js';
import { grabRoundTripSignature, type FullStreamPart } from '../proxy-shared.js';

type Entry = { route: string; signature: string; expires: number; bytes: number };
/** Pool-only provenance. Opaque tool ids never contain a signature or a route. */
export class ClaudePoolSignatures {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  constructor(private readonly now = Date.now, private readonly capacity = 1000, private readonly ttl = 3_600_000) {}
  private key(signature: string) { return 'thinking:' + createHash('sha256').update(signature).digest('hex'); }
  private put(key: string, route: string, signature: string) {
    this.prune();
    const old = this.entries.get(key);
    if (old) { this.bytes -= old.bytes; this.entries.delete(key); }
    const bytes = Buffer.byteLength(key + route + signature);
    if (bytes > 4 * 1024 * 1024) return;
    this.entries.set(key, { route, signature, expires: this.now() + this.ttl, bytes });
    this.bytes += bytes;
    while (this.entries.size > this.capacity || this.bytes > 4 * 1024 * 1024) this.remove(this.entries.keys().next().value!);
  }
  private remove(key: string) { this.bytes -= this.entries.get(key)!.bytes; this.entries.delete(key); }
  private prune() { for (const [key, value] of this.entries) if (value.expires <= this.now()) this.remove(key); }
  tool(route: string, signature?: string): string {
    const id = 'call_' + randomUUID().replaceAll('-', '');
    if (signature) this.put(id, route, signature);
    return id;
  }
  thinking(route: string, signature: string) {
    const key = this.key(signature);
    // Identical opaque state observed from two routes cannot prove either producer.
    this.prune();
    const old = this.entries.get(key);
    this.put(key, old && old.route !== route ? '' : route, signature);
  }
  signature(id: string, route: string): string | undefined {
    this.prune(); const entry = this.entries.get(id);
    return entry?.route === route ? entry.signature : undefined;
  }
  ownsThinking(signature: string, route: string): boolean {
    return this.signature(this.key(signature), route) === signature;
  }
}
export const claudePoolSignatures = new ClaudePoolSignatures();

/** Runs only for pool output; concrete Claude gateways retain their existing ids and metadata. */
export async function* trackClaudePoolSignatures(
  parts: AsyncIterable<PoolEvent>, route: () => string | undefined,
): AsyncGenerator<PoolEvent> {
  const starts = new Map<string, string>();
  for await (const event of parts) {
    const part = event as FullStreamPart;
    const owner = route();
    const anthropic = (part.providerMetadata as { anthropic?: { signature?: string } } | undefined)?.anthropic?.signature;
    const signature = anthropic ?? grabRoundTripSignature(part);
    if (part.type === 'tool-input-start') {
      if (signature && part.id) starts.set(part.id, signature);
      yield { ...event, providerMetadata: undefined };
    } else if (part.type === 'tool-call' && owner) {
      const sig = signature ?? starts.get(part.toolCallId ?? '');
      starts.delete(part.toolCallId ?? '');
      yield { ...event, toolCallId: sig ? claudePoolSignatures.tool(owner, sig) : part.toolCallId, providerMetadata: undefined };
    } else if (part.type === 'reasoning-end' && owner && signature) {
      claudePoolSignatures.thinking(owner, signature);
      // The shared formatter understands Google/OpenAI round-trip signatures.
      yield { ...event, providerMetadata: { openai: { reasoningEncryptedContent: signature } } };
    } else yield event;
  }
}
