import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../src/ui/public/app.js', import.meta.url), 'utf8');

describe('Claude Code transparent proxy UI', () => {
  it('shows the approved checkbox and tooltip only on the Claude Code card', () => {
    expect(appSource).toContain("app.id === 'claude'");
    expect(appSource).toContain('Keep my Anthropic login and add Relay models');
    expect(appSource).toContain(
      'Launches Claude Code through a temporary local connection. Your normal Anthropic login and models continue to work, while compatible Relay AI favorites become available for model switching. The connection closes automatically when Claude Code exits.',
    );
  });

  it('sends the checked value to the launch API', () => {
    expect(appSource).toContain("body.httpProxy = true");
    expect(appSource).toContain("state.appHttpProxy[appId]");
  });

  it('disables proxy mode before launch for an incompatible explicit model', () => {
    expect(appSource).toContain('claudeHttpProxyAvailable');
    expect(appSource).toContain('claudeTransparentCompatible');
    expect(appSource).toContain('This selected model cannot be combined with your Anthropic login.');
  });
});
