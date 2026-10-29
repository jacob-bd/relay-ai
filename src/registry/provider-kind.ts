// src/registry/provider-kind.ts — which kind of provider an id belongs to
//
// A second account of a provider gets the id `<kind>-2`, `<kind>-3`, … Anything
// that behaves differently per provider (OAuth refresh, billing headers, models.dev
// metadata, …) must key on the kind, never on the raw id, or a numbered account
// silently loses that behaviour.

import { PROVIDER_TEMPLATES } from '../provider-templates.js';

/** Registry ids that exist without a template of the same id. */
const KIND_IDS_WITHOUT_TEMPLATE = ['openai-oauth', 'xai-oauth', 'zen', 'go'];

let knownKinds: ReadonlySet<string> | undefined;

function kinds(): ReadonlySet<string> {
  knownKinds ??= new Set([...PROVIDER_TEMPLATES.map(t => t.id), ...KIND_IDS_WITHOUT_TEMPLATE]);
  return knownKinds;
}

/** `groq-2` → `groq`; ids that are not numbered instances of a known provider are returned unchanged. */
export function providerKind(providerId: string): string {
  const match = /^(.+)-(\d+)$/.exec(providerId);
  if (!match || kinds().has(providerId)) return providerId;
  const base = match[1]!;
  return Number(match[2]) >= 2 && kinds().has(base) ? base : providerId;
}

export function isProviderKind(providerId: string, kind: string): boolean {
  return providerKind(providerId) === kind;
}

/** The first unused `<base>-N` (N ≥ 2). */
export function nextInstanceId(base: string, takenIds: Iterable<string>): string {
  const taken = new Set(takenIds);
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
