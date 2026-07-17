import { CONFLICTING_ENV_VARS } from '../constants.js';

const PROXY_ENV_NAMES = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
] as const;
const ANTHROPIC_PROXY_HOST = 'api.anthropic.com';

export interface InheritedProxy {
  name: typeof PROXY_ENV_NAMES[number];
  value: string;
}

export function unsupportedInheritedProxyError(proxy: InheritedProxy): Error {
  return new Error(
    `An existing ${proxy.name} network proxy was detected. `
    + 'Chaining Relay AI through an existing network proxy is not yet supported.',
  );
}

function noProxyEntryBypassesAnthropic(rawEntry: string): boolean {
  let entry = rawEntry.trim().toLowerCase();
  if (!entry) return false;
  if (entry === '*') return true;
  if (entry.includes('://')) {
    try {
      entry = new URL(entry).hostname;
    } catch {
      return false;
    }
  } else if (entry.startsWith('[')) {
    entry = entry.slice(1, entry.indexOf(']') === -1 ? undefined : entry.indexOf(']'));
  } else {
    entry = entry.replace(/:\d+$/, '');
  }
  if (entry.startsWith('*')) return ANTHROPIC_PROXY_HOST.endsWith(entry.slice(1));
  if (entry.startsWith('.')) return ANTHROPIC_PROXY_HOST.endsWith(entry);
  return entry === ANTHROPIC_PROXY_HOST || ANTHROPIC_PROXY_HOST.endsWith(`.${entry}`);
}

function sanitizeNoProxy(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const safeEntries = value
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry && !noProxyEntryBypassesAnthropic(entry));
  return safeEntries.length > 0 ? safeEntries.join(',') : undefined;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return normalized === 'localhost'
    || normalized === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

export function findUnsupportedInheritedProxy(
  env: NodeJS.ProcessEnv,
): InheritedProxy | undefined {
  for (const name of PROXY_ENV_NAMES) {
    const value = env[name]?.trim();
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
        || !isLoopbackHost(parsed.hostname)) {
        return { name, value };
      }
    } catch {
      return { name, value };
    }
  }
  return undefined;
}

export function buildHttpProxyChildEnv(
  baseEnv: NodeJS.ProcessEnv,
  proxyUrl: string,
  caCertPath: string,
): NodeJS.ProcessEnv {
  const unsupported = findUnsupportedInheritedProxy(baseEnv);
  if (unsupported) {
    throw unsupportedInheritedProxyError(unsupported);
  }

  const env: NodeJS.ProcessEnv = { ...baseEnv };
  env['HTTPS_PROXY'] = proxyUrl;
  env['HTTP_PROXY'] = proxyUrl;
  env['https_proxy'] = proxyUrl;
  env['http_proxy'] = proxyUrl;
  delete env['ALL_PROXY'];
  delete env['all_proxy'];
  const noProxy = sanitizeNoProxy(env['NO_PROXY']);
  const lowerNoProxy = sanitizeNoProxy(env['no_proxy']);
  if (noProxy) env['NO_PROXY'] = noProxy;
  else delete env['NO_PROXY'];
  if (lowerNoProxy) env['no_proxy'] = lowerNoProxy;
  else delete env['no_proxy'];
  env['NODE_EXTRA_CA_CERTS'] = caCertPath;

  // Preserve the user's native Anthropic API key/OAuth state, while removing
  // stale third-party endpoint/model overrides for this child process only.
  for (const name of CONFLICTING_ENV_VARS) {
    if (name === 'ANTHROPIC_API_KEY' || name === 'ANTHROPIC_AUTH_TOKEN') continue;
    delete env[name];
  }
  return env;
}
