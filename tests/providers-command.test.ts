import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseProvidersArgs, providerHubChoiceValue, providersHelpText, runProvidersAdd } from '../src/providers-command.js';
import {
  addZenRegistryStub,
  removeProviderFromRegistry,
  toggleProviderEnabled,
} from '../src/registry/crud.js';
import { emptyRegistry, loadRegistry, saveRegistry } from '../src/registry/io.js';
import { zenRegistryStub } from '../src/registry/builtins.js';
import { providerAuthHelpText } from '../src/registry/provider-auth.js';
import { PROVIDER_TEMPLATES } from '../src/provider-templates.js';
import * as env from '../src/env.js';

const selectMock = vi.hoisted(() => vi.fn());

vi.mock('@clack/prompts', async importOriginal => {
  const actual = await importOriginal<typeof import('@clack/prompts')>();
  return {
    ...actual,
    select: selectMock,
  };
});

describe('parseProvidersArgs', () => {
  it('defaults to hub', () => {
    expect(parseProvidersArgs([])).toEqual({ subcommand: 'hub', showHelp: false });
  });

  it('parses add, import, list, remove, refresh-models', () => {
    expect(parseProvidersArgs(['add'])).toEqual({ subcommand: 'add', showHelp: false });
    expect(parseProvidersArgs(['import'])).toEqual({ subcommand: 'import', showHelp: false });
    expect(parseProvidersArgs(['list'])).toEqual({ subcommand: 'list', showHelp: false });
    expect(parseProvidersArgs(['remove', 'groq'])).toEqual({
      subcommand: 'remove',
      showHelp: false,
      removeId: 'groq',
    });
    expect(parseProvidersArgs(['refresh-models'])).toEqual({ subcommand: 'refresh-models', showHelp: false });
    expect(parseProvidersArgs(['refresh-models', 'nvidia'])).toEqual({
      subcommand: 'refresh-models',
      showHelp: false,
      removeId: 'nvidia',
    });
    expect(parseProvidersArgs(['auth', 'xai', '--native'])).toEqual({
      subcommand: 'auth',
      showHelp: false,
      removeId: 'xai',
      authMethod: 'native',
    });
  });

  it('reports remove without id', () => {
    expect(parseProvidersArgs(['remove']).error).toContain('Usage');
  });

  it('annotates phase in help text', () => {
    const help = providersHelpText();
    expect(help).toContain('providers add');
    expect(help).toContain('providers remove');
    expect(help).toContain('refresh-models');
    expect(help).toContain('Phase 1.1');
    for (const template of PROVIDER_TEMPLATES.filter(t => t.hidden)) {
      expect(help).not.toContain(template.id);
      expect(help).not.toContain(template.name);
    }
  });

  it('keeps hidden provider ids out of auth help', () => {
    const help = providerAuthHelpText();
    expect(help).toContain('github-copilot');
    expect(help).toContain('openai-oauth');
    expect(help).toContain('xai-oauth');
    for (const template of PROVIDER_TEMPLATES.filter(t => t.hidden)) {
      expect(help).not.toContain(template.id);
      expect(help).not.toContain(template.name);
    }
  });

  it('returns provider:id for all entries', () => {
    expect(providerHubChoiceValue({
      id: 'zen',
      name: 'OpenCode Zen',
      modelCount: 6,
      enabled: true,
      authLabel: 'keychain',
      inRegistry: true,
    })).toBe('provider:zen');
    expect(providerHubChoiceValue({
      id: 'groq',
      name: 'Groq',
      modelCount: 3,
      enabled: true,
      authLabel: 'keychain',
      inRegistry: true,
    })).toBe('provider:groq');
  });
});

describe('registry crud', () => {
  let home: string;
  const prevHome = process.env.RELAY_AI_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-ai-crud-'));
    process.env.RELAY_AI_HOME = home;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('adds zen stub once', () => {
    expect(addZenRegistryStub()).toEqual({ added: true });
    expect(addZenRegistryStub()).toEqual({ added: false, reason: 'OpenCode Zen is already configured.' });
    expect(loadRegistry().providers).toHaveLength(1);
  });

  it('toggles provider enabled state', () => {
    const registry = emptyRegistry();
    registry.providers.push(zenRegistryStub());
    saveRegistry(registry);

    expect(toggleProviderEnabled('zen')).toEqual({ toggled: true, enabled: false });
    expect(loadRegistry().providers[0]?.enabled).toBe(false);
  });

  it('removes provider and deletes non-global credentials', async () => {
    const registry = emptyRegistry();
    registry.providers.push({
      ...zenRegistryStub(),
      id: 'groq',
      templateId: 'groq',
      name: 'Groq',
      authRef: 'keyring:provider:groq',
    });
    saveRegistry(registry);

    const deleteSpy = vi.spyOn(env, 'deleteProviderCredential').mockResolvedValue(true);
    const result = await removeProviderFromRegistry('groq');
    expect(result.removed).toBe(true);
    expect(result.credentialDeleted).toBe(true);
    expect(loadRegistry().providers).toHaveLength(0);
    expect(deleteSpy).toHaveBeenCalledWith('keyring:provider:groq');
  });

  it('keeps global opencode credential when another provider still references it', async () => {
    const registry = emptyRegistry();
    registry.providers.push(zenRegistryStub(), {
      id: 'go',
      templateId: 'go',
      name: 'OpenCode Go',
      enabled: true,
      authRef: 'keyring:global:opencode',
      api: {},
      addedAt: new Date().toISOString(),
    });
    saveRegistry(registry);

    const deleteSpy = vi.spyOn(env, 'deleteProviderCredential').mockResolvedValue(true);
    const result = await removeProviderFromRegistry('zen');
    expect(result.removed).toBe(true);
    expect(result.credentialDeleted).toBe(false);
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(loadRegistry().providers).toHaveLength(1);
  });
});

describe('providers add menu', () => {
  let home: string;
  const prevHome = process.env.RELAY_AI_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-ai-providers-add-'));
    process.env.RELAY_AI_HOME = home;
    selectMock.mockReset();
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('shows native templates first, custom server second, and OpenCode import last', async () => {
    selectMock.mockResolvedValue('noop');

    await runProvidersAdd();

    const options = selectMock.mock.calls[0]?.[0].options.map(option => option.value);
    expect(options).toEqual(['templates', 'custom', 'import']);
  });
});
