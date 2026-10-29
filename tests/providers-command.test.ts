import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseProvidersArgs, providerHubChoiceValue, providersHelpText, runProvidersAdd, runProvidersHub, runProvidersRename } from '../src/providers-command.js';
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
import * as addTemplate from '../src/registry/add-template.js';
import * as providerAuth from '../src/registry/provider-auth.js';
import { runProvidersAuth } from '../src/providers-command.js';

const selectMock = vi.hoisted(() => vi.fn());
const textMock = vi.hoisted(() => vi.fn());
const passwordMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn());
const spinnerMock = vi.hoisted(() => vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })));

vi.mock('@clack/prompts', async importOriginal => {
  const actual = await importOriginal<typeof import('@clack/prompts')>();
  return {
    ...actual,
    select: selectMock,
    text: textMock,
    password: passwordMock,
    confirm: confirmMock,
    spinner: spinnerMock,
  };
});

describe('parseProvidersArgs', () => {
  it('defaults to hub', () => {
    expect(parseProvidersArgs([])).toEqual({ subcommand: 'hub', showHelp: false });
  });

  it('parses add, import, list, remove, refresh-models', () => {
    expect(parseProvidersArgs(['add'])).toEqual({ subcommand: 'add', showHelp: false });
    expect(parseProvidersArgs(['add', 'vertex-anthropic'])).toEqual({ subcommand: 'add', showHelp: false, addTemplateId: 'vertex-anthropic' });
    expect(parseProvidersArgs(['add', '--bogus']).error).toBe('Unknown add option: --bogus');
    expect(parseProvidersArgs(['add', 'a', 'b']).error).toBe('Unknown add option: b');
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

  it('parses rename with a multi-word name', () => {
    expect(parseProvidersArgs(['rename', 'openai-oauth', 'Personal', 'ChatGPT'])).toEqual({
      subcommand: 'rename',
      showHelp: false,
      removeId: 'openai-oauth',
      renameName: 'Personal ChatGPT',
    });
  });

  it('reports rename without id or name', () => {
    expect(parseProvidersArgs(['rename']).error).toContain('Usage');
    expect(parseProvidersArgs(['rename', 'groq']).error).toContain('Usage');
  });

  it('lists rename in help text', () => {
    expect(providersHelpText()).toContain('providers rename');
  });

  it('parses add <id> --new as adding another account for that provider', () => {
    expect(parseProvidersArgs(['add', 'groq', '--new'])).toEqual({ subcommand: 'add', showHelp: false, addTemplateId: 'groq', addAccount: true });
    expect(parseProvidersArgs(['add', '--new', 'groq'])).toEqual({ subcommand: 'add', showHelp: false, addTemplateId: 'groq', addAccount: true });
    expect(parseProvidersArgs(['add', '--new']).error).toMatch(/Usage/);
    expect(parseProvidersArgs(['add', 'groq', '--bogus']).error).toBe('Unknown add option: --bogus');
  });

  it('documents add --new in the help', () => {
    expect(providersHelpText()).toContain('providers add [id] [--new]');
  });

  it('parses auth --new as adding another account', () => {
    expect(parseProvidersArgs(['auth', 'openai-oauth', '--new'])).toEqual({
      subcommand: 'auth',
      showHelp: false,
      removeId: 'openai-oauth',
      authMethod: undefined,
      addAccount: true,
    });
  });

  it('documents auth --new in the auth help', () => {
    expect(providerAuthHelpText()).toContain('--new');
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
    for (const template of PROVIDER_TEMPLATES.filter(t => t.hidden && t.id !== 'antigravity')) {
      expect(help).not.toContain(template.id);
      expect(help).not.toContain(template.name);
    }
  });

  it('keeps hidden provider ids out of auth help', () => {
    const help = providerAuthHelpText();
    expect(help).toContain('github-copilot');
    expect(help).toContain('openai-oauth');
    expect(help).toContain('xai-oauth');
    expect(help).toContain('antigravity');
    for (const template of PROVIDER_TEMPLATES.filter(t => t.hidden && t.id !== 'antigravity')) {
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
    textMock.mockReset();
    passwordMock.mockReset();
    spinnerMock.mockClear();
    vi.spyOn(addTemplate, 'addProviderFromTemplate').mockResolvedValue({ added: true, modelCount: 12 });
    vi.spyOn(providerAuth, 'authenticateProvider').mockResolvedValue({ registryProvider: { name: 'ClinePass' } } as never);
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

  it('offers OAuth after selecting ClinePass and does not use the API-key path', async () => {
    selectMock
      .mockResolvedValueOnce('templates')
      .mockResolvedValueOnce('search')
      .mockResolvedValueOnce('cline-pass')
      .mockResolvedValueOnce('oauth');
    textMock.mockResolvedValue('cline');

    await runProvidersAdd();

    expect(providerAuth.authenticateProvider).toHaveBeenCalledWith('cline-pass', { method: undefined });
    expect(addTemplate.addProviderFromTemplate).not.toHaveBeenCalled();
  });

  it('offers API key after selecting ClinePass and adds it as the same provider', async () => {
    selectMock
      .mockResolvedValueOnce('templates')
      .mockResolvedValueOnce('search')
      .mockResolvedValueOnce('cline-pass')
      .mockResolvedValueOnce('api');
    textMock.mockResolvedValue('cline');
    passwordMock.mockResolvedValue('cline-api-key');

    await runProvidersAdd();

    expect(addTemplate.addProviderFromTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cline-pass' }),
      'cline-api-key',
      { replaceExisting: false },
    );
    expect(providerAuth.authenticateProvider).not.toHaveBeenCalled();
  });

  it('keeps the hub failure status when an API-key add fails', async () => {
    selectMock
      .mockResolvedValueOnce('add')
      .mockResolvedValueOnce('templates')
      .mockResolvedValueOnce('search')
      .mockResolvedValueOnce('cline-pass')
      .mockResolvedValueOnce('api')
      .mockResolvedValueOnce('done');
    textMock.mockResolvedValue('cline');
    passwordMock.mockResolvedValue('rejected-api-key');
    vi.mocked(addTemplate.addProviderFromTemplate).mockResolvedValueOnce({
      added: false,
      error: 'API key was rejected.',
      hint: 'Verify your key at https://app.cline.bot',
    });

    await expect(runProvidersHub()).resolves.toBe(1);
  });

  it('allows an existing ClinePass provider to switch to a new API key', async () => {
    saveRegistry({
      schemaVersion: 1,
      providers: [{
        id: 'cline-pass',
        templateId: 'cline-pass',
        name: 'ClinePass',
        enabled: true,
        authType: 'oauth',
        authRef: 'keyring:oauth:provider:cline-pass',
        api: { npm: '@ai-sdk/openai-compatible', url: 'https://api.cline.bot/api/v1' },
        addedAt: new Date().toISOString(),
      }],
    });
    selectMock
      .mockResolvedValueOnce('provider:cline-pass')
      .mockResolvedValueOnce('change-auth')
      .mockResolvedValueOnce('api')
      .mockResolvedValueOnce('done');
    passwordMock.mockResolvedValue('replacement-api-key');

    await runProvidersHub();

    expect(addTemplate.addProviderFromTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cline-pass' }),
      'replacement-api-key',
      { replaceExisting: true },
    );
  });

  it('allows an existing ClinePass provider to switch to OAuth', async () => {
    saveRegistry({
      schemaVersion: 1,
      providers: [{
        id: 'cline-pass',
        templateId: 'cline-pass',
        name: 'ClinePass',
        enabled: true,
        authType: 'api',
        authRef: 'keyring:provider:cline-pass',
        api: { npm: '@ai-sdk/openai-compatible', url: 'https://api.cline.bot/api/v1' },
        addedAt: new Date().toISOString(),
      }],
    });
    selectMock
      .mockResolvedValueOnce('provider:cline-pass')
      .mockResolvedValueOnce('change-auth')
      .mockResolvedValueOnce('oauth')
      .mockResolvedValueOnce('done');

    await runProvidersHub();

    expect(providerAuth.authenticateProvider).toHaveBeenCalledWith('cline-pass', { method: undefined });
  });
});

describe('runProvidersRename', () => {
  let home: string;
  const prevHome = process.env.RELAY_AI_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-ai-rename-'));
    process.env.RELAY_AI_HOME = home;
    const registry = emptyRegistry();
    const zen = zenRegistryStub();
    registry.providers.push(zen, { ...zen, id: 'go', name: 'OpenCode Go', authRef: zen.authRef });
    saveRegistry(registry);
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('renames a provider and returns 0', async () => {
    expect(await runProvidersRename('zen', 'Work Zen')).toBe(0);
    expect(loadRegistry().providers.find(pr => pr.id === 'zen')?.name).toBe('Work Zen');
  });

  it('returns 1 for a taken name or unknown id and changes nothing', async () => {
    expect(await runProvidersRename('zen', 'opencode go')).toBe(1);
    expect(await runProvidersRename('nope', 'X')).toBe(1);
    expect(loadRegistry().providers.find(pr => pr.id === 'zen')?.name).toBe('OpenCode Zen');
  });
});

describe('provider menu: several OAuth accounts', () => {
  let home: string;
  const prevHome = process.env.RELAY_AI_HOME;

  const oauthEntry = (id: string, templateId: string, name: string) => ({
    id,
    templateId,
    name,
    enabled: true,
    authType: 'oauth' as const,
    authRef: `keyring:oauth:provider:${id}`,
    api: { npm: '@ai-sdk/openai', url: '' },
    addedAt: '2026-01-01T00:00:00.000Z',
    modelsCache: { fetchedAt: '2026-01-01T00:00:00.000Z', models: [{ id: 'm', name: 'M', upstreamModelId: 'm', modelFormat: 'openai' as const, npm: '@ai-sdk/openai' }] },
  });
  const detailOptions = () => selectMock.mock.calls.find(call => call[0].message === 'What would you like to do?')?.[0].options.map((o: { value: string }) => o.value) as string[];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-ai-multi-oauth-'));
    process.env.RELAY_AI_HOME = home;
    selectMock.mockReset();
    textMock.mockReset();
    spinnerMock.mockClear();
    vi.spyOn(providerAuth, 'authenticateProvider').mockResolvedValue({ registryProvider: { name: 'ChatGPT' } } as never);
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('offers "Add another account" for a ChatGPT sign-in and starts a new account', async () => {
    saveRegistry({ schemaVersion: 1, providers: [oauthEntry('openai-oauth', 'openai', 'OpenAI (ChatGPT)')] });
    selectMock.mockResolvedValueOnce('provider:openai-oauth').mockResolvedValueOnce('add-account').mockResolvedValueOnce('done');

    await runProvidersHub();

    expect(detailOptions()).toContain('add-account');
    expect(providerAuth.authenticateProvider).toHaveBeenCalledWith('openai-oauth', { method: undefined, addAccount: true });
  });

  it('adding from a numbered account still adds under the provider kind', async () => {
    saveRegistry({ schemaVersion: 1, providers: [oauthEntry('openai-oauth', 'openai', 'OpenAI (ChatGPT)'), oauthEntry('openai-oauth-2', 'openai', 'Personal')] });
    selectMock.mockResolvedValueOnce('provider:openai-oauth-2').mockResolvedValueOnce('add-account').mockResolvedValueOnce('done');

    await runProvidersHub();

    expect(providerAuth.authenticateProvider).toHaveBeenCalledWith('openai-oauth', { method: undefined, addAccount: true });
  });

  it('"Sign in again" on a numbered account re-signs that account', async () => {
    saveRegistry({ schemaVersion: 1, providers: [oauthEntry('openai-oauth', 'openai', 'OpenAI (ChatGPT)'), oauthEntry('openai-oauth-2', 'openai', 'Personal')] });
    selectMock.mockResolvedValueOnce('provider:openai-oauth-2').mockResolvedValueOnce('auth').mockResolvedValueOnce('done');

    await runProvidersHub();

    expect(providerAuth.authenticateProvider).toHaveBeenCalledWith('openai-oauth-2', { method: undefined });
  });

  it.each([['antigravity', 'Antigravity'], ['claude-code', 'Claude Code (Anthropic subscription)']])('offers "Add another account" for %s too', async (id, name) => {
    saveRegistry({ schemaVersion: 1, providers: [oauthEntry(id, id, name)] });
    selectMock.mockResolvedValueOnce(`provider:${id}`).mockResolvedValueOnce('add-account').mockResolvedValueOnce('done');

    await runProvidersHub();

    expect(detailOptions()).toContain('add-account');
    expect(providerAuth.authenticateProvider).toHaveBeenCalledWith(id, { method: undefined, addAccount: true });
  });


  describe('"Sign in with OAuth" screen', () => {
    const optionValues = () => selectMock.mock.calls.find(call => call[0].message === 'Which provider?')?.[0].options.map((o: { value: string }) => o.value) as string[] | undefined;
    const allConfigured = () => saveRegistry({ schemaVersion: 1, providers: [
      oauthEntry('github-copilot', 'github-copilot', 'GitHub Copilot'),
      oauthEntry('openai-oauth', 'openai', 'OpenAI (ChatGPT)'),
      oauthEntry('xai-oauth', 'xai', 'xAI (SuperGrok)'),
    ] });

    it('still offers another account when every OAuth provider is already configured', async () => {
      allConfigured();
      selectMock.mockResolvedValueOnce('auth-menu').mockResolvedValueOnce('add:openai-oauth').mockResolvedValueOnce('done');

      await runProvidersHub();

      expect(optionValues()).toEqual(expect.arrayContaining(['add:github-copilot', 'add:openai-oauth', 'add:xai-oauth']));
      expect(providerAuth.authenticateProvider).toHaveBeenCalledWith('openai-oauth', { method: undefined, addAccount: true });
    });

    it('offers first sign-ins for providers that are not configured yet', async () => {
      saveRegistry({ schemaVersion: 1, providers: [oauthEntry('openai-oauth', 'openai', 'OpenAI (ChatGPT)')] });
      selectMock.mockResolvedValueOnce('auth-menu').mockResolvedValueOnce('new:xai-oauth').mockResolvedValueOnce('done');

      await runProvidersHub();

      expect(optionValues()).toEqual(expect.arrayContaining(['new:xai-oauth', 'new:github-copilot', 'add:openai-oauth']));
      expect(optionValues()).not.toContain('new:openai-oauth');
      expect(providerAuth.authenticateProvider).toHaveBeenCalledWith('xai-oauth', { method: undefined });
    });
  });
});

describe('runProvidersAuth: confirm before replacing a sign-in', () => {
  let home: string;
  const prevHome = process.env.RELAY_AI_HOME;
  const prevTty = process.stdin.isTTY;
  const entry = {
    id: 'claude-code', templateId: 'claude-code', name: 'Claude Work', enabled: true, authType: 'oauth' as const,
    authRef: 'keyring:oauth:provider:claude-code', api: { npm: '@ai-sdk/anthropic', url: '' }, addedAt: '2026-01-01T00:00:00.000Z',
  };
  const storedCredential = { type: 'oauth' as const, access: 'a', refresh: 'r', expires: Date.now() + 1000, accountId: 'work@example.com', providerData: { identity: { email: 'work@example.com' } } };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-ai-replace-'));
    process.env.RELAY_AI_HOME = home;
    confirmMock.mockReset();
    saveRegistry({ schemaVersion: 1, providers: [entry] });
    vi.spyOn(providerAuth, 'authenticateProvider').mockResolvedValue({ registryProvider: { name: 'Claude Work' } } as never);
    vi.spyOn(env, 'readStoredOAuthCredential').mockResolvedValue(storedCredential);
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prevHome;
    Object.defineProperty(process.stdin, 'isTTY', { value: prevTty, configurable: true });
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('asks first, naming the provider and the account it would overwrite, and stops on "no"', async () => {
    confirmMock.mockResolvedValue(false);

    expect(await runProvidersAuth('claude-code')).toBe(0);

    const message = confirmMock.mock.calls[0]?.[0].message as string;
    expect(message).toContain('Claude Work');
    expect(message).toContain('work@example.com');
    expect(message).toMatch(/Add another account/);
    expect(confirmMock.mock.calls[0]?.[0].initialValue).toBe(false);
    expect(providerAuth.authenticateProvider).not.toHaveBeenCalled();
  });

  it('signs in again after "yes"', async () => {
    confirmMock.mockResolvedValue(true);
    await runProvidersAuth('claude-code');
    expect(providerAuth.authenticateProvider).toHaveBeenCalledWith('claude-code', { method: undefined });
  });

  it('does not ask when adding another account', async () => {
    await runProvidersAuth('claude-code', undefined, { addAccount: true });
    expect(confirmMock).not.toHaveBeenCalled();
    expect(providerAuth.authenticateProvider).toHaveBeenCalled();
  });

  it('does not ask when nothing is stored to overwrite', async () => {
    vi.spyOn(env, 'readStoredOAuthCredential').mockResolvedValue(undefined);
    await runProvidersAuth('claude-code');
    expect(confirmMock).not.toHaveBeenCalled();
    expect(providerAuth.authenticateProvider).toHaveBeenCalled();
  });

  it('does not ask for a provider that is not set up yet', async () => {
    saveRegistry({ schemaVersion: 1, providers: [] });
    await runProvidersAuth('claude-code');
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('never prompts without a terminal (scripts must not hang)', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });
    await runProvidersAuth('claude-code');
    expect(confirmMock).not.toHaveBeenCalled();
    expect(providerAuth.authenticateProvider).toHaveBeenCalled();
  });
});

describe('provider menu: several API-key accounts', () => {
  let home: string;
  const prevHome = process.env.RELAY_AI_HOME;
  const apiEntry = (id: string, templateId: string, name: string, over: Record<string, unknown> = {}) => ({
    id, templateId, name, enabled: true, authType: 'api' as const, authRef: `keyring:provider:${id}`,
    api: { npm: '@ai-sdk/groq', url: 'https://api.groq.com/openai/v1' }, addedAt: '2026-01-01T00:00:00.000Z',
    modelsCache: { fetchedAt: '2026-01-01T00:00:00.000Z', models: [{ id: 'm', name: 'M', upstreamModelId: 'm', modelFormat: 'openai' as const, npm: '@ai-sdk/groq' }] },
    ...over,
  });
  const detailOptions = () => selectMock.mock.calls.find(call => call[0].message === 'What would you like to do?')?.[0].options.map((o: { value: string }) => o.value) as string[];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-ai-multi-key-'));
    process.env.RELAY_AI_HOME = home;
    selectMock.mockReset();
    textMock.mockReset();
    passwordMock.mockReset();
    spinnerMock.mockClear();
    vi.spyOn(addTemplate, 'addProviderFromTemplate').mockResolvedValue({ added: true, modelCount: 3, provider: { name: 'Groq 2' } as never });
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('offers "Add another account" for an API-key provider and adds it as a new account', async () => {
    saveRegistry({ schemaVersion: 1, providers: [apiEntry('groq', 'groq', 'Groq')] });
    selectMock.mockResolvedValueOnce('provider:groq').mockResolvedValueOnce('add-account').mockResolvedValueOnce('done');
    passwordMock.mockResolvedValue('second-key');

    await runProvidersHub();

    expect(detailOptions()).toContain('add-account');
    expect(addTemplate.addProviderFromTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'groq' }),
      'second-key',
      { baseUrl: undefined, addAccount: true },
    );
  });

  it('adding from a numbered account still adds under the provider template', async () => {
    saveRegistry({ schemaVersion: 1, providers: [apiEntry('groq', 'groq', 'Groq'), apiEntry('groq-2', 'groq', 'Work Groq')] });
    selectMock.mockResolvedValueOnce('provider:groq-2').mockResolvedValueOnce('add-account').mockResolvedValueOnce('done');
    passwordMock.mockResolvedValue('third-key');

    await runProvidersHub();

    expect(addTemplate.addProviderFromTemplate).toHaveBeenCalledWith(expect.objectContaining({ id: 'groq' }), 'third-key', { baseUrl: undefined, addAccount: true });
  });

  it.each([
    ['custom-acme', 'custom-openai', 'Acme'],
    ['vertex-anthropic', 'vertex-anthropic', 'Google Vertex AI (Claude)'],
  ])('does not offer it for %s', async (id, templateId, name) => {
    saveRegistry({ schemaVersion: 1, providers: [apiEntry(id, templateId, name)] });
    selectMock.mockResolvedValueOnce(`provider:${id}`).mockResolvedValueOnce('back').mockResolvedValueOnce('done');

    await runProvidersHub();

    expect(detailOptions()).not.toContain('add-account');
  });

  it('offers "Add another account" on OpenCode Zen and asks for its own key (never reuses the global one)', async () => {
    saveRegistry({ schemaVersion: 1, providers: [apiEntry('zen', 'zen', 'OpenCode Zen')] });
    selectMock.mockResolvedValueOnce('provider:zen').mockResolvedValueOnce('add-account').mockResolvedValueOnce('done');
    passwordMock.mockResolvedValue('second-opencode-key');
    vi.mocked(addTemplate.addProviderFromTemplate).mockResolvedValue({ added: true, modelCount: 6, addedNames: ['OpenCode Zen 2', 'OpenCode Go 2'] });

    await runProvidersHub();

    expect(detailOptions()).toContain('add-account');
    expect(passwordMock).toHaveBeenCalled();
    expect(addTemplate.addProviderFromTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'zen' }),
      'second-opencode-key',
      { baseUrl: undefined, addAccount: true },
    );
  });

  it('providers add <id> --new works even though that provider is already configured', async () => {
    saveRegistry({ schemaVersion: 1, providers: [apiEntry('groq', 'groq', 'Groq')] });
    passwordMock.mockResolvedValue('another-key');

    expect(await runProvidersAdd('groq', { addAccount: true })).toBe(0);

    expect(addTemplate.addProviderFromTemplate).toHaveBeenCalledWith(expect.objectContaining({ id: 'groq' }), 'another-key', { baseUrl: undefined, addAccount: true });
  });

  it('providers add <id> without --new still refuses an already configured provider', async () => {
    saveRegistry({ schemaVersion: 1, providers: [apiEntry('groq', 'groq', 'Groq')] });
    expect(await runProvidersAdd('groq')).toBe(1);
    expect(addTemplate.addProviderFromTemplate).not.toHaveBeenCalled();
  });

  it('refuses --new for a provider that cannot have a second account', async () => {
    expect(await runProvidersAdd('opencode-cloud', { addAccount: true })).toBe(1);
    expect(addTemplate.addProviderFromTemplate).not.toHaveBeenCalled();
  });
});
