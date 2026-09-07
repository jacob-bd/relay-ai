import {
  buildClaudeCodeBillingSystemLine,
  injectClaudeIdentity,
  selectBetaFlags,
} from './claude-identity.js';

export interface ClaudeCodeOAuthIdentityInput {
  providerId?: string;
  authType?: 'api' | 'oauth' | 'none';
  oauthAccountId?: string;
  apiKey: string;
  providerData?: Record<string, unknown>;
  upstreamModelId?: string;
}

export interface ClaudeCodeOAuthSdkParams {
  instructions?: string;
  tools?: Record<string, unknown>;
  providerOptions?: Record<string, Record<string, unknown>>;
}

export function isClaudeCodeOAuthRoute(input: ClaudeCodeOAuthIdentityInput): boolean {
  return input.providerId === 'claude-code' && input.authType === 'oauth';
}

function prependClaudeCodeBillingLine(system: string | undefined): string {
  const line = buildClaudeCodeBillingSystemLine();
  if (!system?.trim()) return line;
  if (system.startsWith(line)) return system;
  return `${line}\n\n${system}`;
}

function mergeProviderOptions(
  a?: Record<string, Record<string, unknown>>,
  b?: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> | undefined {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: Record<string, Record<string, unknown>> = {};
  for (const key of keys) {
    out[key] = { ...(a[key] ?? {}), ...(b[key] ?? {}) };
  }
  return out;
}

function claudeCodeProviderOptions(
  input: ClaudeCodeOAuthIdentityInput,
  sdkParams: ClaudeCodeOAuthSdkParams,
): Record<string, Record<string, unknown>> {
  const seed = input.oauthAccountId ?? input.apiKey;
  const { userId } = injectClaudeIdentity({}, input.providerData, seed);
  const betaBody = {
    ...(sdkParams.instructions ? { system: [{ type: 'text', text: sdkParams.instructions }] } : {}),
    ...(sdkParams.tools ? { tools: Object.keys(sdkParams.tools).map(name => ({ name })) } : {}),
  };
  return {
    anthropic: {
      metadata: { userId },
      anthropicBeta: selectBetaFlags(betaBody, input.upstreamModelId).split(',').filter(Boolean),
    },
  };
}

export function applyClaudeCodeOAuthIdentity<T extends ClaudeCodeOAuthSdkParams>(
  input: ClaudeCodeOAuthIdentityInput,
  sdkParams: T,
): T {
  if (!isClaudeCodeOAuthRoute(input)) return sdkParams;

  sdkParams.instructions = prependClaudeCodeBillingLine(sdkParams.instructions);
  sdkParams.providerOptions = mergeProviderOptions(
    sdkParams.providerOptions,
    claudeCodeProviderOptions(input, sdkParams),
  );
  return sdkParams;
}
