import { describe, expect, it } from 'vitest';
import { shutdownCodexAppSession } from '../src/codex/app-shutdown.js';

describe('Codex App shutdown ordering', () => {
  it('quits and waits for Desktop before restoring config and closing resources', async () => {
    const events: string[] = [];

    await shutdownCodexAppSession({
      isAppRunning: () => true,
      quitApp: () => events.push('quit'),
      waitForAppExit: async () => {
        events.push('wait');
        return true;
      },
      restoreOverlay: () => {
        events.push('restore');
        return { restored: true, message: 'Restored.' };
      },
      closeResources: () => events.push('close'),
    });

    expect(events).toEqual(['quit', 'wait', 'restore', 'close']);
  });

  it('does not restore or close resources while Desktop is still running', async () => {
    const events: string[] = [];

    await expect(shutdownCodexAppSession({
      isAppRunning: () => true,
      quitApp: () => events.push('quit'),
      waitForAppExit: async () => {
        events.push('wait');
        return false;
      },
      restoreOverlay: () => {
        events.push('restore');
        return { restored: true, message: 'Restored.' };
      },
      closeResources: () => events.push('close'),
    })).rejects.toThrow('ChatGPT Desktop did not exit');

    expect(events).toEqual(['quit', 'wait']);
  });

  it('restores without sending a quit request when Desktop is already stopped', async () => {
    const events: string[] = [];

    await shutdownCodexAppSession({
      isAppRunning: () => false,
      quitApp: () => events.push('quit'),
      waitForAppExit: async () => {
        events.push('wait');
        return true;
      },
      restoreOverlay: () => {
        events.push('restore');
        return { restored: true, message: 'Restored.' };
      },
      closeResources: () => events.push('close'),
    });

    expect(events).toEqual(['restore', 'close']);
  });
});
