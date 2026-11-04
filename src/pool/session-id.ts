import { openCodeGoHeaders } from '../opencode-session.js';

/**
 * Request headers for a pool model. OpenCode Go rejects requests without an x-opencode-session header
 * (MissingSessionID); passing a sessionId to the SDK factory does not add it, so Go/Zen members need these
 * headers explicitly. The conversation id is used when the host has one, otherwise a per-request id is made.
 * Other providers keep their configured headers unchanged.
 */
export function poolProviderHeaders(
  provider: { id: string; headers?: Record<string, string> },
  model: { apiBaseUrl?: string },
  sessionId: string | undefined,
): Record<string, string> | undefined {
  return openCodeGoHeaders(provider.id, model.apiBaseUrl, sessionId, provider.headers) ?? provider.headers;
}
