import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';

const childState = vi.hoisted(() => ({
  listeners: new Map<string, (...args: any[]) => void>(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  execSync: vi.fn(),
  spawn: vi.fn().mockImplementation(() => {
    childState.listeners.clear();
    return {
      on: vi.fn((event: string, listener: (...args: any[]) => void) => {
        childState.listeners.set(event, listener);
      }),
    };
  }),
}));

vi.mock('../src/config.js', () => ({
  getAppPathOverride: () => process.execPath,
}));

vi.mock('../src/antigravity/ide-profile.js', () => ({
  prepareIdeProfile: vi.fn(),
}));

import { launchAntigravityIde } from '../src/antigravity/launch-ide.js';

beforeEach(() => {
  vi.clearAllMocks();
  childState.listeners.clear();
});

describe('launchAntigravityIde', () => {
  it('resolves after the detached IDE spawns instead of waiting for it to exit', async () => {
    const launchResult = launchAntigravityIde(
      { ...process.env },
      '/tmp/relay-antigravity-profile',
      'http://127.0.0.1:17645',
      [],
    );
    let settledCode: number | undefined;
    void launchResult.then(code => {
      settledCode = code;
    });

    expect(spawn).toHaveBeenCalledOnce();
    childState.listeners.get('spawn')?.();
    await Promise.resolve();
    const codeBeforeIdeExit = settledCode;

    childState.listeners.get('exit')?.(0);
    await expect(launchResult).resolves.toBe(0);
    expect(codeBeforeIdeExit).toBe(0);
  });
});
