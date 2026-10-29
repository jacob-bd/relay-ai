import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PROVIDER_TEMPLATES } from '../src/provider-templates.js';

/**
 * Guard for multi-account support. A second account of a provider has the id
 * `<kind>-2`, so code that asks "is this provider id exactly X?" silently stops
 * working for it. Behaviour that depends on the provider must compare the KIND
 * (`providerKind(id)` / `isProviderKind(id, 'x')` from registry/provider-kind.ts).
 *
 * This test fails on any exact-id comparison against a known provider id that is
 * not listed below, and on listed entries that no longer exist — so the list
 * cannot rot. Add an entry only when the exact id is genuinely what you mean.
 */

const SRC = join(__dirname, '..', 'src');

/** `<file>::<comparison text>` → why an exact id is correct there. */
const ALLOWED: Record<string, string> = {
  // The single seeded OpenCode Zen/Go entry — existence checks, not behaviour.
  'first-run.ts::pr.id === \'zen\'': 'is the Zen entry seeded',
  'registry/crud.ts::p.id === \'zen\'': 'is the Zen entry seeded',
  'registry/crud.ts::p.id === \'go\'': 'is the Go entry seeded',
  'registry/refresh-models.ts::p.id === \'zen\'': 'is the Zen entry seeded',
  'registry/refresh-models.ts::p.id === \'go\'': 'is the Go entry seeded',

  // Lookup inside the template list itself (`t` is a template, not a provider account).
  'provider-templates.ts::t.id === \'opencode-cloud\'': 'template list lookup',

  // OpenCode / legacy registry ids being migrated or imported — they are exact by nature.
  'registry/import-build.ts::id === \'openai\'': 'OpenCode id → registry slot',
  'registry/import-build.ts::id === \'xai\'': 'OpenCode id → registry slot',
  'registry/migrate.ts::p.id === \'openai-oauth\'': 'legacy migration',
  'registry/migrate.ts::p.id === \'openai\'': 'legacy migration',
  'registry/migrate.ts::p.id === \'xai-oauth\'': 'legacy migration',
  'registry/migrate.ts::p.id === \'xai\'': 'legacy migration',
  'registry/migrate.ts::p.id === \'alibaba\'': 'legacy stock-label migration',

  // Sign-in code that already receives the KIND being signed in (not an account id).
  'registry/provider-auth.ts::providerId === \'xai\'': 'kind parameter',
  'registry/provider-auth.ts::providerId === \'xai-oauth\'': 'kind parameter',
  'registry/provider-auth.ts::providerId === \'github-copilot\'': 'kind parameter',
  'registry/provider-auth.ts::providerId === \'cline-pass\'': 'kind parameter',
  'registry/provider-auth.ts::providerId !== \'claude-code\'': 'kind parameter',
  'registry/provider-auth.ts::providerId !== \'antigravity\'': 'kind parameter',
  'registry/provider-auth.ts::providerId === \'claude-code\'': 'kind parameter',
  'ui.ts::providerId === \'antigravity\'': 'kind parameter',

  // Sign-in plumbing that still names exact single-account ids — rebuilt when multiple
  // OAuth accounts are added (step 4 of the multi-account work).
  'registry/provider-auth.ts::registryId === \'openai-oauth\'': 'TODO step 4: sign-in naming',
  'registry/provider-auth.ts::registryId === \'xai-oauth\'': 'TODO step 4: sign-in naming',
  'ui/api.ts::providerId === \'xai-oauth\'': 'TODO step 4: UI sign-in',
  'ui/api.ts::providerId === \'github-copilot\'': 'TODO step 4: UI sign-in',
  'ui/api.ts::providerId === \'cline-pass\'': 'TODO step 4: UI sign-in',
  'ui/api.ts::providerId === \'claude-code\'': 'TODO step 4: UI sign-in',
  'ui/api.ts::providerId === \'antigravity\'': 'TODO step 4: UI sign-in',

  // Zen/Go credential location and listing — rebuilt with multi-account Zen/Go (step 6).
  'env.ts::providerId === \'go\'': 'TODO step 6: shared OpenCode key',
  'env.ts::providerId === \'zen\'': 'TODO step 6: shared OpenCode key',
  'provider-catalog.ts::provider.id === \'zen\'': 'TODO step 6: shared OpenCode key',
  'provider-catalog.ts::provider.id === \'go\'': 'TODO step 6: shared OpenCode key',
  'providers-command.ts::provider.id === \'zen\'': 'TODO step 6: Zen/Go listing',
  'providers-command.ts::provider.id === \'go\'': 'TODO step 6: Zen/Go listing',
  'ui/api.ts::providerId === \'go\'': 'TODO step 6: shared OpenCode key',
  'ui/api.ts::providerId === \'zen\'': 'TODO step 6: shared OpenCode key',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'public' ? [] : sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

function findExactIdComparisons(): string[] {
  const ids = new Set([...PROVIDER_TEMPLATES.map(t => t.id), 'openai-oauth', 'xai-oauth', 'zen', 'go']);
  const alternation = [...ids].map(id => id.replace(/-/g, '\\-')).join('|');
  const operand = '([A-Za-z_][\\w.?]*(?:[iI]d)|id)';
  const patterns = [
    new RegExp(`${operand}\\s*(?:===|!==|==|!=)\\s*'(?:${alternation})'`, 'g'),
    new RegExp(`'(?:${alternation})'\\s*(?:===|!==|==|!=)\\s*${operand}`, 'g'),
  ];

  const found = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file);
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        for (let m = pattern.exec(line); m; m = pattern.exec(line)) {
          // A template id is already a kind — comparing it exactly is correct.
          if (/template/i.test(m[1] ?? '')) continue;
          found.add(`${rel}::${m[0]}`);
        }
      }
    }
  }
  return [...found].sort();
}

describe('exact provider-id comparisons', () => {
  const found = findExactIdComparisons();

  it('every exact comparison is deliberate (otherwise compare the kind)', () => {
    const unexpected = found.filter(entry => !(entry in ALLOWED));
    expect(
      unexpected,
      'Compare providerKind(id) / isProviderKind(id, kind) instead, or add a reasoned entry to ALLOWED.',
    ).toEqual([]);
  });

  it('the allow-list has no stale entries', () => {
    const stale = Object.keys(ALLOWED).filter(entry => !found.includes(entry));
    expect(stale).toEqual([]);
  });
});
