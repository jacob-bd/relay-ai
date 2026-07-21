import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { copyDeviceCode, copyTextToClipboard, oauthConnectionLabel } from '../src/ui/public/oauth-device.js';

describe('UI OAuth device helpers', () => {
  it('uses Connected for OAuth instead of describing the credential as an API key', () => {
    expect(oauthConnectionLabel({ authType: 'oauth', hasKey: true })).toBe('Connected');
    expect(oauthConnectionLabel({ authType: 'api', hasKey: true })).toBe('Key stored');
    expect(oauthConnectionLabel({ authType: 'oauth', hasKey: false })).toBe('Not configured');
  });

  it('includes a sanitized subscription label when one is available', () => {
    expect(oauthConnectionLabel({
      authType: 'oauth',
      hasKey: true,
      subscription: { tier: 'free', label: 'Copilot Free' },
    })).toBe('Connected · Copilot Free');
  });

  it('copies only the displayed one-time code', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(globalThis, 'isSecureContext', { value: true, configurable: true });

    await copyDeviceCode('ABCD-1234', { writeText });

    expect(writeText).toHaveBeenCalledWith('ABCD-1234');
  });

  it('falls back to execCommand when Clipboard API throws (LAN http)', async () => {
    const writeText = vi.fn(async () => { throw new Error('NotAllowedError'); });
    const execCommand = vi.fn(() => true);
    const input = {
      value: '',
      style: {},
      setAttribute: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
      remove: vi.fn(),
    };
    Object.defineProperty(globalThis, 'isSecureContext', { value: true, configurable: true });

    await copyTextToClipboard('sk-test', { writeText }, {
      body: { appendChild: vi.fn() },
      createElement: () => input,
      execCommand,
    });

    expect(writeText).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(input.value).toBe('sk-test');
  });

  it('uses execCommand on insecure contexts without Clipboard API', async () => {
    const execCommand = vi.fn(() => true);
    const input = {
      value: '',
      style: {},
      setAttribute: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
      remove: vi.fn(),
    };
    Object.defineProperty(globalThis, 'isSecureContext', { value: false, configurable: true });

    await copyTextToClipboard('model-id', undefined, {
      body: { appendChild: vi.fn() },
      createElement: () => input,
      execCommand,
    });

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(input.value).toBe('model-id');
  });

  it('opens the sign-in page only from the explicit open-button handler', () => {
    const app = readFileSync(
      fileURLToPath(new URL('../src/ui/public/app.js', import.meta.url)),
      'utf8',
    );
    const panelStart = app.indexOf('function createDeviceAuthorizationPanel');
    const flowStart = app.indexOf('async function beginDeviceOAuthFlow');
    const panelSource = app.slice(panelStart, flowStart);
    const flowEnd = app.indexOf('function buildOAuthTemplateBodyContent');
    const flowSource = app.slice(flowStart, flowEnd);

    expect(panelSource).toContain("openButton.addEventListener('click'");
    expect(panelSource).toContain("window.open(url, '_blank', 'noopener,noreferrer')");
    expect(flowSource).not.toContain('window.open');
  });

  it('uses the same device flow for adding and re-authenticating providers', () => {
    const app = readFileSync(
      fileURLToPath(new URL('../src/ui/public/app.js', import.meta.url)),
      'utf8',
    );
    expect(app.match(/=> beginDeviceOAuthFlow\(\{/g)).toHaveLength(2);
  });
});
