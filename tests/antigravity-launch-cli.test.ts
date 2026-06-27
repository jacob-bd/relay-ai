import { describe, it, expect, vi } from 'vitest';
import {
  findAntigravityCliBinary,
  launchAntigravityCli,
  readAntigravityCliVersion,
} from '../src/antigravity/launch-cli.js';
import { execFileSync, spawn } from 'node:child_process';

vi.mock('node:child_process', () => {
  return {
    spawn: vi.fn().mockReturnValue({
      on: vi.fn().mockImplementation((event, cb) => {
        if (event === 'exit') cb(0);
      }),
      once: vi.fn(),
      kill: vi.fn(),
    }),
    execSync: vi.fn().mockReturnValue('/usr/local/bin/agy'),
    execFileSync: vi.fn().mockReturnValue('agy version 1.0.10\n'),
  };
});

describe('antigravity launch-cli', () => {
  it('finds agy binary', () => {
    const bin = findAntigravityCliBinary();
    expect(bin).toBeDefined();
    expect(typeof bin === 'string' || bin === null).toBe(true);
  });

  it('spawns agy with custom environment', async () => {
    const env = { ...process.env, CLOUD_CODE_URL: 'http://127.0.0.1:12345' };
    const code = await launchAntigravityCli(env, ['-p', 'hello']);
    expect(code).toBe(0);
    expect(spawn).toHaveBeenCalledWith(
      expect.any(String),
      ['-p', 'hello'],
      expect.objectContaining({
        stdio: 'inherit',
        env: expect.objectContaining({ CLOUD_CODE_URL: 'http://127.0.0.1:12345' }),
      })
    );
  });

  it('parses agy --version output', () => {
    vi.mocked(execFileSync).mockReturnValueOnce('Google Antigravity CLI 1.0.10\n');

    expect(readAntigravityCliVersion('/usr/local/bin/agy')).toEqual({
      version: '1.0.10',
      raw: 'Google Antigravity CLI 1.0.10',
    });
  });

  it('reports version read failures without throwing', () => {
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw new Error('boom');
    });

    const result = readAntigravityCliVersion('/usr/local/bin/agy');

    expect(result.version).toBeNull();
    expect(result.error).toMatch(/boom/);
  });
});
