import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  fallbackPathsForApp,
  getRelayLaunchCommand,
  getTerminalLaunchCommand,
  getSupportedApps,
} from '../src/native-launcher.js';

function macCommandScriptPath(cmd: string): string | null {
  const match = cmd.match(/open -a Terminal (.+)$/);
  return match?.[1] ?? null;
}

// On Linux, getTerminalLaunchCommand probes terminal emulators and writes the
// actual invocation to a generated launch.sh rather than embedding it inline —
// read that script to assert on the real command, mirroring the mac helper above.
function linuxLaunchScriptContents(cmd: string): string | null {
  const match = cmd.match(/x-terminal-emulator -e sh (\S+)/);
  const scriptPath = match?.[1];
  if (!scriptPath) return null;
  return readFileSync(scriptPath, 'utf8');
}

function assertLaunchCommandContains(cmd: string, ...substrings: string[]): void {
  if (process.platform === 'darwin') {
    const scriptPath = macCommandScriptPath(cmd);
    expect(scriptPath).toBeTruthy();
    const script = readFileSync(scriptPath!, 'utf8');
    for (const s of substrings) expect(script).toContain(s);
    return;
  }
  if (process.platform === 'linux') {
    const script = linuxLaunchScriptContents(cmd);
    expect(script).toBeTruthy();
    for (const s of substrings) expect(script).toContain(s);
    return;
  }
  for (const s of substrings) expect(cmd).toContain(s);
}

describe('native-launcher', () => {
  it('exposes Antigravity fallback install paths', () => {
    expect(fallbackPathsForApp('antigravity-ide', 'win32')).toEqual(expect.arrayContaining([
      expect.stringContaining('Antigravity IDE.exe'),
    ]));
    expect(fallbackPathsForApp('antigravity-ide', 'linux')).toEqual(expect.arrayContaining([
      '/opt/antigravity-ide/Antigravity-IDE',
    ]));
    expect(fallbackPathsForApp('antigravity', 'win32')).toEqual(expect.arrayContaining([
      expect.stringContaining('Antigravity.exe'),
    ]));
    expect(fallbackPathsForApp('antigravity', 'linux')).toEqual(expect.arrayContaining([
      '/opt/antigravity/antigravity',
      '/usr/local/bin/antigravity',
      '/usr/bin/antigravity',
    ]));
    expect(fallbackPathsForApp('agy', 'win32')).toEqual(expect.arrayContaining([
      expect.stringContaining('Antigravity'),
    ]));
  });

  it('finds the Codex desktop app under its new ChatGPT.app name on macOS', () => {
    expect(fallbackPathsForApp('codex-app', 'darwin')).toEqual(expect.arrayContaining([
      '/Applications/ChatGPT.app',
      '/Applications/Codex.app',
    ]));
  });

  it('detects system application list structure', () => {
    const apps = getSupportedApps();
    expect(apps.length).toBeGreaterThanOrEqual(4);
    for (const app of apps) {
      expect(app).toHaveProperty('id');
      expect(app).toHaveProperty('name');
      expect(app).toHaveProperty('installed');
      expect(app).toHaveProperty('type');
      expect(app).toHaveProperty('relayCommand');
    }
  });

  it('constructs Relay launch commands with provider-qualified models', () => {
    const cmd = getRelayLaunchCommand('codex', {
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
    });

    if (process.platform === 'darwin') {
      const scriptPath = macCommandScriptPath(cmd);
      expect(scriptPath).toBeTruthy();
      const script = readFileSync(scriptPath!, 'utf8');
      expect(script).toContain('$ relay-ai codex');
      expect(script).toContain('codex');
      expect(script).toContain('--provider');
      expect(script).toContain('deepseek');
      expect(script).toContain('--model');
      expect(script).toContain('deepseek-v4-flash');
      expect(cmd).not.toContain('osascript');
    } else {
      assertLaunchCommandContains(cmd, 'codex', '--provider', 'deepseek', '--model', 'deepseek-v4-flash');
    }
  });

  it('adds relay trace flag to UI-launched tools when requested', () => {
    const cmd = getRelayLaunchCommand('codex', {
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      trace: true,
    });

    if (process.platform === 'darwin') {
      const scriptPath = macCommandScriptPath(cmd);
      expect(scriptPath).toBeTruthy();
      const script = readFileSync(scriptPath!, 'utf8');
      expect(script).toContain('relay-ai codex --trace --provider deepseek --model deepseek-v4-flash');
    } else {
      assertLaunchCommandContains(cmd, 'codex', '--trace');
    }
  });

  it('adds transparent proxy mode only to Claude Code launches', () => {
    const cmd = getRelayLaunchCommand('claude', {
      httpProxy: true,
      providerId: 'moonshot',
      modelId: 'kimi-k3',
    });
    assertLaunchCommandContains(
      cmd,
      'claude',
      '--http-proxy',
      '--provider',
      'moonshot',
      '--model',
      'kimi-k3',
    );
    expect(() => getRelayLaunchCommand('claude-app', { httpProxy: true }))
      .toThrow(/only.*Claude Code/i);
  });

  it('rejects ambiguous Relay model launches', () => {
    expect(() => getRelayLaunchCommand('codex', { modelId: 'deepseek-v4-flash' }))
      .toThrow('Both providerId and modelId are required');
  });

  it('rejects unsafe launch arguments instead of attempting to escape them', () => {
    const bin = 'agy';
    const args = ['--model', 'some-model;rm -rf /'];
    expect(() => getTerminalLaunchCommand(bin, args)).toThrow('Unsafe launch argument');
  });

  it('allows colons in launch arguments for namespaced model IDs', () => {
    const bin = 'agy';
    const args = ['--model', 'tencent/hy3:free'];
    expect(() => getTerminalLaunchCommand(bin, args)).not.toThrow();
  });


  it('constructs OS-specific launch commands correctly', () => {
    const bin = '/usr/local/bin/claude';
    const args = ['--model', 'gemini-2.5-pro', '--trace'];
    const cmd = getTerminalLaunchCommand(bin, args);

    if (process.platform === 'darwin') {
      expect(cmd).toContain('open -a Terminal');
      expect(cmd).toContain('Terminal');
      expect(cmd).not.toContain('osascript');
      const scriptPath = macCommandScriptPath(cmd);
      expect(scriptPath).toBeTruthy();
      expect(readFileSync(scriptPath!, 'utf8')).toContain('--model');
    } else if (process.platform === 'win32') {
      expect(cmd).toContain('start');
      expect(cmd).toContain('cmd.exe');
    } else {
      expect(cmd).toContain('x-terminal-emulator');
    }
  });

  it('runs launches from the requested working directory', () => {
    const cmd = getRelayLaunchCommand('claude', {
      providerId: 'google',
      modelId: 'gemini-3.1-pro-low',
      cwd: '/Users/jbendavi/dev_projects/example',
    });

    if (process.platform === 'darwin') {
      const scriptPath = macCommandScriptPath(cmd);
      expect(scriptPath).toBeTruthy();
      const script = readFileSync(scriptPath!, 'utf8');
      expect(script).toContain("cd /Users/jbendavi/dev_projects/example");
      expect(script).toContain('$ relay-ai claude --provider google --model gemini-3.1-pro-low');
    } else {
      assertLaunchCommandContains(cmd, '/Users/jbendavi/dev_projects/example');
    }
  });

  it('rejects launch arguments containing spaces', () => {
    const bin = 'agy';
    const args = ['--model', 'some model with spaces'];
    expect(() => getTerminalLaunchCommand(bin, args)).toThrow('Unsafe launch argument');
  });
});
