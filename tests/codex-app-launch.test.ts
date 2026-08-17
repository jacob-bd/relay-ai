import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  codexAppInstallHint,
  codexAppSupported,
  linuxCodexAppCandidates,
  linuxEmbeddedCodexCandidates,
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
