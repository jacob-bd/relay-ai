import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  codexAppInstallHint,
  codexAppSupported,
  darwinQuitAppleScript,
  darwinMainExecutableCandidates,
  darwinMainPidsFromProcessList,
  linuxCodexAppCandidates,
  linuxEmbeddedCodexCandidates,
  restartTimeoutAction,
  gracefulQuitTimeoutMs,
  waitForOriginalCodexPids,
  windowsEmbeddedCodexCachePath,
  windowsEmbeddedCodexCandidates,
} from '../src/codex/app-launch.js';

describe('Linux ChatGPT desktop launcher', () => {
  it('accepts Linux as a supported Codex desktop platform', () => {
    expect(() => codexAppSupported('linux')).not.toThrow();
  });

  it('includes the packaged and user-local ChatGPT executable candidates', () => {
    expect(linuxCodexAppCandidates('/home/jacob')).toEqual(expect.arrayContaining([
      '/usr/bin/chatgpt',
      '/usr/lib/chatgpt/ChatGPT',
      '/opt/chatgpt/ChatGPT',
      '/home/jacob/.local/bin/chatgpt',
    ]));
  });

  it('derives the embedded Codex runtime from the Linux package root', () => {
    expect(linuxEmbeddedCodexCandidates('/usr/lib/chatgpt/ChatGPT')).toContain(
      '/usr/lib/chatgpt/resources/codex',
    );
  });

  it('mentions Linux in the install hint', () => {
    expect(codexAppInstallHint()).toMatch(/Linux/i);
  });

  it('documents the RDP-safe direct launch path', () => {
    const source = readFileSync(new URL('../src/codex/app-launch.ts', import.meta.url), 'utf8');
    expect(source).toContain('linuxLaunchEnv()');
    expect(source).not.toContain('gtk-launch');
  });

  it('documents deterministic Linux restart for tray-hidden instances', () => {
    const source = readFileSync(new URL('../src/codex/app-launch.ts', import.meta.url), 'utf8');
    expect(source).toContain('Restarting ChatGPT Desktop to apply relay-ai settings...');
    expect(source).toContain('linuxQuitGraceful();');
  });
});

describe('ChatGPT desktop restart safety', () => {
  it('identifies the main macOS executable by full path, not the truncated process name', () => {
    expect(darwinMainExecutableCandidates('/Applications/ChatGPT.app')).toEqual([
      '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT',
      '/Applications/ChatGPT.app/Contents/MacOS/Codex',
    ]);
  });

  it('finds the macOS main PID when pgrep omits ChatGPT but ps reports its full command', () => {
    const commands = darwinMainExecutableCandidates('/Applications/ChatGPT.app');
    const processList = [
      ' 2757 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT',
      ' 2773 /Applications/ChatGPT.app/Contents/Frameworks/Codex Framework.framework/Helpers/Codex (Service) --type=gpu-process',
      ' 3122 /Applications/ChatGPT.app/Contents/Resources/native/bare-modifier-monitor --key DoubleCommand',
      ' 4000 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT -psn_0_12345',
      ' 5000 /Applications/Other.app/Contents/MacOS/ChatGPT',
    ].join('\n');

    expect(darwinMainPidsFromProcessList(processList, commands, 4000)).toEqual([2757]);
  });

  it('targets the stable macOS bundle id instead of the deprecated Codex app name', () => {
    expect(darwinQuitAppleScript()).toBe('tell application id "com.openai.codex" to quit');
    expect(darwinQuitAppleScript()).not.toContain('application "Codex"');
  });

  it('fails closed on macOS when graceful quit times out', () => {
    expect(restartTimeoutAction('darwin')).toBe('fail-closed');
  });

  it('allows macOS Codex tasks a bounded 30-second graceful shutdown window', () => {
    expect(gracefulQuitTimeoutMs('darwin')).toBe(30_000);
    expect(gracefulQuitTimeoutMs('win32')).toBe(5_000);
  });

  it('retains the guarded Windows force-quit fallback', () => {
    expect(restartTimeoutAction('win32')).toBe('force-quit');
  });

  it('accepts an immediate replacement PID once the original app PID exits', async () => {
    const alivePids = new Set([202]);
    await expect(waitForOriginalCodexPids([101], 0, pid => alivePids.has(pid))).resolves.toBe(true);
  });

  it('does not confuse a still-running original PID with a replacement', async () => {
    const alivePids = new Set([101, 202]);
    await expect(waitForOriginalCodexPids([101], 0, pid => alivePids.has(pid))).resolves.toBe(false);
  });
});

describe('Windows ChatGPT desktop launcher', () => {
  it('derives the embedded runtime from Microsoft Store and unpackaged installs', () => {
    const packageRoot = 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.810.7004.0_x64__publisher';
    const candidates = windowsEmbeddedCodexCandidates(
      'C:\\Users\\Tony\\AppData\\Local\\Programs\\ChatGPT\\ChatGPT.exe',
      [packageRoot],
    );

    expect(candidates).toContain(
      'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.810.7004.0_x64__publisher\\app\\resources\\codex.exe',
    );
    expect(candidates).toContain(
      'C:\\Users\\Tony\\AppData\\Local\\Programs\\ChatGPT\\resources\\codex.exe',
    );
    expect(windowsEmbeddedCodexCachePath(
      `${packageRoot}\\app\\resources\\codex.exe`,
      'C:\\Users\\Tony',
    )).toBe(
      'C:\\Users\\Tony\\.relay-ai\\codex\\embedded-runtime'
      + '\\OpenAI.Codex_26.810.7004.0_x64__publisher\\codex.exe',
    );
  });
});
