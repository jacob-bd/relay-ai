// Codex-only picker UX — no Claude Code strings.
import pc from 'picocolors';
import * as p from '@clack/prompts';
import type { LocalProvider, LocalProviderModel, UserPreferences } from '../types.js';
import { providerSelectOption } from '../ui.js';
import { launchModeOptions, pickLaunchMode, pickProviderModel, type LaunchMode } from '../prompts.js';

export type CodexLaunchMode = LaunchMode;

export function codexLaunchModeOptions(nativeName = 'Codex') {
  return launchModeOptions(nativeName);
}

export async function pickCodexLaunchMode(nativeName = 'Codex'): Promise<CodexLaunchMode | null> {
  return pickLaunchMode(nativeName);
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
  refresh?: () => Promise<void>,
): Promise<LocalProviderModel | 'back' | null> {
  return pickProviderModel(provider, prefs, { message: `Model for ${provider.name}?`, maxRecent: 3, refresh, allowAllModels: true });
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
