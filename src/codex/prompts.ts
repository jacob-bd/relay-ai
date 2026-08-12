// Codex-only picker UX — no Claude Code strings.
import pc from 'picocolors';
import * as p from '@clack/prompts';
import type { LocalProvider, LocalProviderModel, UserPreferences } from '../types.js';
import type { CodexRoute } from './routing.js';
import {
  confirmLaunchMessage,
  modelSelectOption,
  navOption,
  providerSelectOption,
} from '../ui.js';
import { browseAllModels } from '../prompts.js';

export type CodexLaunchMode = 'mixed' | 'relay-only';

export function codexLaunchModeOptions(): Array<{
  value: CodexLaunchMode;
  label: string;
  hint: string;
}> {
  return [
    {
      value: 'relay-only',
      label: 'Relay models only',
      hint: 'Keep native Codex models hidden for this launch',
    },
    {
      value: 'mixed',
      label: 'Relay + native Codex models',
      hint: 'Expose native Codex models alongside your Relay catalog',
    },
  ];
}

export async function pickCodexLaunchMode(): Promise<CodexLaunchMode | null> {
  const choice = await p.select<CodexLaunchMode>({
    message: 'Load native Codex models alongside Relay models?',
    options: codexLaunchModeOptions(),
    initialValue: 'relay-only',
  });
  if (p.isCancel(choice)) {
    p.cancel('Cancelled.');
    return null;
  }
  return choice;
}

export async function pickCodexProvider(
  providers: LocalProvider[],
  prefs: UserPreferences,
  hasFavorites = false,
  initialProviderId?: string,
): Promise<LocalProvider | '__favorites__' | null> {
  if (providers.length === 0 && !hasFavorites) return null;

  const options: { value: string; label: string; hint?: string }[] = providers.map(lp => providerSelectOption(lp));
  
  if (hasFavorites) {
    options.unshift({
      value: '__favorites__',
      label: '⭐ Favorites Catalog',
      hint: `${prefs.favoriteModels?.length ?? 0} saved favorites`,
    });
  }

  const initial =
    initialProviderId && options.some(o => o.value === initialProviderId)
      ? initialProviderId
      : prefs.lastCodexProvider && options.some(o => o.value === prefs.lastCodexProvider)
      ? prefs.lastCodexProvider
      : options[0]!.value;

  const chosen = await p.select<string>({
    message: 'Which provider for Codex?',
    options,
    initialValue: initial,
  });
  if (p.isCancel(chosen)) {
    p.cancel('Cancelled.');
    return null;
  }

  if (chosen === '__favorites__') return '__favorites__';

  return providers.find(lp => lp.id === chosen) ?? null;
}

export async function pickCodexModel(
  provider: LocalProvider,
  prefs: UserPreferences,
): Promise<LocalProviderModel | 'back' | null> {
  const recentIds = (prefs.recentModelsByProvider?.[provider.id] ?? []).slice(0, 3);
  const recentModels = recentIds
    .map(id => provider.models.find(m => m.id === id))
    .filter((m): m is LocalProviderModel => m !== undefined);

  let selectedModel: LocalProviderModel | null = null;

  while (true) {
    if (recentModels.length > 0) {
      const options = [
        ...recentModels.map(m => modelSelectOption(m, 'recent')),
        navOption('__browse_all__', 'Browse all models →', `${provider.models.length} available`),
        navOption('__back__', '← Go back', 'Select a different provider'),
      ];

      const picked = await p.select({
        message: `Model for ${provider.name}?`,
        options,
        initialValue: recentModels[0].id,
      });

      if (p.isCancel(picked) || String(picked) === '__back__') {
        return 'back';
      }

      if (String(picked) === '__browse_all__') {
        const browsed = await browseAllModels(provider, prefs);
        if (browsed === 'back') {
          continue;
        }
        if (!browsed) return null;
        selectedModel = browsed;
        break;
      } else {
        selectedModel = recentModels.find(m => m.id === String(picked))!;
        break;
      }
    } else {
      const browsed = await browseAllModels(provider, prefs);
      if (browsed === 'back') {
        return 'back';
      }
      if (!browsed) return null;
      selectedModel = browsed;
      break;
    }
  }

  return selectedModel;
}

export function confirmCodexLaunch(
  providerName: string,
  modelLabel: string,
  modelId: string,
  route: CodexRoute,
): Promise<boolean> {
  const via = route.tier === 'direct'
    ? pc.green('direct')
    : `${pc.dim('via')} ${pc.yellow('relay-ai proxy')}`;
  return p.confirm({
    message: `${confirmLaunchMessage('Codex', modelLabel, modelId, providerName)} ${pc.dim('(')}${via}${pc.dim(')')}`,
    initialValue: true,
  }).then(answer => {
    if (p.isCancel(answer)) {
      p.cancel('Cancelled.');
      return false;
    }
    return answer;
  });
}

export function rejectManagedFlags(codexArgs: string[]): string[] {
  const blocked = new Set(['--profile', '-m', '--model', '--provider', '--trace', '-p']);
  const takesValue = new Set(['--profile', '-m', '--model', '--provider', '-p']);
  const out: string[] = [];
  for (let i = 0; i < codexArgs.length; i++) {
    const arg = codexArgs[i]!;
    if (blocked.has(arg)) {
      if (takesValue.has(arg)) i++;
      continue;
    }
    if (
      arg.startsWith('--profile=')
      || arg.startsWith('--model=')
      || arg.startsWith('--provider=')
      || arg.startsWith('-m=')
    ) continue;
    out.push(arg);
  }
  return out;
}
