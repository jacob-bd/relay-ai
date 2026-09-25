import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { clearAppLastSelectedModel, clearSavedModelSelection, prepareIdeProfile, readIdeSettings } from '../src/antigravity/ide-profile.js';
import { DatabaseSync } from 'node:sqlite';
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

describe('clearSavedModelSelection', () => {
  let profileDir: string;
  const dbPath = () => path.join(profileDir, 'User', 'globalStorage', 'state.vscdb');

  beforeEach(() => {
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-state-'));
    fs.mkdirSync(path.dirname(dbPath()), { recursive: true });
    const db = new DatabaseSync(dbPath());
    db.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
    const insert = db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)');
    // The value real IDE 2.5.5 saved: last_selected_agent_model = enum 1403 (M403).
    insert.run('antigravityUnifiedStateSync.modelPreferences', 'CjAKJmxhc3Rfc2VsZWN0ZWRfYWdlbnRfbW9kZWxfc2VudGluZWxfa2V5EgYKBEVQc0s=');
    insert.run('colorThemeData', '{"id":"dark"}');
    db.close();
  });

  afterEach(() => {
    fs.rmSync(profileDir, { recursive: true, force: true });
  });

  const keys = () => {
    const db = new DatabaseSync(dbPath());
    const rows = db.prepare('SELECT key FROM ItemTable ORDER BY key').all() as Array<{ key: string }>;
    db.close();
    return rows.map(row => row.key);
  };

  it('forgets the last-picked model and keeps everything else', () => {
    expect(clearSavedModelSelection(profileDir)).toBe(true);
    expect(keys()).toEqual(['colorThemeData']);
    expect(clearSavedModelSelection(profileDir)).toBe(false);
  });

  it('runs as part of preparing the profile', () => {
    prepareIdeProfile(profileDir, 'http://127.0.0.1:1234');
    expect(keys()).toEqual(['colorThemeData']);
  });

  it('does nothing for a profile the IDE has never opened', () => {
    expect(clearSavedModelSelection(path.join(profileDir, 'fresh'))).toBe(false);
  });
});

describe('clearAppLastSelectedModel', () => {
  let dir: string;
  const statePath = () => path.join(dir, 'antigravity_state.pbtxt');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-app-state-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('removes only the remembered model line', () => {
    fs.writeFileSync(statePath(), [
      'agent_onboarding_completed:  AGENT_ONBOARDING_STATE_COMPLETED',
      'last_selected_agent_model:  MODEL_PLACEHOLDER_M319',
      'migrations:  {',
      '  key:  3',
      '}',
      '',
    ].join('\n'));
    expect(clearAppLastSelectedModel(statePath())).toBe(true);
    expect(fs.readFileSync(statePath(), 'utf8')).toBe([
      'agent_onboarding_completed:  AGENT_ONBOARDING_STATE_COMPLETED',
      'migrations:  {',
      '  key:  3',
      '}',
      '',
    ].join('\n'));
  });

  it('leaves the file alone when nothing is remembered or it is missing', () => {
    expect(clearAppLastSelectedModel(statePath())).toBe(false);
    fs.writeFileSync(statePath(), 'migrations:  {\n}\n');
    expect(clearAppLastSelectedModel(statePath())).toBe(false);
    expect(fs.readFileSync(statePath(), 'utf8')).toBe('migrations:  {\n}\n');
  });
});
