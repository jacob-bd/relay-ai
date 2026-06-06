// src/prompts.ts
import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { BackendConfig, ModelInfo, UserPreferences, ConflictInfo, LocalProvider, LocalProviderModel } from './types.js';
import { BACKENDS } from './constants.js';
import { groupModels } from './models.js';

function modelLabel(model: ModelInfo, showBackendBadge = false): string {
  if (model.modelFormat === 'unsupported') {
    return pc.dim(`${model.name} (not yet supported)`);
  }
  if (model.isFree) {
    const tag = showBackendBadge ? '(free · Zen)' : '(free)';
    return pc.green(`${model.name} ${tag}`);
  }
  return model.name;
}

function modelHint(model: ModelInfo): string {
  const parts: string[] = [];
  if (model.modelFormat === 'openai') parts.push('via proxy');
  else if (model.modelFormat === 'unsupported') parts.push('needs format support');
  if (!model.isFree) parts.push(`${model.brand} · ${model.id}`);
  else parts.push(model.id);
  return parts.join(' · ');
}

export async function askSubscriptionTier(): Promise<'free' | 'zen' | 'go' | 'both' | null> {
  const tier = await p.select<'free' | 'zen' | 'go' | 'both'>({
    message: 'What OpenCode subscription do you have?',
    options: [
      {
        value: 'free' as const,
        label: 'Free only',
        hint: 'Zen free models only — no subscription needed',
      },
      {
        value: 'zen' as const,
        label: 'Zen subscription',
        hint: 'All Zen models (paid + free)',
      },
      {
        value: 'go' as const,
        label: 'Go subscription',
        hint: 'All Go models',
      },
      {
        value: 'both' as const,
        label: 'Both (Zen + Go)',
        hint: 'All Go models + all Zen models — choose backend each launch',
      },
    ],
    initialValue: 'free' as const,
  });

  if (p.isCancel(tier)) {
    p.cancel('Cancelled.');
    return null;
  }

  return tier;
}

export async function pickLocalModel(
  provider: LocalProvider,
  conflicts: ConflictInfo[],
  prefs: UserPreferences,
): Promise<LocalProviderModel | null> {
  // Group models by brand and sort within each brand by id
  const brandMap = new Map<string, LocalProviderModel[]>();
  for (const model of provider.models) {
    const group = brandMap.get(model.brand) ?? [];
    group.push(model);
    brandMap.set(model.brand, group);
  }
  for (const group of brandMap.values()) {
    group.sort((a, b) => a.id.localeCompare(b.id));
  }

  let filteredModels: LocalProviderModel[];

  if (provider.models.length > 10) {
    const filterInput = await p.text({
      message: 'Filter models (leave blank for all):',
    });

    if (p.isCancel(filterInput)) {
      p.cancel('Cancelled.');
      return null;
    }

    const filterStr = (filterInput as string).trim().toLowerCase();
    if (filterStr) {
      const matched = provider.models.filter(
        m =>
          m.id.toLowerCase().includes(filterStr) ||
          m.name.toLowerCase().includes(filterStr) ||
          m.brand.toLowerCase().includes(filterStr),
      );
      if (matched.length === 0) {
        p.log.warn('No models match that filter — showing all');
        filteredModels = provider.models;
      } else {
        filteredModels = matched;
      }
    } else {
      filteredModels = provider.models;
    }
  } else {
    filteredModels = provider.models;
  }

  // Sort filtered list by brand then id
  filteredModels = [...filteredModels].sort((a, b) => {
    const brandCmp = a.brand.localeCompare(b.brand);
    return brandCmp !== 0 ? brandCmp : a.id.localeCompare(b.id);
  });

  // Build select options
  const options = filteredModels.map(model => ({
    value: model.id,
    label: model.name !== model.id ? model.name : model.id,
    hint: model.name !== model.id ? model.id : model.brand,
  }));

  if (options.length === 0) {
    p.cancel('No models available for this provider.');
    return null;
  }

  const defaultModel =
    prefs.lastModel && options.some(o => o.value === prefs.lastModel)
      ? prefs.lastModel
      : options[0]?.value;

  const modelId = await p.select({
    message: 'Which model?',
    options,
    initialValue: defaultModel,
  });

  if (p.isCancel(modelId)) {
    p.cancel('Cancelled.');
    return null;
  }

  const selectedModel = filteredModels.find(m => m.id === String(modelId))!;

  // Show conflict warning if any
  if (conflicts.length > 0) {
    const lines = conflicts.map(c => `  ${pc.dim(c.name)}=${pc.dim(c.value)}`).join('\n');
    p.note(lines, pc.yellow('Env vars that will be temporarily overridden:'));
  }

  // Confirm launch
  const confirmed = await p.confirm({
    message: `Launch Claude Code · ${pc.bold(selectedModel.id)} via ${pc.bold(provider.name)}?`,
    initialValue: true,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel('Cancelled.');
    return null;
  }

  p.outro(pc.green('Launching...'));
  return selectedModel;
}

export async function runWizard(
  prefs: UserPreferences,
  modelsByBackend: { zen: ModelInfo[]; go: ModelInfo[] },
  conflicts: ConflictInfo[],
  tier: 'free' | 'zen' | 'go' | 'both',
): Promise<{ backend: BackendConfig; model: ModelInfo } | null> {
  // Backend selection — only shown for 'both' tier (user has two distinct backends to choose from).
  // free/zen → always Zen. go → mixed list (Zen free + Go paid), backend resolved per model.
  let selectorBackendId: 'zen' | 'go' | null = null;
  if (tier === 'both') {
    const backendId = await p.select<'zen' | 'go'>({
      message: 'Which backend?',
      options: [
        { value: 'zen' as const, label: 'OpenCode Zen', hint: '66+ models, free tier available' },
        { value: 'go' as const, label: 'OpenCode Go', hint: '17 models, subscription ($10/mo)' },
      ],
      initialValue: prefs.lastBackend ?? 'zen',
    });

    if (p.isCancel(backendId)) {
      p.cancel('Cancelled.');
      return null;
    }
    selectorBackendId = backendId;
  }

  // Determine which models to show based on tier
  // For 'go': Zen free models first (labeled "free · Zen"), then all Go paid models.
  // Backend for each model is its sourceBackend — resolved after the user picks.
  const showBackendBadge = tier === 'go';
  let models: ModelInfo[];
  if (tier === 'free') {
    models = modelsByBackend.zen.filter(m => m.isFree);
  } else if (tier === 'zen') {
    models = modelsByBackend.zen;
  } else if (tier === 'go') {
    const zenFree = modelsByBackend.zen.filter(m => m.isFree);
    models = [...zenFree, ...modelsByBackend.go];
  } else {
    // both: all models for the selected backend
    models = selectorBackendId === 'go' ? modelsByBackend.go : modelsByBackend.zen;
  }

  // Partition selectable vs unsupported (GPT/Gemini need formats we don't translate yet)
  const selectableModels: ModelInfo[] = [];
  const unsupportedModels: ModelInfo[] = [];
  for (const m of models) {
    (m.modelFormat === 'unsupported' ? unsupportedModels : selectableModels).push(m);
  }

  // Build model selector options
  const { free, byBrand } = groupModels(selectableModels);

  const options: Array<{ value: string; label: string; hint: string }> = [];

  for (const m of free) {
    options.push({ value: m.id, label: modelLabel(m, showBackendBadge), hint: modelHint(m) });
  }

  const brandOrder = ['Claude', 'GPT', 'Gemini', 'DeepSeek', 'Qwen', 'MiniMax', 'Kimi', 'GLM', 'MiMo', 'Grok', 'Nemotron', 'Other'];
  const sortedBrands = [...byBrand.keys()].sort(
    (a, b) => (brandOrder.indexOf(a) !== -1 ? brandOrder.indexOf(a) : 99) - (brandOrder.indexOf(b) !== -1 ? brandOrder.indexOf(b) : 99),
  );

  for (const brand of sortedBrands) {
    for (const m of byBrand.get(brand) ?? []) {
      options.push({ value: m.id, label: modelLabel(m), hint: modelHint(m) });
    }
  }

  if (options.length === 0) {
    p.cancel('No models available for this backend and subscription tier.');
    return null;
  }

  const defaultModel =
    prefs.lastModel && options.some(o => o.value === prefs.lastModel)
      ? prefs.lastModel
      : options[0]?.value;

  const modelId = await p.select({
    message: 'Which model?',
    options,
    initialValue: defaultModel,
  });

  if (p.isCancel(modelId)) {
    p.cancel('Cancelled.');
    return null;
  }

  // Show note about unsupported models if any were partitioned out
  if (unsupportedModels.length > 0) {
    const brandCounts = unsupportedModels.reduce<Record<string, number>>((acc, m) => {
      acc[m.brand] = (acc[m.brand] ?? 0) + 1;
      return acc;
    }, {});
    const summary = Object.entries(brandCounts).map(([b, c]) => `${b} (${c})`).join(', ');
    p.log.info(pc.dim(`Not yet supported: ${summary} — need API format translation`));
  }

  const selectedModel = selectableModels.find(m => m.id === String(modelId))!;
  // Backend is always determined by which model was picked (critical for 'go' tier
  // where Zen free models and Go paid models coexist in the same list).
  const backend = BACKENDS[selectedModel.sourceBackend];

  // Show conflict warning if any
  if (conflicts.length > 0) {
    const lines = conflicts.map(c => `  ${pc.dim(c.name)}=${pc.dim(c.value)}`).join('\n');
    p.note(lines, pc.yellow('Env vars that will be temporarily overridden:'));
  }

  // Confirm
  const confirmed = await p.confirm({
    message: `Launch Claude Code · ${pc.bold(String(modelId))} via ${pc.bold(backend.name)}?`,
    initialValue: true,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel('Cancelled.');
    return null;
  }

  p.outro(pc.green('Launching...'));

  return { backend, model: selectedModel };
}
