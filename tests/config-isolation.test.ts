import { describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getAppHome, getConfigPath, getProvidersPath } from '../src/paths.js';

// Guards the setup in tests/setup-env.ts. If this fails, `npm test` is reading and
// writing the developer's real preferences and provider registry.
describe('test environment isolation', () => {
  const realHome = join(homedir(), '.relay-ai');

  it('does not resolve the real user app home', () => {
    expect(getAppHome()).not.toBe(realHome);
  });

  it('does not resolve real user config or registry paths', () => {
    expect(getConfigPath().startsWith(realHome)).toBe(false);
    expect(getProvidersPath().startsWith(realHome)).toBe(false);
  });

  it('ignores the legacy home variable', () => {
    expect(process.env['OPENCODE_STARTER_HOME']).toBeUndefined();
  });
});
