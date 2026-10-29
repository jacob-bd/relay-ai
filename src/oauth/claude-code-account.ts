// oauth/claude-code-account.ts — what Relay stores about a Claude Code sign-in (shared by terminal and UI)

import { generateCliUserID, type ClaudeBootstrapInfo } from './claude-code.js';

/** Non-secret account details kept beside the tokens; the device id is new for every sign-in. */
export function claudeCodeProviderData(bootstrap: ClaudeBootstrapInfo): Record<string, unknown> {
  const data: Record<string, unknown> = { cliUserID: generateCliUserID() };
  if (bootstrap.accountId) data.accountUUID = bootstrap.accountId;
  if (bootstrap.organizationId) data.organizationUUID = bootstrap.organizationId;
  if (bootstrap.organizationName) data.organizationName = bootstrap.organizationName;
  if (bootstrap.plan) data.plan = bootstrap.plan;
  if (bootstrap.email) data.identity = { email: bootstrap.email };
  return data;
}
