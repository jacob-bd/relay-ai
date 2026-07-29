import { describe, it, expect, vi } from 'vitest';
import {
  findAntigravityCliBinary,
  launchAntigravityCli,
  readAntigravityCliVersion,
} from '../src/antigravity/launch-cli.js';
import { execFileSync } from 'node:child_process';
import spawn from 'cross-spawn';

vi.mock('node:child_process', () => {
  return {
    execSync: vi.fn().mockReturnValue('/usr/local/bin/agy'),
    execFileSync: vi.fn().mockReturnValue('agy version 1.0.10\n'),
  };
});

vi.mock('cross-spawn', () => ({
  default: vi.fn().mockReturnValue({
    on: vi.fn().mockImplementation((event, cb) => {
      if (event === 'exit') cb(0);
    }),
    kill: vi.fn(),
  }),
}));

describe('antigravity launch-cli', () => {
  it('finds agy binary', () => {
    const bin = findAntigravityCliBinary();
    expect(bin).toBeDefined();
    expect(typeof bin === 'string' || bin === null).toBe(true);
  });

  it('spawns agy without a shell so Windows preserves multi-word arguments', async () => {
    const env = { ...process.env, CLOUD_CODE_URL: 'http://127.0.0.1:12345' };
    const args = [
      '--model',
      'Nemotron 3 Ultra Free (Relay)',
      '-p',
      'Explain Flutter Windows compilation.',
    ];
    const code = await launchAntigravityCli(env, args);

    expect(code).toBe(0);
    expect(spawn).toHaveBeenCalledWith(
      expect.any(String),
      args,
      expect.objectContaining({
        stdio: 'inherit',
        env: expect.objectContaining({ CLOUD_CODE_URL: 'http://127.0.0.1:12345' }),
      })
    );
    expect(vi.mocked(spawn).mock.calls[0]?.[2]).not.toHaveProperty('shell');
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
