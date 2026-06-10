import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  clearSavedServerPassword,
  getSavedServerPassword,
  loadPreferences,
  savePreferences,
  setSavedServerPassword,
} from '../src/config.js';
import { getAppHome, getConfigPath, getLegacyAppHome, getLegacyConfPath } from '../src/paths.js';

let tempHome: string;
let previousHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'relay-ai-test-'));
  previousHome = process.env['HOME'];
  process.env['HOME'] = tempHome;
  process.env['RELAY_AI_HOME'] = join(tempHome, 'app-home');
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
  if (previousHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = previousHome;
  delete process.env['RELAY_AI_HOME'];
});

describe('app paths', () => {
  it('uses RELAY_AI_HOME when set', () => {
    process.env['RELAY_AI_HOME'] = join(tempHome, 'custom-home');

    expect(getAppHome()).toBe(join(tempHome, 'custom-home'));
  });

  it('still accepts legacy OPENCODE_STARTER_HOME override', () => {
    delete process.env['RELAY_AI_HOME'];
    process.env['OPENCODE_STARTER_HOME'] = join(tempHome, 'legacy-override');

    expect(getAppHome()).toBe(join(tempHome, 'legacy-override'));
  });

  it('defaults to a .relay-ai folder under the user home', () => {
    expect(getAppHome({ HOME: tempHome })).toBe(join(tempHome, '.relay-ai'));
  });

  it('stores config.json inside the app home', () => {
    process.env['RELAY_AI_HOME'] = join(tempHome, 'app');

    expect(getConfigPath()).toBe(join(tempHome, 'app', 'config.json'));
  });
});

describe('dotfolder config', () => {
  it('writes preferences to config.json in the app home', () => {
    savePreferences({ lastBackend: 'zen', lastModel: 'claude-sonnet-4-6' });

    expect(loadPreferences()).toMatchObject({
      lastBackend: 'zen',
      lastModel: 'claude-sonnet-4-6',
    });
    expect(JSON.parse(readFileSync(getConfigPath(), 'utf8'))).toMatchObject({
      lastBackend: 'zen',
      lastModel: 'claude-sonnet-4-6',
    });
  });

  it('migrates legacy lastProvider opencode to zen on read', () => {
    const configPath = getConfigPath();
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ lastProvider: 'opencode' }), 'utf8');

    expect(loadPreferences().lastProvider).toBe('zen');
  });

  it('returns null when no server password is saved', () => {
    expect(getSavedServerPassword()).toBeNull();
  });

  it('saves and clears a server password', () => {
    setSavedServerPassword('my-lan-password');
    expect(getSavedServerPassword()).toBe('my-lan-password');

    clearSavedServerPassword();
    expect(getSavedServerPassword()).toBeNull();
  });

  it('creates the app home lazily', () => {
    expect(existsSync(process.env['RELAY_AI_HOME']!)).toBe(false);

    savePreferences({ lastProvider: 'zen' });

    expect(existsSync(process.env['RELAY_AI_HOME']!)).toBe(true);
  });

  it('migrates config from the previous conf path once', () => {
    const legacyPath = getLegacyConfPath();
    rmSync(process.env['RELAY_AI_HOME']!, { recursive: true, force: true });
    mkdirSync(dirname(legacyPath), { recursive: true });
    writeFileSync(legacyPath, JSON.stringify({ lastProvider: 'nvidia' }), 'utf8');

    expect(loadPreferences().lastProvider).toBe('nvidia');
    expect(JSON.parse(readFileSync(getConfigPath(), 'utf8'))).toMatchObject({
      lastProvider: 'nvidia',
    });
    expect(existsSync(`${legacyPath}.migrated`)).toBe(true);
  });

  it('migrates config from ~/.opencode-starter on first read', () => {
    delete process.env['RELAY_AI_HOME'];
    delete process.env['OPENCODE_STARTER_HOME'];
    const legacyAppHome = getLegacyAppHome({ HOME: tempHome });
    mkdirSync(legacyAppHome, { recursive: true });
    writeFileSync(join(legacyAppHome, 'config.json'), JSON.stringify({ lastModel: 'claude' }), 'utf8');

    expect(loadPreferences().lastModel).toBe('claude');
    const migratedPath = getConfigPath({ HOME: tempHome });
    expect(existsSync(migratedPath)).toBe(true);
    expect(JSON.parse(readFileSync(migratedPath, 'utf8'))).toMatchObject({
      lastModel: 'claude',
    });
  });
});
