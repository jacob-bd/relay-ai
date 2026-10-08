import { describe, it, expect } from 'vitest';
import { scanReasoningCoverage } from '../src/reasoning-coverage.js';
import { loadBundledModelsDevCache } from '../src/registry/models-dev.js';

// The anti-whack-a-mole check: every model a supported provider serves that
// declares effort levels in models.dev must surface those levels through the
// capability pipeline. A new model shipping with declarations fails this test
// until its family profile handles it — instead of surfacing as a missing
// slider in the field. Providers the pipeline cannot yet wire are listed as
// explicit, reasoned exclusions below; removing one is how progress is proven.

/** Declared values a provider's wire deliberately cannot express. */
const DECLARED_DROPS: Record<string, string[]> = {
  // xAI has no `none` wire value (live-verified; the adapter rejects it).
  xai: ['none'],
  'xai-oauth': ['none'],
  // The hand-written OpenAI table (developers.openai.com, verified date in
  // provider-factory) overrides models.dev where they disagree; gpt-5.3-codex
  // deliberately omits `none`.
  openai: ['none'],
  'openai-oauth': ['none'],
};

interface ProviderExclusion {
  provider: string;
  reason: string;
}

/**
 * Providers whose npm has no verified effort mapping yet. Their declaring
 * models are reported (they appear in the scan) but not asserted; each entry
 * is a to-do with its blocker named.
 */
const EXCLUDED_PROVIDERS: ProviderExclusion[] = [
  {
    provider: 'deepinfra',
    reason: '@ai-sdk/deepinfra types no effort provider option — needs live wire verification',
  },
  {
    provider: 'alibaba',
    reason: '@ai-sdk/alibaba exposes enableThinking/thinkingBudget, not effort levels — mapping effort onto a budget would be invented',
  },
  {
    provider: 'qwen-cloud-payg',
    reason: '@ai-sdk/alibaba exposes enableThinking/thinkingBudget, not effort levels — mapping effort onto a budget would be invented',
  },
  {
    provider: 'qwen-cloud-token-plan',
    reason: '@ai-sdk/alibaba exposes enableThinking/thinkingBudget, not effort levels — mapping effort onto a budget would be invented',
  },
  {
    provider: 'cohere',
    reason: '@ai-sdk/cohere exposes a thinking toggle, not effort levels',
  },
];

interface ModelExclusion {
  provider: string;
  match: RegExp;
  reason: string;
}

const EXCLUDED_MODELS: ModelExclusion[] = [
  {
    provider: 'openai',
    match: /chat-latest$/,
    reason: 'documented non-reasoning chat model; models.dev over-declares',
  },
  {
    provider: 'openai-oauth',
    match: /chat-latest$/,
    reason: 'documented non-reasoning chat model; models.dev over-declares',
  },
  {
    provider: 'mistral',
    match: /^(?:zai-)?glm-/,
    reason: "GLM hosted on Mistral declares low..max while Mistral's own wire is none/high — needs live verification",
  },
  {
    provider: 'mistral',
    match: /^labs-leanstral-1-5-1$/,
    reason: 'New Labs Leanstral declares none/high but has no verified model-specific Mistral effort mapping yet',
  },
  {
    provider: 'kilo',
    match: /glm-5\.2/,
    reason: 'GLM-5.2 mapping documents high/xhigh only — the declared none has no verified wire value',
  },
];

function isExcluded(providerId: string, modelId: string): boolean {
  return EXCLUDED_PROVIDERS.some(e => e.provider === providerId)
    || EXCLUDED_MODELS.some(e => e.provider === providerId && e.match.test(modelId));
}

/**
 * `max` and `xhigh` are the same wire value under different labels (Relay
 * advertises the rung as `xhigh` where the app drops `max`), so either label
 * satisfies a declared value of the other.
 */
function isOffered(levels: string[], value: string): boolean {
  if (levels.includes(value)) return true;
  if (value === 'max') return levels.includes('xhigh');
  if (value === 'xhigh') return levels.includes('max');
  return false;
}

function expectedLevels(providerId: string, declared: string[]): string[] {
  const drops = new Set(DECLARED_DROPS[providerId] ?? []);
  return declared.filter(v => !drops.has(v));
}

describe('reasoning coverage', () => {
  const rows = scanReasoningCoverage(loadBundledModelsDevCache());

  it('scans the supported providers that declare effort', () => {
    expect(rows.length).toBeGreaterThan(100);
    expect(new Set(rows.map(r => r.providerId))).toContain('anthropic');
    expect(new Set(rows.map(r => r.providerId))).toContain('go');
  });

  it('advertises every declared level on providers the pipeline wires', () => {
    const failures: string[] = [];
    for (const row of rows) {
      if (isExcluded(row.providerId, row.modelId)) continue;
      const expected = expectedLevels(row.providerId, row.declared);
      const missing = expected.filter(level => !isOffered(row.levels, level));
      if (missing.length > 0) {
        failures.push(
          `${row.providerId}/${row.modelId} (${row.npm}): missing [${missing.join(', ')}] — declared [${row.declared.join(', ')}], offered [${row.levels.join(', ')}]`,
        );
      }
      if (row.mode !== 'controllable') {
        failures.push(`${row.providerId}/${row.modelId}: declares effort but mode=${row.mode}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('keeps every exclusion live and justified', () => {
    // A stale exclusion (provider fixed, or typo in a name) must fail loudly so
    // the list stays an accurate to-do, not a graveyard.
    for (const exclusion of EXCLUDED_PROVIDERS) {
      const matching = rows.filter(r => r.providerId === exclusion.provider);
      expect(matching.length, `excluded provider "${exclusion.provider}" matches no declaring model`).toBeGreaterThan(0);
      expect(exclusion.reason.length).toBeGreaterThan(10);
      const wouldFail = matching.some(row => {
        const expected = expectedLevels(row.providerId, row.declared);
        return expected.some(level => !row.levels.includes(level));
      });
      expect(wouldFail, `excluded provider "${exclusion.provider}" now passes — drop the exclusion`).toBe(true);
    }
    for (const exclusion of EXCLUDED_MODELS) {
      const matching = rows.filter(r => r.providerId === exclusion.provider && exclusion.match.test(r.modelId));
      expect(matching.length, `excluded model "${exclusion.provider} ${exclusion.match}" matches nothing`).toBeGreaterThan(0);
      expect(exclusion.reason.length).toBeGreaterThan(10);
    }
  });

  it('keeps declared-drop entries live', () => {
    for (const [providerId, drops] of Object.entries(DECLARED_DROPS)) {
      const providerRows = rows.filter(r => r.providerId === providerId);
      for (const drop of drops) {
        expect(
          providerRows.some(r => r.declared.includes(drop)),
          `drop "${drop}" for ${providerId} matches no declaring model — remove it`,
        ).toBe(true);
      }
    }
  });
});
