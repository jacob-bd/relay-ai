import { describe, expect, it } from 'vitest';
import {
  formatUiServerLifecycleMessage,
  isUiApiRoute,
  resolveUiMode,
  resolveUiRuntimeConfig,
  resolveUiShutdownDecision,
} from '../src/ui-command.js';

describe('ui command routing', () => {
  it('routes API and OAuth callback requests to the API handler', () => {
    expect(isUiApiRoute('/api/providers/oauth/start')).toBe(true);
    expect(isUiApiRoute('/oauth/callback?state=abc&code=123')).toBe(true);
  });

  it('leaves static UI paths on the static file handler', () => {
    expect(isUiApiRoute('/')).toBe(false);
    expect(isUiApiRoute('/index.html')).toBe(false);
    expect(isUiApiRoute('/app.js')).toBe(false);
  });

  it('keeps the UI running when Ctrl+C prompt is declined', async () => {
    const decision = await resolveUiShutdownDecision('SIGINT', async () => false);

    expect(decision).toBe('keep');
  });

  it('closes the UI when Ctrl+C prompt is accepted', async () => {
    const decision = await resolveUiShutdownDecision('SIGINT', async () => true);

    expect(decision).toBe('close');
  });

  it('closes the UI on non-interactive termination signals without prompting', async () => {
    let prompted = false;
    const decision = await resolveUiShutdownDecision('SIGTERM', async () => {
      prompted = true;
      return false;
    });

    expect(decision).toBe('close');
    expect(prompted).toBe(false);
  });

  it('skips Ctrl+C confirm in server admin mode', async () => {
    let prompted = false;
    const decision = await resolveUiShutdownDecision(
      'SIGINT',
      async () => {
        prompted = true;
        return false;
      },
      { confirmOnSigint: false },
    );
    expect(decision).toBe('close');
    expect(prompted).toBe(false);
  });
});

describe('UI server admin mode', () => {
  it('resolves server mode from opts or RELAY_AI_UI_MODE', () => {
    expect(resolveUiMode({ serverMode: true })).toBe('server');
    expect(resolveUiMode({}, { RELAY_AI_UI_MODE: 'server' })).toBe('server');
    expect(resolveUiMode({}, {})).toBe('full');
  });

  it('binds 0.0.0.0:8787 without browser open in server mode', () => {
    const runtime = resolveUiRuntimeConfig({ serverMode: true }, {});
    expect(runtime).toMatchObject({
      mode: 'server',
      host: '0.0.0.0',
      port: 8787,
      openBrowser: false,
      confirmShutdownOnSigint: false,
    });
  });
});

describe('UI Server Gateway lifecycle messages', () => {
  it('formats local and network start messages with exposed model counts', () => {
    expect(formatUiServerLifecycleMessage({ type: 'started', listenMode: 'local', modelCount: 1 }))
      .toBe('◆ Server Gateway started · Local mode · 1 model exposed');
    expect(formatUiServerLifecycleMessage({ type: 'started', listenMode: 'network', modelCount: 17 }))
      .toBe('◆ Server Gateway started · Network mode · 17 models exposed');
  });

  it('formats the stop message', () => {
    expect(formatUiServerLifecycleMessage({ type: 'stopped' }))
      .toBe('◇ Server Gateway stopped');
  });
});
