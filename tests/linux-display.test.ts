import { describe, expect, it } from 'vitest';
import { linuxLaunchEnv, resolveLinuxDisplay } from '../src/linux-display.js';

describe('Linux graphical session display resolution', () => {
  it('keeps the configured display when no terminal window id exists', () => {
    expect(resolveLinuxDisplay({ DISPLAY: ':1' }, () => false, [':10'])).toBe(':1');
  });

  it('keeps the configured display when it owns the terminal window', () => {
    expect(resolveLinuxDisplay(
      { DISPLAY: ':10', WINDOWID: '123' },
      (display, windowId) => display === ':10' && windowId === '123',
      [':1', ':10'],
    )).toBe(':10');
  });

  it('recovers the display that owns the terminal when DISPLAY is stale', () => {
    expect(resolveLinuxDisplay(
      { DISPLAY: ':1', WINDOWID: '41943043' },
      (display, windowId) => display === ':10' && windowId === '41943043',
      [':0', ':1', ':10'],
    )).toBe(':10');
  });

  it('passes the resolved display to the child environment', () => {
    expect(linuxLaunchEnv({ DISPLAY: ':1' })).toMatchObject({ DISPLAY: ':1' });
  });
});
