import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prepareIdeProfile, readIdeSettings } from '../src/antigravity/ide-profile.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('antigravity ide-profile', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-ai-test-profile-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates the profile directory and writes jetski.cloudCodeUrl', () => {
    const gatewayUrl = 'http://127.0.0.1:18768';
    const profilePath = prepareIdeProfile(tempDir, gatewayUrl);

    expect(fs.existsSync(profilePath)).toBe(true);

    const settingsPath = path.join(profilePath, 'User', 'settings.json');
    expect(fs.existsSync(settingsPath)).toBe(true);

    const settings = readIdeSettings(settingsPath);
    expect(settings['jetski.cloudCodeUrl']).toBe(gatewayUrl);
    expect(settings['telemetry.telemetryLevel']).toBe('off');
    expect(settings['telemetry.enableTelemetry']).toBe(false);
    expect(settings['telemetry.enableCrashReporter']).toBe(false);
  });

  it('preserves existing settings and overrides jetski.cloudCodeUrl', () => {
    // 1. Create a dummy settings file with some custom options
    const userDir = path.join(tempDir, 'User');
    fs.mkdirSync(userDir, { recursive: true });
    const settingsPath = path.join(userDir, 'settings.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        'editor.fontSize': 14,
        'jetski.cloudCodeUrl': 'http://127.0.0.1:9999',
      }),
      'utf8'
    );

    // 2. Prepare the profile with a new gateway URL
    const gatewayUrl = 'http://127.0.0.1:55555';
    prepareIdeProfile(tempDir, gatewayUrl);

    // 3. Verify custom options are preserved and URL is updated
    const settings = readIdeSettings(settingsPath);
    expect(settings['editor.fontSize']).toBe(14);
    expect(settings['jetski.cloudCodeUrl']).toBe(gatewayUrl);
    expect(settings['telemetry.telemetryLevel']).toBe('off');
  });
});
