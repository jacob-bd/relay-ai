import { describe, it, expect, vi } from 'vitest';
import { findAntigravityIdeBinary, isAntigravityIdeRunning, launchAntigravityIde, waitForAntigravityIdeQuit } from '../src/antigravity/launch-ide.js';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

vi.mock('node:child_process', () => {
  return {
    execFileSync: vi.fn(),
    spawn: vi.fn().mockReturnValue({
      on: vi.fn().mockImplementation((event, cb) => {
        if (event === 'exit') cb(0);
      }),
      once: vi.fn(),
      kill: vi.fn(),
    }),
  };
});

describe('antigravity launch-ide', () => {
  it('finds antigravity ide binary on macOS', () => {
    // If not on mac, we might get null, but we can verify the path resolution logic
    const bin = findAntigravityIdeBinary();
    expect(bin).toBeDefined();
    if (process.platform === 'darwin') {
      expect(bin).toContain('Antigravity IDE.app');
    }
  });

  it('spawns the IDE with user data and extensions dir', async () => {
    const tempProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-ai-ide-test-'));
    const env = { ...process.env, CLOUD_CODE_URL: 'http://127.0.0.1:12345' };
    
    const code = await launchAntigravityIde(env, tempProfile, 'http://127.0.0.1:12345', []);
    expect(code).toBe(0);
    expect(spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        `--user-data-dir=${tempProfile}`,
        expect.stringContaining(path.join('.relay-ai', 'antigravity', 'extensions')),
      ]),
      expect.objectContaining({
        stdio: 'inherit',
        env: expect.objectContaining({ CLOUD_CODE_URL: 'http://127.0.0.1:12345' }),
      })
    );

    fs.rmSync(tempProfile, { recursive: true, force: true });
  });

  it('does not add --wait unless explicitly requested', async () => {
    const tempProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-ai-ide-test-'));
    const env = { ...process.env, CLOUD_CODE_URL: 'http://127.0.0.1:12345' };

    await launchAntigravityIde(env, tempProfile, 'http://127.0.0.1:12345', []);
    const args = vi.mocked(spawn).mock.calls.at(-1)?.[1] as string[];
    expect(args).not.toContain('--wait');

    fs.rmSync(tempProfile, { recursive: true, force: true });
  });

  it('passes an explicit --wait argument through unchanged', async () => {
    const tempProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-ai-ide-test-'));
    const env = { ...process.env, CLOUD_CODE_URL: 'http://127.0.0.1:12345' };

    await launchAntigravityIde(env, tempProfile, 'http://127.0.0.1:12345', ['--wait']);
    const args = vi.mocked(spawn).mock.calls.at(-1)?.[1] as string[];
    expect(args.filter(arg => arg === '--wait')).toHaveLength(1);

    fs.rmSync(tempProfile, { recursive: true, force: true });
  });

  it('detects a running managed Antigravity IDE process by profile directory', () => {
    const tempProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-ai-ide-test-'));
    expect(isAntigravityIdeRunning(tempProfile, () => {
      return `123 /Applications/Antigravity IDE.app/Contents/MacOS/Electron --user-data-dir=${tempProfile}`;
    })).toBe(true);
    expect(isAntigravityIdeRunning(tempProfile, () => {
      return '123 /Applications/Other.app/Contents/MacOS/Electron';
    })).toBe(false);

    fs.rmSync(tempProfile, { recursive: true, force: true });
  });

  it('waits until the managed Antigravity process exits', async () => {
    const tempProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-ai-ide-test-'));
    let processListCalls = 0;

    const quit = await waitForAntigravityIdeQuit(tempProfile, {
      timeoutMs: 100,
      pollIntervalMs: 1,
      processList: () => {
        processListCalls += 1;
        return processListCalls === 1
          ? `123 /Applications/Antigravity IDE.app/Contents/MacOS/Electron --user-data-dir=${tempProfile}`
          : '';
      },
    });

    expect(quit).toBe(true);
    expect(processListCalls).toBeGreaterThanOrEqual(2);

    fs.rmSync(tempProfile, { recursive: true, force: true });
  });
});
