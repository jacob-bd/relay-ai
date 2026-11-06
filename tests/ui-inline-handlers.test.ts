import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// app.js is loaded as an ES module, so inline on*="fn()" attributes only work
// for functions assigned to window. A missing export fails silently in the browser.
describe('web UI inline handlers', () => {
  const src = readFileSync(new URL('../src/ui/public/app.js', import.meta.url), 'utf8');

  it('exports setCodexNativeMode for the Native + Relay checkbox', () => {
    expect(src).toContain('window.setCodexNativeMode = setCodexNativeMode;');
  });

  it('exports every function called from an inline on* attribute', () => {
    const called = new Set<string>();
    for (const m of src.matchAll(/\bon(?:click|change|input)="([A-Za-z_$][\w$]*)\(/g)) called.add(m[1]!);
    const missing = [...called].filter(fn => !new RegExp(`window\\.${fn}\\s*=`).test(src));
    expect(missing).toEqual([]);
  });
});
