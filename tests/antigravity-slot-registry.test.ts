import { describe, expect, it } from 'vitest';
import {
  evaluateAgySwitchCompatibility,
  getValidatedAgySwitchSlots,
  isReservedAgyHelperSlot,
  validateAgySlotRegistry,
} from '../src/antigravity/slot-registry.js';
import type { CatalogFixture } from '../src/antigravity/types.js';
import catalogFixtureRaw from '../src/antigravity/fixtures/fetchAvailableModels.json' with { type: 'json' };

function cloneFixture(): CatalogFixture {
  return structuredClone(catalogFixtureRaw) as CatalogFixture;
}

describe('antigravity slot registry', () => {
  it('exposes the seven validated AGY switch slots in deterministic order', () => {
    const slots = getValidatedAgySwitchSlots(cloneFixture());

    expect(slots.map(slot => slot.slotId)).toEqual([
      'gemini-3.5-flash-low',
      'gemini-3.5-flash-extra-low',
      'gemini-3.1-pro-low',
      'gemini-pro-agent',
      'claude-sonnet-4-6',
      'claude-opus-4-6-thinking',
      'gpt-oss-120b-medium',
    ]);
    expect(slots.map(slot => slot.model)).toEqual([
      'MODEL_PLACEHOLDER_M20',
      'MODEL_PLACEHOLDER_M187',
      'MODEL_PLACEHOLDER_M36',
      'MODEL_PLACEHOLDER_M16',
      'MODEL_PLACEHOLDER_M35',
      'MODEL_PLACEHOLDER_M26',
      'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
    ]);
  });

  it('keeps cascade helper slots out of the switch catalog', () => {
    const validation = validateAgySlotRegistry(cloneFixture());
    const switchIds = validation.switchSlots.map(slot => slot.slotId);
    const reservedIds = validation.reservedSlots.map(slot => slot.slotId);

    expect(reservedIds).toEqual(expect.arrayContaining([
      'gemini-3-flash-agent',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ]));
    expect(isReservedAgyHelperSlot('gemini-3-flash-agent')).toBe(true);
    expect(isReservedAgyHelperSlot('gemini-2.5-flash')).toBe(true);
    expect(isReservedAgyHelperSlot('gemini-2.5-flash-lite')).toBe(true);
    expect(switchIds).not.toContain('gemini-3-flash-agent');
    expect(switchIds).not.toContain('gemini-2.5-flash');
    expect(switchIds).not.toContain('gemini-2.5-flash-lite');
  });

  it('does not treat tab, chat, image, or command-only fixture entries as validated switch slots', () => {
    const switchIds = getValidatedAgySwitchSlots(cloneFixture()).map(slot => slot.slotId);

    expect(switchIds).not.toContain('tab_jump_flash_lite_preview');
    expect(switchIds).not.toContain('tab_flash_lite_preview');
    expect(switchIds).not.toContain('chat_20706');
    expect(switchIds).not.toContain('chat_23310');
    expect(switchIds).not.toContain('gemini-3.1-flash-image');
    expect(switchIds).not.toContain('gemini-3-flash');
  });

  it('reports candidate fixture entries without promoting them to validated switching', () => {
    const validation = validateAgySlotRegistry(cloneFixture());
    const candidateIds = validation.candidateSlots.map(slot => slot.slotId);
    const switchIds = validation.switchSlots.map(slot => slot.slotId);

    expect(candidateIds).toEqual(expect.arrayContaining([
      'gemini-3.1-pro-high',
      'gemini-2.5-pro',
      'gemini-2.5-flash-thinking',
      'gemini-3-flash',
      'gemini-3.1-flash-lite',
      'gemini-3.1-flash-image',
    ]));
    for (const candidateId of candidateIds) {
      expect(switchIds).not.toContain(candidateId);
    }
  });

  it('throws when validated switch slot enum values collide after fixture drift', () => {
    const fixture = cloneFixture();
    fixture.models['gemini-3.5-flash-extra-low']!.model = 'MODEL_PLACEHOLDER_M20';

    expect(() => validateAgySlotRegistry(fixture)).toThrow(/duplicate AGY switch slot enum/i);
  });

  it('reports missing required slots and enum mismatches as fixture-shape warnings', () => {
    const fixture = cloneFixture();
    delete fixture.models['claude-sonnet-4-6'];
    fixture.models['gemini-pro-agent']!.model = 'MODEL_PLACEHOLDER_CHANGED';

    const validation = validateAgySlotRegistry(fixture);

    expect(validation.switchSlots.map(slot => slot.slotId)).not.toContain('claude-sonnet-4-6');
    expect(validation.switchSlots.map(slot => slot.slotId)).not.toContain('gemini-pro-agent');
    expect(validation.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/claude-sonnet-4-6.*missing/i),
      expect.stringMatching(/gemini-pro-agent.*expected MODEL_PLACEHOLDER_M16.*MODEL_PLACEHOLDER_CHANGED/i),
    ]));
  });

  it('enables multi-model mode for a known compatible version with matching fixture shape', () => {
    const compatibility = evaluateAgySwitchCompatibility({
      version: '1.0.10',
      fixture: cloneFixture(),
    });

    expect(compatibility).toMatchObject({
      mode: 'multi-model',
      validatedSwitchSlotCount: 7,
      warnings: [],
    });
  });

  it('continues with a warning when version reading fails but fixture shape matches', () => {
    const compatibility = evaluateAgySwitchCompatibility({
      version: null,
      versionReadError: 'agy --version failed',
      fixture: cloneFixture(),
    });

    expect(compatibility.mode).toBe('multi-model');
    expect(compatibility.validatedSwitchSlotCount).toBe(7);
    expect(compatibility.warnings).toEqual([
      expect.stringMatching(/could not read agy --version/i),
    ]);
  });

  it('continues with a warning for unknown versions when fixture shape matches', () => {
    const compatibility = evaluateAgySwitchCompatibility({
      version: '1.0.99',
      fixture: cloneFixture(),
    });

    expect(compatibility.mode).toBe('multi-model');
    expect(compatibility.warnings).toEqual([
      expect.stringMatching(/unvalidated AGY version 1.0.99/i),
    ]);
  });

  it('falls back to single-model mode when unknown version and fixture shape mismatch', () => {
    const fixture = cloneFixture();
    fixture.models['gemini-3.5-flash-low']!.model = 'MODEL_PLACEHOLDER_CHANGED';

    const compatibility = evaluateAgySwitchCompatibility({
      version: '1.0.99',
      fixture,
    });

    expect(compatibility.mode).toBe('single-model');
    expect(compatibility.validatedSwitchSlotCount).toBe(6);
    expect(compatibility.warnings.join('\n')).toMatch(/falling back to single-model/i);
  });

  it('falls back to single-model mode for known incompatible versions even when fixture shape matches', () => {
    const compatibility = evaluateAgySwitchCompatibility({
      version: '1.0.9',
      fixture: cloneFixture(),
    });

    expect(compatibility.mode).toBe('single-model');
    expect(compatibility.warnings.join('\n')).toMatch(/known-incompatible AGY version 1.0.9/i);
  });
});
