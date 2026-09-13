import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyDeploymentMode3p,
  getClaudeDesktopConfigJsonPath,
  getConfigLibraryPath,
  getMetaJsonPath,
  readDeploymentMode,
  restoreDeploymentMode,
} from '../src/claude-desktop/app-config.js';
import { cleanupSession, writeSessionLock } from '../src/claude-desktop/app-session.js';

// Claude Desktop reads `deploymentMode` from its 3P claude_desktop_config.json
// and refuses third-party mode while it says "1p" — it then boots first-party,
// never calls the relay gateway, and shows none of the catalog models with no
// error anywhere. relay-ai must flip it for the session and put it back after.
describe('claude-app deploymentMode', () => {
  let home: string;
  let prevLocalAppData: string | undefined;
  let prevHome: string | undefined;
  let prevXdgConfigHome: string | undefined;

  const readConfig = (): Record<string, unknown> =>
    JSON.parse(readFileSync(getClaudeDesktopConfigJsonPath(), 'utf8')) as Record<string, unknown>;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-claude-app-mode-'));
    prevLocalAppData = process.env.LOCALAPPDATA;
    prevHome = process.env.HOME;
    // getClaudeDesktopHome()'s Linux branch checks XDG_CONFIG_HOME before
    // falling back to homedir() — GitHub Actions' Ubuntu runners set it to the
    // real ~/.config, so leaving it untouched here makes every test silently
    // read/write the CI runner's actual home instead of this temp dir.
    prevXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.LOCALAPPDATA = home;
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = home;
    mkdirSync(getConfigLibraryPath(), { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    if (prevLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = prevLocalAppData;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdgConfigHome;
  });

  it('switches a first-party pin to 3p and preserves the rest of the config', () => {
    writeFileSync(
      getClaudeDesktopConfigJsonPath(),
      JSON.stringify({ deploymentMode: '1p', mcpServers: {}, preferences: { sidebarMode: 'epitaxy' } }),
    );

    expect(applyDeploymentMode3p()).toEqual({ previous: '1p' });
    expect(readConfig()).toEqual({
      deploymentMode: '3p',
      mcpServers: {},
      preferences: { sidebarMode: 'epitaxy' },
    });
  });

  it('reports no change when the app is already in 3p', () => {
    writeFileSync(getClaudeDesktopConfigJsonPath(), JSON.stringify({ deploymentMode: '3p' }));
    expect(applyDeploymentMode3p()).toBeUndefined();
  });

  it('treats an absent config as unpinned and restores it to unpinned', () => {
    expect(applyDeploymentMode3p()).toEqual({ previous: null });
    expect(readDeploymentMode()).toBe('3p');

    restoreDeploymentMode(null);
    expect(readDeploymentMode()).toBeNull();
    expect(readConfig()).toEqual({});
  });

  it('keeps keys the app wrote during the session when restoring', () => {
    writeFileSync(getClaudeDesktopConfigJsonPath(), JSON.stringify({ deploymentMode: '1p' }));
    const change = applyDeploymentMode3p();
    writeFileSync(
      getClaudeDesktopConfigJsonPath(),
      JSON.stringify({ ...readConfig(), coworkUserFilesPath: '/tmp/claude' }),
    );

    restoreDeploymentMode(change!.previous);
    expect(readConfig()).toEqual({ deploymentMode: '1p', coworkUserFilesPath: '/tmp/claude' });
  });

  it('restores the previous mode on session cleanup', () => {
    writeFileSync(getClaudeDesktopConfigJsonPath(), JSON.stringify({ deploymentMode: '1p' }));
    const change = applyDeploymentMode3p();
    writeSessionLock({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      uuid: 'our-uuid',
      proxyPort: 12345,
      previousDeploymentMode: change!.previous,
    });

    cleanupSession('our-uuid');
    expect(readDeploymentMode()).toBe('1p');
  });

  it('still restores deploymentMode when the _meta.json restore step fails', () => {
    // Reproduces the crash seen with a full disk: copyFileSync(backup, meta)
    // throwing must not skip the deploymentMode restore that follows it, and
    // cleanupSession itself must not throw out of the process 'exit' handler.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    writeFileSync(getClaudeDesktopConfigJsonPath(), JSON.stringify({ deploymentMode: '1p' }));
    const change = applyDeploymentMode3p();
    // A directory in place of the expected backup file makes copyFileSync throw.
    mkdirSync(`${getMetaJsonPath()}.bak`);
    writeSessionLock({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      uuid: 'our-uuid',
      proxyPort: 12345,
      previousDeploymentMode: change!.previous,
    });

    expect(() => cleanupSession('our-uuid')).not.toThrow();
    expect(readDeploymentMode()).toBe('1p');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('restore _meta.json'));

    errorSpy.mockRestore();
  });

  it('leaves deploymentMode alone for a session that never changed it', () => {
    writeFileSync(getClaudeDesktopConfigJsonPath(), JSON.stringify({ deploymentMode: '3p' }));
    writeSessionLock({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      uuid: 'our-uuid',
      proxyPort: 12345,
    });

    cleanupSession('our-uuid');
    expect(readDeploymentMode()).toBe('3p');
  });
});
