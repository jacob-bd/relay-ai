// src/gemini/prompts.ts
import pc from 'picocolors';
import * as p from '@clack/prompts';
import type { LocalProvider, LocalProviderModel, UserPreferences } from '../types.js';
import { providerSelectOption } from '../ui.js';
import { pickProviderModel } from '../prompts.js';

export async function pickGeminiProvider(
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
      : prefs.lastGeminiProvider && options.some(o => o.value === prefs.lastGeminiProvider)
      ? prefs.lastGeminiProvider
      : options[0]!.value;

  const chosen = await p.select<string>({
    message: 'Which provider for Gemini CLI?',
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

export async function pickGeminiModel(
  provider: LocalProvider,
  prefs: UserPreferences,
  refresh?: () => Promise<void>,
): Promise<LocalProviderModel | 'back' | null> {
  return pickProviderModel(provider, prefs, { message: `Model for ${provider.name}?`, maxRecent: 3, refresh });
}

export function rejectGeminiManagedFlags(geminiArgs: string[]): string[] {
  const blocked = new Set(['--provider', '--model', '-m', '--trace']);
  const takesValue = new Set(['--provider', '--model', '-m']);
  const out: string[] = [];
  for (let i = 0; i < geminiArgs.length; i++) {
    const arg = geminiArgs[i]!;
    if (blocked.has(arg)) {
      if (takesValue.has(arg)) i++;
      continue;
    }
    if (
      arg.startsWith('--model=')
      || arg.startsWith('--provider=')
      || arg.startsWith('-m=')
    ) continue;
    out.push(arg);
  }
  return out;
}
