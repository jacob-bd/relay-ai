import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../src/ui/public/index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../src/ui/public/app.js', import.meta.url), 'utf8');

describe('Codex SubAgent UI contract', () => {
  it('has a dedicated navigation section and empty-state controls', () => {
    for (const id of [
      'nav-codex-subagents',
      'section-codex-subagents',
      'codex-subagent-search',
      'codex-subagent-free-only',
      'codex-subagent-results',
      'codex-subagent-list',
      'codex-subagent-slot-count',
    ]) expect(html, id).toContain(`id="${id}"`);
  });

  it('explains that the catalog starts empty and is independent', () => {
    expect(html).toContain('starts empty');
    expect(html).toContain('General Favorites');
    expect(html).toContain('does not sync');
    expect(html).toContain('one Relay model');
    expect(html).toContain('agy-slot-max">/1');
  });

  it('has a separate state and persistence path', () => {
    expect(js).toContain('codexSubagentModels');
    expect(js).toContain('codex-subagents');
    expect(js).toContain('codexSubagentModels: state.codexSubagentModels');
    expect(js).toContain('body.withNative = true');
    expect(js).toContain('setCodexNativeMode');
  });

  it('offers Codex SubAgent from provider model actions', () => {
    expect(js).toContain('Add to Codex SubAgent');
  });

  it('limits the Codex SubAgent selector to one slot', () => {
    expect(js).toContain('const CODEX_SUBAGENT_MAX = 1');
  });
});
