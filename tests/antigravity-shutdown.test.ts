import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { waitForShutdown } from '../src/antigravity.js';

describe('waitForShutdown', () => {
  it('recognizes Ctrl+C input on Windows when the terminal is in raw mode', async () => {
    const input = new PassThrough() as PassThrough & {
      isTTY: boolean;
      isRaw: boolean;
      setRawMode: (enabled: boolean) => void;
    };
    input.isTTY = true;
    input.isRaw = false;
    input.setRawMode = vi.fn((enabled: boolean) => {
      input.isRaw = enabled;
    });

    const shutdown = waitForShutdown(input as NodeJS.ReadStream, 'win32');
    input.write(Buffer.from([0x03]));

    await expect(shutdown).resolves.toBe('sigint');
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  });
});
