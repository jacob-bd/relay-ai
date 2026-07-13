import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { VERSION } from '../src/constants.js';

describe('CLI update notifications', () => {
  let tempHome: string;
  let previousRelayHome: string | undefined;
  let originalIsTTY: PropertyDescriptor | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'relay-ai-cli-update-'));
    previousRelayHome = process.env['RELAY_AI_HOME'];
    process.env['RELAY_AI_HOME'] = tempHome;
    originalIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    mkdirSync(tempHome, { recursive: true });
    writeFileSync(join(tempHome, 'update-check.json'), JSON.stringify({
      latestVersion: '9.0.0',
      checkedAt: Date.now(),
    }));
  });

  afterEach(() => {
    if (originalIsTTY) Object.defineProperty(process.stdout, 'isTTY', originalIsTTY);
    else delete (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY;
    if (previousRelayHome === undefined) delete process.env['RELAY_AI_HOME'];
    else process.env['RELAY_AI_HOME'] = previousRelayHome;
    rmSync(tempHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('prints an update notice for interactive commands', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await main(['--version']);

    expect(log.mock.calls.flat().join('\n')).toContain(
      `🔔 Update available: ${VERSION} → 9.0.0. Run npm install -g @jacobbd/relay-ai@latest to update.`,
    );
  });

  it('does not print the notice for non-interactive output', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await main(['--version']);

    expect(log.mock.calls.flat().join('\n')).not.toContain('Update available');
  });
});
