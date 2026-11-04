import { randomUUID } from 'node:crypto';
import { providerKind } from '../registry/provider-kind.js';

/**
 * OpenCode Zen/Go reject requests without an x-opencode-session header (MissingSessionID). Hosts normally
 * pass the tool's conversation id; when one is missing, a per-request id keeps those members usable.
 * Other providers keep the original (possibly absent) id so prompt-cache keys are unchanged.
 */
export function poolSessionId(providerId: string, sessionId: string | undefined): string | undefined {
  if (sessionId) return sessionId;
  const kind = providerKind(providerId);
  return kind === 'go' || kind === 'zen' ? `relay-pool-${randomUUID()}` : undefined;
}
