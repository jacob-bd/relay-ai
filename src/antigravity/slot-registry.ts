import type { CatalogFixture } from './types.js';

export type AgySlotStatus = 'validated' | 'reserved' | 'candidate' | 'unsafe';

export type AgySlotRole =
  | 'agent-switch'
  | 'cascade-plan'
  | 'cascade-intent'
  | 'cascade-fallback'
  | 'cascade-checkpoint'
  | 'command'
  | 'tab'
  | 'chat'
  | 'image'
  | 'unknown';

export interface AgySlotDefinition {
  slotId: string;
  model: string;
  role: AgySlotRole;
  status: AgySlotStatus;
  validatedWith: string;
  notes?: string;
}

export interface AgySlotValidationResult {
  switchSlots: AgySlotDefinition[];
  reservedSlots: AgySlotDefinition[];
  candidateSlots: AgySlotDefinition[];
  warnings: string[];
}

export interface AgySwitchCompatibility {
  mode: 'multi-model' | 'single-model';
  validatedSwitchSlotCount: number;
  warnings: string[];
}

export const AGY_SLOT_VALIDATION_SOURCE =
  'AGY CLI 1.0.10 / Antigravity IDE 2.1.1 fixture capture 2026-06-23';

const AGY_NATIVE_SLOT_REGISTRY: AgySlotDefinition[] = [
  {
    slotId: 'gemini-3.5-flash-low',
    model: 'MODEL_PLACEHOLDER_M20',
    role: 'agent-switch',
    status: 'validated',
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
  },
  {
    slotId: 'gemini-3.5-flash-extra-low',
    model: 'MODEL_PLACEHOLDER_M187',
    role: 'agent-switch',
    status: 'validated',
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
  },
  {
    slotId: 'gemini-3.1-pro-low',
    model: 'MODEL_PLACEHOLDER_M36',
    role: 'agent-switch',
    status: 'validated',
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
  },
  {
    slotId: 'gemini-pro-agent',
    model: 'MODEL_PLACEHOLDER_M16',
    role: 'agent-switch',
    status: 'validated',
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
  },
  {
    slotId: 'claude-sonnet-4-6',
    model: 'MODEL_PLACEHOLDER_M35',
    role: 'agent-switch',
    status: 'validated',
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
  },
  {
    slotId: 'claude-opus-4-6-thinking',
    model: 'MODEL_PLACEHOLDER_M26',
    role: 'agent-switch',
    status: 'validated',
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
  },
  {
    slotId: 'gpt-oss-120b-medium',
    model: 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
    role: 'agent-switch',
    status: 'validated',
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
  },
  {
    slotId: 'gemini-3-flash-agent',
    model: 'MODEL_PLACEHOLDER_M132',
    role: 'cascade-plan',
    status: 'reserved',
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
    notes: 'Visible in agentModelSorts, but reserved for cascade plan construction.',
  },
  {
    slotId: 'gemini-2.5-flash',
    model: 'MODEL_GOOGLE_GEMINI_2_5_FLASH',
    role: 'cascade-intent',
    status: 'reserved',
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
  },
  {
    slotId: 'gemini-2.5-flash-lite',
    model: 'MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE',
    role: 'cascade-fallback',
    status: 'reserved',
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
  },
  {
    slotId: 'gemini-3.1-pro-high',
    model: 'MODEL_PLACEHOLDER_M37',
    role: 'agent-switch',
    status: 'candidate',
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
    notes: 'Model-shaped fixture entry; requires live switching proof before promotion.',
  },
  {
    slotId: 'gemini-2.5-pro',
    model: 'MODEL_GOOGLE_GEMINI_2_5_PRO',
    role: 'agent-switch',
    status: 'candidate',
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
    notes: 'Model-shaped fixture entry; requires live switching proof before promotion.',
  },
  {
    slotId: 'gemini-2.5-flash-thinking',
    model: 'MODEL_GOOGLE_GEMINI_2_5_FLASH_THINKING',
    role: 'agent-switch',
    status: 'candidate',
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
    notes: 'Model-shaped fixture entry; requires live switching proof before promotion.',
  },
  {
    slotId: 'gemini-3-flash',
    model: 'MODEL_PLACEHOLDER_M18',
    role: 'command',
    status: 'candidate',
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
    notes: 'Command model in the fixture; not switch-safe without live proof.',
  },
  {
    slotId: 'gemini-3.1-flash-lite',
    model: 'MODEL_PLACEHOLDER_M50',
    role: 'cascade-checkpoint',
    status: 'candidate',
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
    notes: 'Checkpoint/search/commit slot; route as helper until live proof exists.',
  },
  {
    slotId: 'gemini-3.1-flash-image',
    model: 'MODEL_PLACEHOLDER_M21',
    role: 'image',
    status: 'candidate',
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
    notes: 'Image generation slot; not switch-safe without live proof.',
  },
  {
    slotId: 'tab_jump_flash_lite_preview',
    model: 'MODEL_PLACEHOLDER_M28',
    role: 'tab',
    status: 'unsafe',
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
  },
  {
    slotId: 'tab_flash_lite_preview',
    model: 'MODEL_PLACEHOLDER_M19',
    role: 'tab',
    status: 'unsafe',
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
  },
  {
    slotId: 'chat_20706',
    model: 'MODEL_CHAT_20706',
    role: 'chat',
    status: 'unsafe',
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
  },
  {
    slotId: 'chat_23310',
    model: 'MODEL_CHAT_23310',
    role: 'chat',
    status: 'unsafe',
    validatedWith: AGY_SLOT_VALIDATION_SOURCE,
  },
];

const KNOWN_COMPATIBLE_AGY_VERSIONS = new Set(['1.0.10']);
const KNOWN_INCOMPATIBLE_AGY_VERSIONS = new Set(['1.0.9']);

function withFixtureModel(definition: AgySlotDefinition, model: string): AgySlotDefinition {
  return model === definition.model ? definition : { ...definition, model };
}

function assertNoDuplicateSwitchEnums(
  fixture: CatalogFixture,
  definitions: AgySlotDefinition[],
): void {
  const seen = new Map<string, string>();
  for (const definition of definitions) {
    if (definition.status !== 'validated') continue;
    const actualModel = fixture.models[definition.slotId]?.model;
    if (!actualModel) continue;

    const previousSlotId = seen.get(actualModel);
    if (previousSlotId) {
      throw new Error(
        `Duplicate AGY switch slot enum ${actualModel}: ${previousSlotId} and ${definition.slotId}`,
      );
    }
    seen.set(actualModel, definition.slotId);
  }
}

export function validateAgySlotRegistry(fixture: CatalogFixture): AgySlotValidationResult {
  assertNoDuplicateSwitchEnums(fixture, AGY_NATIVE_SLOT_REGISTRY);

  const switchSlots: AgySlotDefinition[] = [];
  const reservedSlots: AgySlotDefinition[] = [];
  const candidateSlots: AgySlotDefinition[] = [];
  const warnings: string[] = [];

  for (const definition of AGY_NATIVE_SLOT_REGISTRY) {
    const entry = fixture.models[definition.slotId];
    if (!entry) {
      if (definition.status === 'validated' || definition.status === 'reserved') {
        warnings.push(`AGY slot ${definition.slotId} missing from fixture`);
      }
      continue;
    }

    if (entry.model !== definition.model) {
      warnings.push(
        `AGY slot ${definition.slotId} expected ${definition.model} but fixture has ${entry.model}`,
      );
      continue;
    }

    if (definition.status === 'validated') {
      switchSlots.push(withFixtureModel(definition, entry.model));
    } else if (definition.status === 'reserved') {
      reservedSlots.push(withFixtureModel(definition, entry.model));
    } else if (definition.status === 'candidate') {
      candidateSlots.push(withFixtureModel(definition, entry.model));
    }
  }

  return { switchSlots, reservedSlots, candidateSlots, warnings };
}

export function getValidatedAgySwitchSlots(fixture: CatalogFixture): AgySlotDefinition[] {
  return validateAgySlotRegistry(fixture).switchSlots;
}

export function isReservedAgyHelperSlot(slotId: string): boolean {
  return AGY_NATIVE_SLOT_REGISTRY.some(
    definition => definition.slotId === slotId && definition.status === 'reserved',
  );
}

export function evaluateAgySwitchCompatibility(opts: {
  version?: string | null;
  versionReadError?: string;
  fixture: CatalogFixture;
}): AgySwitchCompatibility {
  const validation = validateAgySlotRegistry(opts.fixture);
  const shapeMatches = validation.warnings.length === 0 && validation.switchSlots.length > 0;
  const warnings: string[] = [];

  if (opts.versionReadError) {
    warnings.push(`Could not read agy --version (${opts.versionReadError}); validating AGY fixture shape instead.`);
  }

  if (opts.version && KNOWN_INCOMPATIBLE_AGY_VERSIONS.has(opts.version)) {
    return {
      mode: 'single-model',
      validatedSwitchSlotCount: validation.switchSlots.length,
      warnings: [
        ...warnings,
        `Known-incompatible AGY version ${opts.version}; falling back to single-model mode.`,
      ],
    };
  }

  if (!shapeMatches) {
    return {
      mode: 'single-model',
      validatedSwitchSlotCount: validation.switchSlots.length,
      warnings: [
        ...warnings,
        ...validation.warnings,
        'AGY fixture shape does not match the validated slot registry; falling back to single-model mode.',
      ],
    };
  }

  if (opts.version && !KNOWN_COMPATIBLE_AGY_VERSIONS.has(opts.version)) {
    warnings.push(`Unvalidated AGY version ${opts.version}; fixture shape matches, so multi-model switching remains enabled.`);
  } else if (!opts.version && !opts.versionReadError) {
    warnings.push('AGY version is unknown; fixture shape matches, so multi-model switching remains enabled.');
  }

  return {
    mode: 'multi-model',
    validatedSwitchSlotCount: validation.switchSlots.length,
    warnings,
  };
}
