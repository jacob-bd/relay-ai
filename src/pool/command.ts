import { randomUUID } from 'node:crypto';
import { poolView, verifyUiPoolMember, invalidateUiPoolMember } from '../ui/pool-api.js';
import { setModelHidden, setContextWindowOverride } from '../registry/crud.js';
import pc from 'picocolors';
import { loadPreferences, savePreferences } from '../config.js';
import { fetchProviderCatalog, resolveLocalProviderApiKey } from '../provider-catalog.js';
import { createLanguageModel, effortProviderOptions } from '../provider-factory.js';
import { providerRefreshToken } from '../provider-runtime.js';
import type { PoolCapabilityReceipt } from '../types.js';
import { addFreePoolMember, parseFreePool, removeFreePoolMember } from './membership.js';
import { parsePoolReceipt } from './capabilities.js';
import { probePoolModel, probePoolEffort } from './probe.js';
import { verifyPoolMember } from './enroll.js';
import { poolProviderHeaders } from './session-id.js';
import { clearForceFail, DEFAULT_FORCE_FAIL_MINUTES, readForceFailState, setForceFail } from './force-fail.js';
import { followPoolActivity, formatPoolActivityLine, readPoolActivity } from './activity.js';

export const poolHelpText = [
  'Usage: relay-ai pool <command>   (experimental: tested with Claude Code first)',
  '  list                         Saved membership and receipts (no tests)',
  '  fail [--minutes N]           Test failover: fail whichever model answered last (repeat to fail the next one too)',
  '  force-fail <provider/model>... [--minutes N] | off   Test failover: make members fail (default 10 min), no request is sent to them',
  '  log [count] [-f|--follow]    Which pool model answered recent requests, and which failed first; -f keeps printing new ones (Ctrl+C to stop)',
  '  candidates [--search text] [--min-context tokens]  Free models, providers and total (no tests)',
  '  status                       Readiness, context, provider names and effort settings (no tests)',
  '  enable | disable             Add/remove Relay Free Pool in launched tool catalogs',
  '  add <provider> <model>        Save a member without testing; independent of favorites',
  '  remove <provider> <model>     Remove a member',
  '  move <provider> <model> <up|down>  Change routing priority',
  '  test <provider> <model>       1 request, max 1024 output tokens, no retries; response + tools',
  '  context <provider> <model>    Optional context measurement: 1 extra request',
  '  context <provider> <model> <tokens|reset>  Set/reset context without inference',
  '  reasoning <provider> <model>  Optional: up to 5 requests, no retries',
  '  hide | unhide <provider> <model>  Change provider-list visibility',
  '  effort <auto|low|medium|high>  Choose pool effort',
  '  verify [--reasoning]          Explicit bulk check of saved members; skips fresh receipts',
  'Adding, enabling, refreshing the UI list, and launching never run tests.',
  'Receipts last 24h; expiry requires an explicit Test and never triggers automatic retesting.',
  'Context requests may consume quota even when rejected. Reasoning adds up to 4 checks.',
  'See docs/FREE_POOL.md for UI/CLI equivalents and quota costs.',
].join(String.fromCharCode(10));

function traceProbeFailure(label: string): (error: unknown) => void {
  return error => {
    if (process.env.RELAY_AI_TRACE !== '1') return;
    const detail = error instanceof Error ? error.message : String(error);
    console.error(pc.dim('[pool] ' + label + ': ' + detail));
  };
}

/** Receipts are cache data: discard corruption without losing a successful verification. */
export function validPoolReceipts(receipts: readonly PoolCapabilityReceipt[]) {
  const valid: PoolCapabilityReceipt[] = [];
  const seen = new Set<string>();
  let discarded = 0;
  for (const raw of receipts) {
    const receipt = parsePoolReceipt(raw);
    if (!receipt) {
      discarded++;
      continue;
    }
    const key = JSON.stringify([receipt.member.providerId, receipt.member.modelId, receipt.endpointRevision]);
    if (seen.has(key)) {
      discarded++;
      continue;
    }
    seen.add(key);
    valid.push(receipt);
  }
  return { receipts: valid, discarded };
}

export async function runPoolCommand(args: string[]): Promise<number> {
  try {
    const pool = parseFreePool(loadPreferences().freePool);
    const [action = 'list', first, second] = args;
    if (action === '--help' || action === '-h') { console.log(poolHelpText); return 0; }
    if (action === 'candidates' || (action === 'status' && args.length === 1)) {
      const view = poolView(await fetchProviderCatalog(), pool);
      let search = ''; let minContext = 0;
      for (let i = 1; i < args.length; i += 2) {
        if (!args[i + 1]) throw new Error(poolHelpText);
        if (args[i] === '--search') search = args[i + 1].toLowerCase();
        else if (args[i] === '--min-context') {
          minContext = Number(args[i + 1]);
          if (!Number.isSafeInteger(minContext) || minContext < 0) throw new Error('Use a nonnegative context size');
        } else throw new Error(poolHelpText);
      }
      const models = view.candidates.filter(model =>
        (!search || [model.name, model.modelId, model.providerName, model.providerId].join(' ').toLowerCase().includes(search))
        && (model.contextWindow ?? 0) >= minContext);
      console.log(JSON.stringify(action === 'candidates'
        ? { total: view.candidates.length, shown: models.length, models } : view, null, 2));
      return 0;
    }
    if (['test', 'context', 'reasoning', 'hide', 'unhide'].includes(action) && first && second) {
      if (args.length !== 3 && !(action === 'context' && args.length === 4)) throw new Error(poolHelpText);
      if (action === 'hide' || action === 'unhide') {
        const result = setModelHidden(first, second, action === 'hide');
        if (!result.ok) throw new Error(result.error);
        console.log(JSON.stringify(result)); return 0;
      }
      const { testModel, checkContextWindow } = await import('../test-model.js');
      if (action === 'context') {
        if (args.length === 4) {
          const value = args[3] === 'reset' ? null : Number(args[3]);
          if (value !== null && (!Number.isSafeInteger(value) || value <= 0)) throw new Error('Use a positive token count or reset');
          const result = setContextWindowOverride(first, second, value, 'user');
          if (!result.ok) throw new Error(result.error);
          console.log(JSON.stringify(result)); return 0;
        }
        console.log('Context measurement: 1 extra request; may consume quota even if rejected.');
        console.log(JSON.stringify(await checkContextWindow(first, second))); return 0;
      }
      const signal = new AbortController().signal;
      if (action === 'reasoning') {
        console.log('Optional reasoning test: up to 5 requests, no retries.');
        const result = await verifyUiPoolMember(first, second, signal, { reasoning: true });
        console.log(JSON.stringify(result ?? { ok: false, reason: 'not-eligible' }));
        return result?.ok ? 0 : 1;
      }
      console.log('Test: 1 request, up to 1024 output tokens, no retries.');
      const result = await testModel(first, second, signal);
      if (!result.ok) invalidateUiPoolMember(first, second);
      const readiness = result.ok ? await verifyUiPoolMember(first, second, signal, {
        evidence: { text: 'passed', tools: result.toolsPassed ? 'passed' : 'failed' },
      }) : undefined;
      console.log(JSON.stringify({ ...result, ...(readiness ? { pool: readiness } : {}) }));
      return result.ok ? 0 : 1;
    }
    if (action === 'fail') {
      // Generic form: no names. Fail the member that answered most recently, adding to anything already forced.
      const rest = args.slice(1);
      let minutes = DEFAULT_FORCE_FAIL_MINUTES;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--minutes') minutes = Number(rest[++i]);
        else throw new Error(poolHelpText);
      }
      const last = readPoolActivity(200).find(entry => entry.event === 'served');
      if (!last) throw new Error('No pool request has been answered yet. Send a message through Relay Free Pool first.');
      const target = `${last.providerId}/${last.modelId}`;
      const already = readForceFailState()?.members ?? [];
      if (already.includes(target)) {
        console.log(`${target} is already being forced to fail. Send a message so the next member answers, then run this again.`);
        return 0;
      }
      const state = setForceFail([...already, target], minutes);
      console.log(`Failing ${target}${already.length ? ` (already failing: ${already.join(', ')})` : ''}.`);
      console.log(`Active until ${new Date(state.expiresAt).toLocaleTimeString()}. Send a message in your session and watch: relay-ai pool log -f`);
      console.log('Run again to fail whichever member answers next; clear with: relay-ai pool force-fail off');
      return 0;
    }
    if (action === 'force-fail') {
      const rest = args.slice(1);
      if (rest.length === 0) {
        const state = readForceFailState();
        console.log(state
          ? `Forcing failures on: ${state.members.join(', ')} (until ${new Date(state.expiresAt).toLocaleTimeString()})`
          : 'No forced failures active.');
        return 0;
      }
      if (rest.length === 1 && ['off', 'clear', 'stop'].includes(rest[0]!)) {
        clearForceFail();
        console.log('Forced failures cleared. The pool behaves normally again.');
        return 0;
      }
      let minutes = DEFAULT_FORCE_FAIL_MINUTES;
      const members: string[] = [];
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--minutes') { minutes = Number(rest[++i]); continue; }
        if (!rest[i]!.includes('/')) throw new Error('Use provider/model, for example: kilo/reflection/beam-free');
        members.push(rest[i]!);
      }
      if (members.length === 0) throw new Error(poolHelpText);
      const state = setForceFail(members, minutes);
      console.log(`Forcing failures on: ${state.members.join(', ')}`);
      console.log(`They fail before any request is sent, until ${new Date(state.expiresAt).toLocaleTimeString()} (or run: relay-ai pool force-fail off).`);
      console.log('Send a message in a session started on the latest build and watch: relay-ai pool log -f');
      return 0;
    }
    if (action === 'log' && args.length <= 3) {
      const rest = args.slice(1);
      const follow = rest.includes('-f') || rest.includes('--follow');
      const countArg = rest.find(arg => !arg.startsWith('-'));
      if (rest.some(arg => arg.startsWith('-') && arg !== '-f' && arg !== '--follow')) throw new Error(poolHelpText);
      const count = countArg === undefined ? 20 : Math.min(200, Math.max(1, Number(countArg) || 20));
      const entries = readPoolActivity(count);
      if (!follow) {
        if (entries.length === 0) { console.log('No pool requests recorded yet.'); return 0; }
        for (const e of entries) console.log(formatPoolActivityLine(e));
        return 0;
      }
      // Follow mode reads top to bottom (oldest first) so new lines continue the list.
      for (const e of [...entries].reverse()) console.log(formatPoolActivityLine(e));
      console.log(pc.dim('Watching for new pool requests. Press Ctrl+C to stop.'));
      const controller = new AbortController();
      process.once('SIGINT', () => controller.abort());
      process.once('SIGTERM', () => controller.abort());
      await followPoolActivity(e => console.log(formatPoolActivityLine(e)), controller.signal);
      return 0;
    }
    if (action === 'list' && args.length <= 1) {
      console.log(JSON.stringify(pool, null, 2));
      return 0;
    }
    if (action === 'verify' && (args.length === 1 || (args.length === 2 && first === '--reasoning'))) {
      if (pool.members.length === 0) throw new Error('Add pool members before verifying.');
      const providers = await fetchProviderCatalog();
      const signal = new AbortController().signal;
      const receipts: PoolCapabilityReceipt[] = [...pool.receipts];
      let failed = 0;
      console.log('Explicit bulk test: up to ' + pool.members.length * (first === '--reasoning' ? 5 : 1) + ' requests; fresh receipts are skipped.');
      for (const member of pool.members) {
        if (poolView(providers, pool).members.some(item => item.providerId === member.providerId && item.modelId === member.modelId && item.status === 'Ready') && first !== '--reasoning') continue;
        const foundProvider = providers.find(item => item.id === member.providerId);
        const foundModel = foundProvider?.models.find(item => item.id === member.modelId);
        const result = await verifyPoolMember(member, providers, signal, {
          resolveKey: resolveLocalProviderApiKey,
          createModel: (provider, model, apiKey) => createLanguageModel({
            npm: model.npm!, modelId: model.upstreamModelId,
            apiKey, baseURL: model.apiBaseUrl, providerId: provider.id,
            authType: provider.authType, oauthAccountId: provider.oauthAccountId,
            providerData: provider.providerData,
            headers: poolProviderHeaders(provider, model, `relay-pool-verify-${randomUUID()}`),
            sessionId: `relay-pool-verify-${randomUUID()}`,
            refreshToken: providerRefreshToken(provider.id, provider.authType, provider.authRef),
          }),
          probe: (languageModel, signal) => probePoolModel(
            languageModel,
            signal,
            20_000,
            traceProbeFailure(member.providerId + '/' + member.modelId + ' probe'),
          ),
          probeEffort: first === '--reasoning' && foundProvider && foundModel
            ? (languageModel, level) => probePoolEffort(
              languageModel,
              effortProviderOptions(foundModel.npm!, level, foundModel.upstreamModelId, {
                ...foundModel, providerId: foundProvider.id, apiBaseUrl: foundModel.apiBaseUrl,
              }) as never,
              signal,
              20_000,
              traceProbeFailure(member.providerId + '/' + member.modelId + ' effort ' + level),
            )
            : undefined,
        });
        if (result.status === 'verified') {
          const index = receipts.findIndex(receipt =>
            receipt.member.providerId === member.providerId && receipt.member.modelId === member.modelId);
          if (index === -1) receipts.push(result.receipt);
          else receipts[index] = result.receipt;
          console.log(pc.green('verified') + '  ' + member.providerId + ' / ' + member.modelId);
        } else {
          failed++;
          for (let i = receipts.length - 1; i >= 0; i--) {
            if (receipts[i].member.providerId === member.providerId && receipts[i].member.modelId === member.modelId) receipts.splice(i, 1);
          }
          console.log(pc.yellow('skipped ') + '  ' + member.providerId + ' / ' + member.modelId + '  ' + pc.dim(result.reason));
        }
      }
      const checked = validPoolReceipts(receipts);
      if (checked.discarded > 0) {
        console.log(pc.yellow('Discarded ' + checked.discarded + ' invalid or duplicate receipt(s).'));
      }
      savePreferences({ freePool: parseFreePool({ ...pool, receipts: checked.receipts }) });
      console.log(pc.dim('Receipts are valid for 24h. Membership was not changed.'));
      return failed === pool.members.length ? 1 : 0;
    }
    let next;
    if ((action === 'add' || action === 'remove') && args.length === 3) {
      const member = { providerId: first!, modelId: second! };
      next = action === 'add' ? addFreePoolMember(pool, member) : removeFreePoolMember(pool, member);
    } else if ((action === 'enable' || action === 'disable') && args.length === 1) {
      next = parseFreePool({ ...pool, enabled: action === 'enable' });
    } else if (action === 'move' && args.length === 4 && ['up', 'down'].includes(args[3])) {
      const index = pool.members.findIndex(member => member.providerId === first && member.modelId === second);
      if (index < 0) throw new Error('Model is not in the pool');
      const target = index + (args[3] === 'up' ? -1 : 1);
      next = parseFreePool(pool);
      if (target >= 0 && target < next.members.length) [next.members[index], next.members[target]] = [next.members[target], next.members[index]];
    } else if (action === 'effort' && args.length === 2) {
      next = parseFreePool({ ...pool, effort: first! });
    } else throw new Error(poolHelpText);
    savePreferences({ freePool: next });
    console.log('Free pool saved.');
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Unable to update free pool');
    return 1;
  }
}
