import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadPreferences, savePreferences } from '../config.js';
import { fetchProviderCatalog } from '../provider-catalog.js';
import { classifyFreeStatus } from '../free-models.js';
import { readBody, sendJson } from '../http-utils.js';
import { addFreePoolMember, parseFreePool, removeFreePoolMember } from '../pool/membership.js';
import { currentPoolReceipt, poolEndpointRevision } from '../pool/capabilities.js';
import { verifyConfiguredPoolMember } from '../pool/verify.js';
import type { LocalProvider, LocalProviderModel } from '../types.js';

const verifying = new Set<string>();
function revision(provider: LocalProvider, model: LocalProviderModel) {
  return poolEndpointRevision({ providerId: provider.id, authRef: provider.authRef, npm: model.npm!,
    baseURL: model.apiBaseUrl, upstreamModelId: model.upstreamModelId, headers: provider.headers });
}
function admission(provider: LocalProvider, model: LocalProviderModel): string | undefined {
  if (classifyFreeStatus({ model, providerId: provider.id }) !== 'verified_free') return 'Requires verified zero pricing';
  if (!model.npm || model.modelFormat === 'cloud-code') return 'Unsupported pool transport';
  if (model.contextWindowEstimated || !Number.isSafeInteger(model.contextWindow) || !model.contextWindow || model.contextWindow <= 0) return 'Set or measure a context size first';
  return undefined;
}
export async function handlePoolApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const providers = await fetchProviderCatalog();
    let pool = parseFreePool(loadPreferences().freePool);
    if (req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      // Never accept capability receipts supplied by a browser.
      if ('receipts' in body) throw new Error('Capability receipts are created only by verification');
      if (body.action === 'effort') pool = parseFreePool({ ...pool, effort: body.effort });
      else {
        const member = { providerId: body.providerId, modelId: body.modelId };
        if (typeof member.providerId !== 'string' || typeof member.modelId !== 'string') throw new Error('Choose a provider account and model');
        const index = pool.members.findIndex(item => item.providerId === member.providerId && item.modelId === member.modelId);
        if (body.action === 'add') {
          const provider = providers.find(item => item.id === member.providerId);
          const model = provider?.models.find(item => item.id === member.modelId);
          if (!provider || !model) throw new Error('Model is unavailable or hidden');
          const reason = admission(provider, model);
          if (reason) throw new Error(reason);
          pool = addFreePoolMember(pool, member);
        } else if (body.action === 'remove') pool = removeFreePoolMember(pool, member);
        else if (body.action === 'move') {
          if (index < 0 || ![-1, 1].includes(body.direction)) throw new Error('Invalid priority change');
          const next = index + body.direction;
          if (next >= 0 && next < pool.members.length) [pool.members[index], pool.members[next]] = [pool.members[next]!, pool.members[index]!];
        } else if (body.action === 'verify') {
          if (index < 0) throw new Error('Add the model to the pool first');
          const provider = providers.find(item => item.id === member.providerId);
          const model = provider?.models.find(item => item.id === member.modelId);
          if (!provider || !model) throw new Error('Model is unavailable or hidden');
          const reason = admission(provider, model);
          if (reason) throw new Error(reason);
          const key = JSON.stringify(member);
          if (verifying.has(key)) { sendJson(res, 409, { error: 'This model is already being verified' }); return; }
          verifying.add(key);
          const abort = new AbortController();
          const cancel = () => { if (!res.writableFinished) abort.abort(); };
          res.once('close', cancel);
          try {
            const result = await verifyConfiguredPoolMember(member, providers, abort.signal);
            // Reload after network work so concurrent membership changes survive.
            pool = parseFreePool(loadPreferences().freePool);
            if (!pool.members.some(item => item.providerId === member.providerId && item.modelId === member.modelId)) throw new Error('Model was removed during verification');
            pool.receipts = pool.receipts.filter(item => item.member.providerId !== member.providerId || item.member.modelId !== member.modelId);
            if (result.status === 'verified') pool.receipts.push(result.receipt);
            savePreferences({ freePool: pool });
            sendJson(res, 200, { ok: result.status === 'verified', reason: result.status === 'skipped' ? result.reason : undefined });
            return;
          } finally { verifying.delete(key); res.removeListener('close', cancel); }
        } else throw new Error('Unknown pool action');
      }
      savePreferences({ freePool: pool });
      sendJson(res, 200, { ok: true });
      return;
    }
    const members = pool.members.map(member => {
      const provider = providers.find(item => item.id === member.providerId);
      const model = provider?.models.find(item => item.id === member.modelId);
      const receipt = provider && model?.npm ? currentPoolReceipt(pool.receipts, member, revision(provider, model), Date.now()) : undefined;
      const reason = provider && model ? admission(provider, model) : 'Model is unavailable or hidden';
      return { ...member, name: model?.name ?? member.modelId, providerName: provider?.name ?? member.providerId,
        status: reason ? 'Unavailable' : receipt ? 'Verified' : 'Needs verification', reason,
        targets: reason ? [] : receipt?.targets ?? [], expiresAt: receipt?.expiresAt, effortLevels: receipt?.effortLevels ?? [] };
    });
    const candidates = providers.flatMap(provider => provider.models.filter(model => !admission(provider, model))
      .map(model => ({ providerId: provider.id, modelId: model.id, name: model.name, providerName: provider.name })));
    sendJson(res, 200, { members, candidates, effort: pool.effort });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'Unable to update the free pool' });
  }
}
