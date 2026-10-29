// Live prompt-cache harness — the answer to "does a repeated agent prompt actually
// hit the provider's cache when it goes through Core?" against the developer's real
// registry and credentials.
//
// Excluded from `npm test` (the debug-* pattern); opt-in per provider:
//   CACHE_LIVE_FILTER=claude-code,openai-oauth,antigravity,go npm run test:live:cache
//   CACHE_LIVE_ROUTES=<routeId>[,<routeId>] npm run test:live:cache   (exact routes instead of auto-pick)
//   CACHE_LIVE_DELAY_MS=<ms> sets the pause between the cold and repeat calls (default 3000)
//   CACHE_LIVE_NO_SESSION=1 omits the sessionId (so OpenAI gets no prompt_cache_key) for A/B comparison
//   add CACHE_LIVE_DRY=1 to print the plan without sending anything
// With neither set it only lists what it would test.
//
// Per route it sends five requests through createRelayModel (the pipeline Alef and the
// apps use, with a sessionId like Alef passes):
//   1. cold:   [system+tools, user1]           — writes the cache
//   2. repeat: [system+tools, user1]           — pure prefix: should read the cache
//   3. extend: [system+tools, user1, a, user2] — a growing conversation: should still read the prefix
//   4. extend again: the same as 3 — steady state
//   5. grow: one more turn on top of 3 — what a real agent loop sends next
// and prints cache-read / cache-write / input tokens for each, then a verdict.
// A random nonce leads the system prompt so call 1 is always cold. Cost: ~3 x 7k input tokens per route.
//
// Each live route reads one OS-keychain item (macOS prompts unless the binary has "Always Allow").

import { describe, it, afterAll, beforeAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { streamText, tool, jsonSchema } from 'ai';
import { createRelayModel, listRelayModels } from '../src/core/index.js';
import { providerKind } from '../src/registry/provider-kind.js';

let savedHome: string | undefined;
beforeAll(() => {
  savedHome = process.env['RELAY_AI_HOME'];
  delete process.env['RELAY_AI_HOME'];
});
afterAll(() => {
  if (savedHome === undefined) delete process.env['RELAY_AI_HOME'];
  else process.env['RELAY_AI_HOME'] = savedHome;
});

const report: string[] = [];
function out(line: string): void {
  report.push(line);
  process.stdout.write(`${line}\n`);
}

/** A cheap, representative model per provider kind (override with CACHE_LIVE_ROUTES). */
const PREFERRED_MODEL: Record<string, RegExp> = {
  'claude-code': /haiku/i,
  anthropic: /haiku/i,
  'openai-oauth': /mini/i,
  openai: /mini/i,
  antigravity: /flash/i,
  google: /flash/i,
  go: /deepseek|kimi|glm|qwen/i,
  zen: /deepseek|kimi|glm|qwen/i,
};

function csv(name: string): string[] {
  return (process.env[name] ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

interface Target { providerId: string; modelId: string; routeId: string }

function plan(): Target[] {
  const routes = csv('CACHE_LIVE_ROUTES');
  const all = listRelayModels();
  if (routes.length > 0) {
    return routes.flatMap(routeId => {
      const d = all.find(m => m.routeId === routeId);
      return d ? [{ providerId: d.providerId, modelId: d.modelId, routeId: d.routeId }] : [];
    });
  }
  const filter = csv('CACHE_LIVE_FILTER');
  const targets: Target[] = [];
  for (const providerId of filter) {
    const models = all.filter(m => m.providerId === providerId && !/free/i.test(m.modelId));
    const preferred = PREFERRED_MODEL[providerKind(providerId)];
    const pick = (preferred && models.find(m => preferred.test(m.modelId))) ?? models[0];
    if (pick) targets.push({ providerId, modelId: pick.modelId, routeId: pick.routeId });
  }
  return targets;
}

const RULES = Array.from({ length: 380 }, (_, i) =>
  `Rule ${i + 1}: when handling request type ${i + 1}, check the ledger entry for account ${(i * 7) % 97}, record the outcome in section ${(i * 13) % 41}, and never reorder earlier entries.`,
).join('\n');

function tools() {
  const t = (_name: string, what: string) => tool({
    description: `${what} ${'Use this tool only when the user explicitly asks for it and always validate arguments first. '.repeat(8)}`,
    inputSchema: jsonSchema({ type: 'object', properties: { query: { type: 'string', description: 'What to look up' } }, required: ['query'] }),
  });
  return {
    lookup_account: t('lookup_account', 'Look up an account in the ledger.'),
    post_entry: t('post_entry', 'Post a new entry to the ledger.'),
    list_sections: t('list_sections', 'List the ledger sections.'),
  };
}

/** Core's own transport debug lines (the WebSocket path logs the request field names and reply frames here). */
const debugLines: string[] = [];

/** Records what each upstream HTTP call carries (field names only, never prompt text) and the usage the reply reports. */
const wire: string[] = [];
function installFetchSpy(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const res = await original(input, init);
    if (/chatgpt\.com|api\.openai\.com|opencode\.ai/.test(url)) {
      const raw = init?.body;
      const text = typeof raw === 'string' ? raw : raw instanceof Uint8Array ? new TextDecoder().decode(raw) : undefined;
      let sent = 'body=n/a';
      try {
        const j = text ? JSON.parse(text) as Record<string, unknown> : undefined;
        if (j) {
          const key = j['prompt_cache_key'] ? `prompt_cache_key=${String(j['prompt_cache_key']).slice(0, 8)}…` : 'NO prompt_cache_key';
          sent = `fields=[${Object.keys(j).join(',')}] ${key} store=${String(j['store'])} instructions=${typeof j['instructions']}`;
        }
      } catch { /* not JSON */ }
      const u = new URL(url);
      res.clone().text().then(body => {
        const usage = body.match(/"usage":\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g)?.at(-1);
        wire.push(`${u.host}${u.pathname} ${sent} reply-usage=${usage ? usage.slice(0, 350) : 'none'}`);
      }).catch(() => { /* diagnostics only */ });
    }
    return res;
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

interface Row { cacheRead?: number; cacheWrite?: number; input?: number; seconds: string; finish?: string; streamError?: string; diag?: string }

async function oneCall(target: Target, sessionId: string, nonce: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<Row> {
  const started = Date.now();
  const model = await createRelayModel(target.routeId, { ...(process.env['CACHE_LIVE_NO_SESSION'] === '1' ? {} : { sessionId }), onDebug: (m: string) => { debugLines.push(m); } });
  const result = streamText({
    model,
    system: `Session ${nonce}. You are a ledger assistant.\n${RULES}`,
    tools: tools(),
    messages,
    toolChoice: 'none',
    maxOutputTokens: 2000,
    abortSignal: AbortSignal.timeout(90_000),
  });
  let streamError: string | undefined;
  let finish: string | undefined;
  for await (const part of result.fullStream) {
    if (part.type === 'error') streamError = String((part.error as { message?: string } | undefined)?.message ?? part.error).slice(0, 300);
    if (part.type === 'finish') finish = String(part.finishReason);
  }
  let usage: Awaited<typeof result.usage>;
  try {
    usage = await result.usage;
  } catch (error) {
    // The SDK reports "No output generated" when the stream carried no step; the stream's own error is the real reason.
    throw new Error(`${streamError ?? (error instanceof Error ? error.message : String(error))}${finish ? ` (finish=${finish})` : ' (stream ended with no finish event)'}`);
  }
  // Diagnostics: which request fields were sent (names only, never the prompt) and what the provider said about usage.
  let diag: string | undefined;
  try {
    const body = (await result.request).body;
    const sent = typeof body === 'string' ? JSON.parse(body) as Record<string, unknown> : undefined;
    const keys = sent ? Object.keys(sent).join(',') : 'n/a';
    const cacheKey = sent && 'prompt_cache_key' in sent ? `prompt_cache_key=${String(sent['prompt_cache_key']).slice(0, 8)}…` : 'no prompt_cache_key';
    diag = `body-fields=[${keys}] ${cacheKey} raw-usage=${JSON.stringify((usage as { raw?: unknown }).raw ?? null).slice(0, 400)}`;
  } catch { /* diagnostics are best-effort */ }
  const details = (usage as { inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number } }).inputTokenDetails;
  return {
    cacheRead: details?.cacheReadTokens ?? (usage as { cachedInputTokens?: number }).cachedInputTokens,
    cacheWrite: details?.cacheWriteTokens,
    input: usage.inputTokens,
    seconds: ((Date.now() - started) / 1000).toFixed(1),
    ...(finish ? { finish } : {}),
    ...(streamError ? { streamError } : {}),
    ...(diag ? { diag } : {}),
  };
}

function verdict(repeat: Row, extend: Row): string {
  const reported = repeat.cacheRead !== undefined || extend.cacheRead !== undefined;
  if (!reported) return 'UNREPORTED (provider/SDK gave no cache numbers — cannot tell)';
  const ratio = (r: Row) => (r.input ? (r.cacheRead ?? 0) / r.input : 0);
  if (ratio(repeat) >= 0.5 && ratio(extend) >= 0.5) return 'HIT';
  if ((repeat.cacheRead ?? 0) > 0 || (extend.cacheRead ?? 0) > 0) return 'PARTIAL';
  return 'MISS';
}

const fmt = (r: Row) => `read=${r.cacheRead ?? 'n/a'} write=${r.cacheWrite ?? 'n/a'} input=${r.input ?? 'n/a'} (${r.seconds}s)${r.finish ? ` finish=${r.finish}` : ''}${r.streamError ? ` STREAM-ERROR: ${r.streamError}` : ''}`;

describe('live prompt-cache harness', () => {
  it('repeated agent prompts read the provider cache (network)', async () => {
    const targets = plan();
    out('plan:');
    for (const t of targets) out(`  ${t.providerId.padEnd(16)} ${t.modelId}   route=${t.routeId}`);
    if (process.env['CACHE_LIVE_DRY'] === '1' && targets.length > 0) {
      out('dry run — nothing sent');
      return;
    }
    if (targets.length === 0) {
      out('nothing to run — set CACHE_LIVE_FILTER=<providerId[,providerId]> or CACHE_LIVE_ROUTES=<routeId[,routeId]>');
      return;
    }

    const uninstall = installFetchSpy();
    for (const target of targets) {
      wire.length = 0;
      debugLines.length = 0;
      const nonce = randomBytes(6).toString('hex');
      const sessionId = `cache-live-${nonce}`;
      const user1 = { role: 'user' as const, content: 'Reply with the single word: ok' };
      try {
        const cold = await oneCall(target, sessionId, nonce, [user1]);
        await new Promise(r => setTimeout(r, Number(process.env['CACHE_LIVE_DELAY_MS'] ?? 3000)));
        const repeat = await oneCall(target, sessionId, nonce, [user1]);
        await new Promise(r => setTimeout(r, 1000));
        const extend = await oneCall(target, sessionId, nonce, [
          user1,
          { role: 'assistant', content: 'ok' },
          { role: 'user', content: 'Reply with the single word: done' },
        ]);
        await new Promise(r => setTimeout(r, 1000));
        const extendAgain = await oneCall(target, sessionId, nonce, [
          user1,
          { role: 'assistant', content: 'ok' },
          { role: 'user', content: 'Reply with the single word: done' },
        ]);
        out(`${target.providerId} / ${target.modelId}`);
        out(`  1 cold         ${fmt(cold)}`);
        out(`  2 repeat       ${fmt(repeat)}`);
        out(`  3 extend       ${fmt(extend)}`);
        out(`  4 extend again ${fmt(extendAgain)}`);
        await new Promise(r => setTimeout(r, 1000));
        const grow = await oneCall(target, sessionId, nonce, [
          user1,
          { role: 'assistant', content: 'ok' },
          { role: 'user', content: 'Reply with the single word: done' },
          { role: 'assistant', content: 'done' },
          { role: 'user', content: 'Reply with the single word: again' },
        ]);
        out(`  5 grow (next real turn) ${fmt(grow)}`);
        await new Promise(r => setTimeout(r, 500));
        wire.slice(0, 2).forEach((line, i) => out(`  wire(${i === 0 ? 'cold' : 'repeat'}) ${line}`));
        debugLines.filter(l => /connecting|request type|frame#|terminal event|close code/.test(l)).slice(0, 40)
          .forEach(l => out(`  transport ${l.slice(0, 700)}`));
        out(`  => ${verdict(repeat, extend)}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = (error as { statusCode?: number } | null)?.statusCode;
        out(`${target.providerId} / ${target.modelId}: ERROR${status ? ` [HTTP ${status}]` : ''}: ${message.slice(0, 300)}`);
      }
    }
    uninstall();
    writeFileSync('/tmp/relay-cache-live.txt', `${report.join('\n')}\n`);
    out('full report: /tmp/relay-cache-live.txt');
  }, 1_800_000);
});
