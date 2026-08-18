import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getAppRestoreStatePath,
  backupConfigToml,
  fileSha256,
  getCodexConfigPath,
  restoreCodexAppOverlay,
  saveAppRestoreStateBeforePatch,
  writeAppSessionLock,
} from '../src/codex/app-session.js';
import { applyAppConfigPatch } from '../src/codex/app-config.js';
import type { CodexAppConfigSpec } from '../src/codex/app-profile.js';

describe('codex app session', () => {
  let home: string;
  let prevHome: string | undefined;
  let prevUserProfile: string | undefined;
  let prevRelayHome: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-codex-app-session-'));
    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    prevRelayHome = process.env.RELAY_AI_HOME;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.RELAY_AI_HOME = join(home, '.relay-ai');
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
    if (prevRelayHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prevRelayHome;
  });

  function proxySpec(catalogPath: string): CodexAppConfigSpec {
    return {
      route: {
        tier: 'proxy',
        npm: '@ai-sdk/anthropic',
        apiKey: 'sk-test',
        upstreamModelId: 'claude-sonnet-4-6',
        modelId: 'claude-sonnet-4-6',
        providerId: 'anthropic',
      },
      proxyPort: 54321,
      catalogPath,
    };
  }

  it('allows the owning relay-ai process to restore its own app session', () => {
    const configPath = getCodexConfigPath();
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(configPath, 'model = "gpt-5"\nmodel_provider = "openai"\n', 'utf8');

    saveAppRestoreStateBeforePatch();
    const catalogPath = join(home, '.relay-ai', 'codex', 'app-models-anthropic.json');
    applyAppConfigPatch(proxySpec(catalogPath), configPath);
    writeAppSessionLock({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      configPath,
      catalogPaths: [catalogPath],
      restoreStatePath: getAppRestoreStatePath(),
      proxyPort: 54321,
    });

    const result = restoreCodexAppOverlay();

    expect(result.restored).toBe(true);
    expect(result.liveSession).toBeUndefined();
    expect(readFileSync(configPath, 'utf8')).toContain('model = "gpt-5"');
    expect(readFileSync(configPath, 'utf8')).toContain('model_provider = "openai"');
    expect(existsSync(getAppRestoreStatePath())).toBe(false);
  });

  it('restores the original config byte-for-byte when the Relay patch did not change concurrently', () => {
    const configPath = getCodexConfigPath();
    mkdirSync(join(home, '.codex'), { recursive: true });
    const original = '# preserve formatting exactly\nmodel="gpt-5"\nmodel_provider = "openai"\n';
    writeFileSync(configPath, original, 'utf8');

    saveAppRestoreStateBeforePatch();
    const backupPath = backupConfigToml()!;
    const catalogPath = join(home, '.relay-ai', 'codex', 'app-models-anthropic.json');
    applyAppConfigPatch(proxySpec(catalogPath), configPath);
    writeAppSessionLock({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      configPath,
      catalogPaths: [catalogPath],
      restoreStatePath: getAppRestoreStatePath(),
      backupPath,
      proxyPort: 54321,
      patchedConfigSha256: fileSha256(configPath),
      originalConfigSha256: fileSha256(backupPath),
    });

    expect(restoreCodexAppOverlay().restored).toBe(true);
    expect(readFileSync(configPath, 'utf8')).toBe(original);
  });

  it('preserves unrelated concurrent config edits instead of overwriting them with the backup', () => {
    const configPath = getCodexConfigPath();
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(configPath, 'model = "gpt-5"\nmodel_provider = "openai"\n', 'utf8');

    saveAppRestoreStateBeforePatch();
    const backupPath = backupConfigToml()!;
    const catalogPath = join(home, '.relay-ai', 'codex', 'app-models-anthropic.json');
    applyAppConfigPatch(proxySpec(catalogPath), configPath);
    const patchedHash = fileSha256(configPath);
    writeFileSync(configPath, `${readFileSync(configPath, 'utf8')}sandbox = "workspace-write"\n`, 'utf8');
    writeAppSessionLock({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      configPath,
      catalogPaths: [catalogPath],
      restoreStatePath: getAppRestoreStatePath(),
      backupPath,
      proxyPort: 54321,
      patchedConfigSha256: patchedHash,
      originalConfigSha256: fileSha256(backupPath),
    });

    expect(restoreCodexAppOverlay().restored).toBe(true);
    const restored = readFileSync(configPath, 'utf8');
    expect(restored).toContain('model = "gpt-5"');
    expect(restored).toContain('sandbox = "workspace-write"');
  });
});
