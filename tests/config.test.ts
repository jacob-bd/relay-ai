import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  clearSavedServerPassword,
  getCachedModels,
  getSavedServerPassword,
  getSubscriptionTier,
  loadPreferences,
  savePreferences,
  setCachedModels,
  setSavedServerPassword,
  setSubscriptionTier,
} from '../src/config.js';
import { getAppHome, getConfigPath, getLegacyConfPath } from '../src/paths.js';
import type { ModelInfo } from '../src/types.js';

let tempHome: string;
let previousHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'opencode-starter-test-'));
  previousHome = process.env['HOME'];
  process.env['HOME'] = tempHome;
  process.env['OPENCODE_STARTER_HOME'] = join(tempHome, 'app-home');
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
  if (previousHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = previousHome;
  delete process.env['OPENCODE_STARTER_HOME'];
});

describe('app paths', () => {
  it('uses OPENCODE_STARTER_HOME when set', () => {
    process.env['OPENCODE_STARTER_HOME'] = join(tempHome, 'custom-home');

    expect(getAppHome()).toBe(join(tempHome, 'custom-home'));
  });

  it('defaults to a .opencode-starter folder under the user home', () => {
    expect(getAppHome({ HOME: tempHome })).toBe(join(tempHome, '.opencode-starter'));
  });

  it('stores config.json inside the app home', () => {
    process.env['OPENCODE_STARTER_HOME'] = join(tempHome, 'app');

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

  it('stores and reads subscription tier', () => {
    setSubscriptionTier('both');

    expect(getSubscriptionTier()).toBe('both');
  });

  it('stores cached models and ignores expired entries', () => {
    const models: ModelInfo[] = [{
      id: 'claude-sonnet-4-6',
      name: 'Claude Sonnet 4.6',
      isFree: false,
      brand: 'Claude',
      sourceBackend: 'zen',
      modelFormat: 'anthropic',
    }];

    setCachedModels('zen', models);
    expect(getCachedModels('zen')).toEqual(models);

    const config = JSON.parse(readFileSync(getConfigPath(), 'utf8'));
    config.modelListCache.zen.fetchedAt = '2020-01-01T00:00:00.000Z';
    writeFileSync(getConfigPath(), JSON.stringify(config), 'utf8');

    expect(getCachedModels('zen')).toBeNull();
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
    expect(existsSync(process.env['OPENCODE_STARTER_HOME']!)).toBe(false);

    setSubscriptionTier('free');

    expect(existsSync(process.env['OPENCODE_STARTER_HOME']!)).toBe(true);
  });

  it('migrates config from the previous conf path once', () => {
    const legacyPath = getLegacyConfPath();
    rmSync(process.env['OPENCODE_STARTER_HOME']!, { recursive: true, force: true });
    mkdirSync(dirname(legacyPath), { recursive: true });
    writeFileSync(legacyPath, JSON.stringify({ subscriptionTier: 'zen' }), 'utf8');

    expect(getSubscriptionTier()).toBe('zen');
    expect(JSON.parse(readFileSync(getConfigPath(), 'utf8'))).toMatchObject({
      subscriptionTier: 'zen',
    });
    expect(existsSync(`${legacyPath}.migrated`)).toBe(true);
  });
});
