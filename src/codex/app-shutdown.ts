import type { RestoreAppOverlayResult } from './app-session.js';

export interface CodexAppShutdownDependencies {
  isAppRunning: () => boolean;
  quitApp: () => void;
  waitForAppExit: () => Promise<boolean>;
  /** Optional platform-specific escalation after graceful shutdown stalls. */
  forceQuitApp?: () => void;
  restoreOverlay: () => RestoreAppOverlayResult;
  closeResources: () => void;
}

/**
 * Shut down the desktop runtime before touching the config it has loaded.
 *
 * Desktop can persist its in-memory config while it exits. Restoring first
 * therefore races the app and can leave it pointing at a stopped proxy.
 */
export async function shutdownCodexAppSession(
  dependencies: CodexAppShutdownDependencies,
): Promise<RestoreAppOverlayResult> {
  if (dependencies.isAppRunning()) {
    dependencies.quitApp();
    let exited = await dependencies.waitForAppExit();
    if (!exited && dependencies.forceQuitApp) {
      dependencies.forceQuitApp();
      exited = await dependencies.waitForAppExit();
    }
    if (!exited) {
      throw new Error(
        'ChatGPT Desktop did not exit after graceful shutdown or force-quit; refusing to restore config until Desktop exits. '
        + 'Close Desktop, then run relay-ai codex-app --restore.',
      );
    }
  }

  const result = dependencies.restoreOverlay();
  if (result.liveSession) throw new Error(result.message);

  dependencies.closeResources();
  return result;
}
