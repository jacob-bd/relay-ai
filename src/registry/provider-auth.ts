// provider-auth.ts — relay-ai providers auth (native device-code + OpenCode broker)

import { printOAuthStepsPanel } from '../ui.js';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import open from 'open';
import { saveProviderCredential } from '../env.js';
import { runOpenAiDeviceCodeFlow } from '../oauth/openai.js';
import {
  supportsNativeOAuth,
  tokensToStoredCredential,
  type NativeOAuthProviderId,
} from '../oauth/types.js';
import { runXaiDeviceCodeFlow } from '../oauth/xai.js';
import { runGithubDeviceCodeFlow } from '../oauth/github.js';
import { getTemplateById } from '../provider-templates.js';
import { fetchRawOpencodeProviders } from '../opencode-serve.js';
import { findOpencodeBinary } from '../opencode-serve.js';
import { runOpencodeAuthBroker } from './auth-broker.js';
import { localProviderToRegistry } from './convert.js';
import { buildImportProviderList, oauthAuthRef, toOAuthRegistryId } from './import-build.js';
import { loadRegistry, saveRegistry } from './io.js';
import { oauthCredentialToKeychainJson, type OpencodeOAuthCredential } from './opencode-auth.js';
import { refreshProviderModels } from './refresh-models.js';
import type { RegistryProvider } from './types.js';

export type ProviderAuthMethod = 'native' | 'broker';

export interface ProviderAuthOptions {
  method?: ProviderAuthMethod;
  brokerMethod?: string;
}

export interface ProviderAuthResult {
  providerId: string;
  credential: OpencodeOAuthCredential;
  registryProvider: RegistryProvider;
}

const OPENAI_DISPLAY = 'OpenAI ChatGPT Plus/Pro';
const PROVIDER_DISPLAY: Record<NativeOAuthProviderId, string> = {
  xai: 'xAI Grok (SuperGrok)',
  'xai-oauth': 'xAI Grok (SuperGrok)',
  openai: OPENAI_DISPLAY,
  'openai-oauth': OPENAI_DISPLAY,
  'github-copilot': 'GitHub Copilot (Individual / Business)',
};

function openBrowser(url: string): void {
  open(url).catch(() => {});
}

async function runNativeDeviceCode(providerId: NativeOAuthProviderId): Promise<OpencodeOAuthCredential> {
  const label = PROVIDER_DISPLAY[providerId];
  printOAuthStepsPanel(`${label} — Sign in`, label);

  const spinner = p.spinner();
  spinner.start('Waiting for authorization...');

  try {
    if (providerId === 'xai' || providerId === 'xai-oauth') {
      const tokens = await runXaiDeviceCodeFlow(({ url, userCode }) => {
        spinner.stop('');
        p.log.info(`Visit: ${pc.cyan(url)}`);
        p.log.info(`Enter code: ${pc.bold(userCode)}`);
        openBrowser(url);
        spinner.start('Waiting for authorization...');
      });
      spinner.stop(pc.green('Signed in to xAI'));
      return tokensToStoredCredential(tokens);
    }

    if (providerId === 'github-copilot') {
      const tokens = await runGithubDeviceCodeFlow(({ url, userCode }) => {
        spinner.stop('');
        p.log.info(`Visit: ${pc.cyan(url)}`);
        p.log.info(`Enter code: ${pc.bold(userCode)}`);
        openBrowser(url);
        spinner.start('Waiting for authorization...');
      });
      spinner.stop(pc.green('Signed in to GitHub Copilot'));
      return tokensToStoredCredential(tokens);
    }

    const { tokens, accountId } = await runOpenAiDeviceCodeFlow(({ url, userCode }) => {
      spinner.stop('');
      p.log.info(`Visit: ${pc.cyan(url)}`);
      p.log.info(`Enter code: ${pc.bold(userCode)}`);
      openBrowser(url);
      spinner.start('Waiting for authorization...');
    });
    spinner.stop(pc.green('Signed in to OpenAI ChatGPT'));
    return tokensToStoredCredential(tokens, undefined, accountId);
  } catch (err) {
    spinner.stop('');
    throw err;
  }
}

async function upsertOAuthProvider(providerId: string, cred: OpencodeOAuthCredential): Promise<RegistryProvider> {
  const registryId = toOAuthRegistryId(providerId);
  const templateId = providerId.replace(/-oauth$/, '') || providerId;

  const registry = loadRegistry();
  const authRef = oauthAuthRef(registryId);
  let entry: RegistryProvider | undefined = registry.providers.find(pr => pr.id === registryId);

  if (!entry) {
    const raw = await fetchRawOpencodeProviders();
    if (raw) {
      const { providers } = buildImportProviderList(raw, { [providerId]: cred });
      const lp = providers.find(pr => pr.id === registryId || pr.id === providerId);
      if (lp) {
        const converted = localProviderToRegistry(lp, { authType: 'oauth', authRef });
        if (converted) entry = { ...converted, id: registryId, templateId };
      }
    }
  }

  if (!entry) {
    const template = getTemplateById(templateId);
    if (!template) {
      throw new Error(`Provider "${providerId}" is not in your registry and has no template`);
    }
    const displayName = registryId === 'openai-oauth' ? 'OpenAI (ChatGPT)' 
      : registryId === 'xai-oauth' ? 'xAI (SuperGrok)' 
      : template.name;
    entry = {
      id: registryId,
      templateId,
      name: displayName,
      enabled: true,
      authRef,
      authType: 'oauth',
      api: { npm: template.npm, url: template.defaultBaseUrl ?? '' },
      addedAt: new Date().toISOString(),
    };
  } else {
    entry = { ...entry, authType: 'oauth', authRef, templateId };
  }

  const idx = registry.providers.findIndex(pr => pr.id === registryId);
  if (idx >= 0) registry.providers[idx] = entry;
  else registry.providers.push(entry);
  saveRegistry(registry);
  return entry;
}

export async function authenticateProvider(
  providerId: string,
  options: ProviderAuthOptions = {},
): Promise<ProviderAuthResult> {
  const registryId = toOAuthRegistryId(providerId);

  if (!supportsNativeOAuth(providerId)) {
    if (findOpencodeBinary()) {
      const cred = await runOpencodeAuthBroker(providerId, { method: options.brokerMethod });
      const saved = await saveProviderCredential(oauthAuthRef(registryId), oauthCredentialToKeychainJson(cred));
      if (!saved) {
        p.log.warn('Could not save OAuth tokens to Keychain — session may not persist.');
      }
      const registryProvider = await upsertOAuthProvider(providerId, cred);
      return { providerId: registryId, credential: cred, registryProvider };
    }
    throw new Error(
      `Native OAuth is only built in for xai and openai. Install OpenCode for other OAuth providers.`,
    );
  }

  let method = options.method;
  if (!method) {
    const hasOpencode = findOpencodeBinary() !== null;
    if (hasOpencode) {
      const choice = await p.select({
        message: 'How would you like to sign in?',
        options: [
          { value: 'native', label: 'Device code (recommended)', hint: 'Works on SSH/VPS — open URL on any device' },
          { value: 'broker', label: 'Via OpenCode', hint: 'Uses opencode auth login' },
        ],
      });
      if (p.isCancel(choice)) throw new Error('Cancelled');
      method = choice as ProviderAuthMethod;
    } else {
      method = 'native';
    }
  }

  const cred = method === 'broker'
    ? await runOpencodeAuthBroker(providerId, { method: options.brokerMethod })
    : await runNativeDeviceCode(providerId);

  const saved = await saveProviderCredential(oauthAuthRef(registryId), oauthCredentialToKeychainJson(cred));
  if (!saved) {
    p.log.warn('Could not save OAuth tokens to Keychain — session may not persist.');
  }

  const registryProvider = await upsertOAuthProvider(providerId, cred);

  const refreshSpinner = p.spinner();
  refreshSpinner.start('Refreshing model list...');
  try {
    await refreshProviderModels(registryId, cred.access);
    refreshSpinner.stop('Models refreshed');
  } catch {
    refreshSpinner.stop('Could not refresh models — run relay-ai providers refresh-models later');
  }

  return { providerId: registryId, credential: cred, registryProvider };
}

export function providerAuthHelpText(): string {
  return `${pc.bold('relay-ai providers auth')} — sign in with OAuth

${pc.bold('Usage:')}
  relay-ai providers auth <id>
  relay-ai providers auth xai --native
  relay-ai providers auth openai --broker
  relay-ai providers auth github-copilot

${pc.bold('Options:')}
  --native    Use built-in device-code flow (xai, openai, github-copilot)
  --broker    Delegate to OpenCode auth login

${pc.bold('Supported native OAuth:')}
  xai              SuperGrok / X Premium (device code at x.ai/device)
  openai           ChatGPT Plus/Pro (device code at auth.openai.com/codex/device)
  github-copilot   GitHub Copilot Individual/Business (device code at github.com/login/device)`;
}
