import * as p from '@clack/prompts';
import { addManualModel, removeManualModel } from './registry/manual-models.js';
import { contextWindowError, modelIdError } from './registry/provider-models.js';
import type { RegistryProvider } from './registry/types.js';

export async function runManualModelAddFlow(provider: RegistryProvider): Promise<number> {
  const modelId = await p.text({ message: 'Exact model ID from your provider', placeholder: 'e.g. deepseek-v4.1-flash-expires-on-0910', validate: modelIdError });
  if (p.isCancel(modelId)) return 0;
  const displayName = await p.text({ message: 'Display name (optional)', defaultValue: modelId as string,
    validate: value => value && (value.length > 200 || /[\u0000-\u001f\u007f]/u.test(value)) ? 'Use at most 200 characters without control characters.' : undefined });
  if (p.isCancel(displayName)) return 0;
  const context = await p.text({ message: 'Context size in tokens (optional — leave blank if unknown)',
    validate: value => contextWindowError(value?.trim() ? Number(value) : undefined) });
  if (p.isCancel(context)) return 0;
  const contextText = typeof context === 'string' ? context.trim() : '';
  const confirmed = await p.confirm({ message: 'Test & add? Sends three small requests to this provider; API charges may apply.', initialValue: true });
  if (p.isCancel(confirmed) || !confirmed) return 0;
  const spinner = p.spinner();
  spinner.start('Testing generation, streaming and tool round-trip (up to 90 seconds)…');
  const result = await addManualModel({ providerId: provider.id, modelId: String(modelId), displayName: String(displayName),
    ...(contextText ? { contextWindow: Number(contextText) } : {}) });
  spinner.stop(result.ok ? 'Validation passed' : 'Validation failed');
  if (!result.ok) { p.log.error(result.error ?? 'Model was not added.'); return 1; }
  p.log.success(`${result.model!.name} added. Manual models are preserved when you refresh the catalog.`);
  p.log.info('Generation, streaming and tools passed. Pricing and vision support are unknown; context size is user-supplied if set.');
  return 0;
}

export async function runManualModelRemoveFlow(provider: RegistryProvider): Promise<number> {
  const models = provider.manualModels ?? [];
  if (!models.length) return 0;
  const id = await p.select({ message: 'Remove which manual model?', options: models.map(m => ({ value: m.id, label: m.name, hint: m.id })) });
  if (p.isCancel(id)) return 0;
  const confirmed = await p.confirm({ message: `Remove the manual entry for ${id}?`, initialValue: false });
  if (p.isCancel(confirmed) || !confirmed) return 0;
  const result = removeManualModel(provider.id, String(id));
  if (!result.ok) { p.log.error(result.error ?? 'Could not remove model.'); return 1; }
  p.log.success('Manual entry removed. If the provider now lists this ID, its discovered entry remains available.');
  return 0;
}
