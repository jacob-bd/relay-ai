// provider-auth.ts — relay-ai providers auth (native device-code + OpenCode broker)

import { printOAuthStepsPanel, confirmSubscriptionOAuthRisk } from '../ui.js';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import open from 'open';
import { saveProviderCredential } from '../env.js';
import { runOpenAiDeviceCodeFlow } from '../oauth/openai.js';
import {
  supportsNativeOAuth,
  isBrowserRedirectOAuth,
  tokensToStoredCredential,
  type NativeOAuthProviderId,
} from '../oauth/types.js';
import { runXaiDeviceCodeFlow } from '../oauth/xai.js';
import { runGithubDeviceCodeFlow } from '../oauth/github.js';
import {
  runClaudeCodeOAuthFlow,
  generateCliUserID,
} from '../oauth/claude-code.js';
import { runAntigravityOAuthFlow } from '../oauth/antigravity-oauth.js';
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

export type { OpencodeOAuthCredential } from './opencode-auth.js';

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
  'github-copilot': 'GitHub Copilot',
  'claude-code': 'Claude Code (Anthropic subscription)',
  antigravity: 'Antigravity (Google Cloud Code Assist)',
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

async function runNativeBrowserOAuth(providerId: NativeOAuthProviderId): Promise<OpencodeOAuthCredential> {
  if (providerId !== 'claude-code' && providerId !== 'antigravity') {
    throw new Error(`Browser OAuth for "${providerId}" is not yet implemented.`);
  }

  const confirmed = await confirmSubscriptionOAuthRisk(providerId);
  if (!confirmed) throw new Error('Cancelled');

  if (providerId === 'claude-code') {
    const spinner = p.spinner();
    spinner.start('Opening browser for Anthropic sign-in…');
    try {
      const { tokens, bootstrap } = await runClaudeCodeOAuthFlow((url) => {
        spinner.stop('');
        p.log.info(`Opening: ${pc.cyan(url)}`);
      }, async () => {
        const code = await p.text({
          message: 'Paste the authorization code or callback URL from Anthropic',
          placeholder: 'code from browser',
          validate: (value) => value.trim() ? undefined : 'Authorization code is required',
        });
        if (p.isCancel(code)) throw new Error('Cancelled');
        spinner.start('Exchanging authorization code…');
        return code;
      });
      spinner.stop(pc.green('Signed in to Claude Code'));

      const providerData: Record<string, unknown> = { cliUserID: generateCliUserID() };
      if (bootstrap.accountId) providerData.accountUUID = bootstrap.accountId;
      if (bootstrap.organizationId) providerData.organizationUUID = bootstrap.organizationId;
      if (bootstrap.organizationName) providerData.organizationName = bootstrap.organizationName;
      if (bootstrap.plan) providerData.plan = bootstrap.plan;

      return tokensToStoredCredential(tokens, undefined, bootstrap.accountId, providerData);
    } catch (err) {
      spinner.stop('');
      throw err;
    }
  }

  // Antigravity OAuth
  const spinner = p.spinner();
  spinner.start('Opening browser for Google sign-in…');
  try {
    const { tokens, userInfo, projectId, tierId } = await runAntigravityOAuthFlow((url) => {
      spinner.stop('');
      p.log.info(`Opening: ${pc.cyan(url)}`);
      spinner.start('Waiting for authorization…');
    });
    spinner.stop(pc.green('Signed in to Antigravity'));

    const providerData: Record<string, unknown> = {};
    if (projectId) providerData.projectId = projectId;
    if (tierId) providerData.tier = tierId;

    return tokensToStoredCredential(tokens, undefined, userInfo.email, providerData);
  } catch (err) {
    spinner.stop('');
    throw err;
  }
}

export async function saveNativeOAuthCredential(
  providerId: string,
  tokens: import('../oauth/types.js').OAuthTokenResponse,
  accountId?: string,
  providerData?: Record<string, unknown>,
): Promise<void> {
  const cred = tokensToStoredCredential(tokens, undefined, accountId, providerData);
  const registryId = toOAuthRegistryId(providerId);
  let diagMsg = '';
  const saved = await saveProviderCredential(
    oauthAuthRef(registryId),
    oauthCredentialToKeychainJson(cred),
    (msg) => { diagMsg = msg; },
  );
  if (!saved) throw new Error(`Could not save OAuth tokens to credential store${diagMsg ? ` — ${diagMsg}` : ' — grant Keychain access or check RELAY_AI_HOME is writable'}`);
  await upsertOAuthProvider(providerId, cred);
}

/**
 * OAuth providers that share a templateId with an API-key provider (xai, openai)
 * need a distinguishing display name so the two don't show identically in
 * pickers. Applied regardless of which path builds the registry entry below.
 */
function oauthDisplayName(registryId: string, fallbackName: string): string {
  if (registryId === 'openai-oauth') return 'OpenAI (ChatGPT)';
  if (registryId === 'xai-oauth') return 'xAI (SuperGrok)';
  return fallbackName;
}

async function upsertOAuthProvider(providerId: string, cred: OpencodeOAuthCredential): Promise<RegistryProvider> {
  const registryId = toOAuthRegistryId(providerId);
  const templateId = providerId.replace(/-oauth$/, '') || providerId;

  const registry = loadRegistry();
  const authRef = oauthAuthRef(registryId);
  const template = getTemplateById(templateId);
  let entry: RegistryProvider | undefined = registry.providers.find(pr => pr.id === registryId);

  if (!entry) {
    const raw = await fetchRawOpencodeProviders();
    if (raw) {
      const { providers } = buildImportProviderList(raw, { [providerId]: cred });
      const lp = providers.find(pr => pr.id === registryId || pr.id === providerId);
      if (lp) {
        const converted = localProviderToRegistry(lp, { authType: 'oauth', authRef });
        if (converted) {
          entry = {
            ...converted,
            id: registryId,
            templateId,
            name: oauthDisplayName(registryId, converted.name),
            api: {
              ...converted.api,
              ...(template?.headers ? { headers: { ...template.headers, ...converted.api.headers } } : {}),
            },
          };
        }
      }
    }
  }

  if (!entry) {
    if (!template) {
      throw new Error(`Provider "${providerId}" is not in your registry and has no template`);
    }
    const displayName = oauthDisplayName(registryId, template.name);
    entry = {
      id: registryId,
      templateId,
      name: displayName,
      enabled: true,
      authRef,
      authType: 'oauth',
      api: {
        npm: template.npm,
        url: template.defaultBaseUrl ?? '',
        ...(template.headers ? { headers: template.headers } : {}),
      },
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
      let brokerDiagMsg = '';
      const saved = await saveProviderCredential(
        oauthAuthRef(registryId),
        oauthCredentialToKeychainJson(cred),
        (msg) => { brokerDiagMsg = msg; },
      );
      if (!saved) {
        p.log.warn(`Could not save OAuth tokens — ${brokerDiagMsg || 'session may not persist.'}`);
      }
      const registryProvider = await upsertOAuthProvider(providerId, cred);
      return { providerId: registryId, credential: cred, registryProvider };
    }
    throw new Error(
      `Native OAuth is only built in for xai and openai. Install OpenCode for other OAuth providers.`,
    );
  }

  let method = options.method;
  if (isBrowserRedirectOAuth(providerId)) {
    if (method === 'broker') {
      throw new Error(`Via OpenCode is not supported for "${providerId}". Use the built-in OAuth flow.`);
    }
    method = 'native';
  }
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
    : isBrowserRedirectOAuth(providerId)
      ? await runNativeBrowserOAuth(providerId)
      : await runNativeDeviceCode(providerId);

  let nativeDiagMsg = '';
  const saved = await saveProviderCredential(
    oauthAuthRef(registryId),
    oauthCredentialToKeychainJson(cred),
    (msg) => { nativeDiagMsg = msg; },
  );
  if (!saved) {
    p.log.warn(`Could not save OAuth tokens — ${nativeDiagMsg || 'session may not persist.'}`);
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
  relay-ai providers auth xai-oauth --native
  relay-ai providers auth openai --broker
  relay-ai providers auth github-copilot

${pc.bold('Options:')}
  --native    Use built-in OAuth flow
  --broker    Delegate to OpenCode auth login

${pc.bold('Device code (works on SSH/VPS):')}
  xai-oauth        SuperGrok / X Premium (device code at x.ai/device)
  openai-oauth     ChatGPT Plus/Pro (device code at auth.openai.com/codex/device)
  github-copilot   GitHub Copilot Free or paid (device code at github.com/login/device)`;
}
