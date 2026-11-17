// oauth/risk-notice.ts — the account-risk warning shown before a subscription sign-in
//
// Plain text, shared by the terminal prompt (ui.ts) and the web UI confirmation (ui/api.ts),
// so both always say the same thing.

export type RiskProvider = 'claude-code' | 'antigravity';

/** The literal phrase a user must type before a subscription OAuth sign-in may start. */
export const SUBSCRIPTION_OAUTH_ACKNOWLEDGEMENT = 'agree';

export function isSubscriptionOAuthAcknowledgement(value: unknown): boolean {
  return typeof value === 'string'
    && value.trim().toLowerCase() === SUBSCRIPTION_OAUTH_ACKNOWLEDGEMENT;
}

export interface SubscriptionOAuthRisk {
  providerLabel: string;
  isGoogle: boolean;
  service: string;
  enforcementNote: string;
  compatibilityNote?: string;
  consequences: string[];
  /** Highlighted line, Google only. */
  lossNote?: string;
  advice: string;
  disclaimer: string;
  acknowledgement: string;
}

export interface SubscriptionOAuthRiskLines {
  title: string;
  lines: string[];
  acknowledgement: string;
}

export function subscriptionOAuthRisk(providerId: RiskProvider): SubscriptionOAuthRisk {
  const isGoogle = providerId === 'antigravity';
  const provider = isGoogle ? 'Google' : 'Anthropic';
  const acknowledgement = SUBSCRIPTION_OAUTH_ACKNOWLEDGEMENT;
  return {
    providerLabel: isGoogle ? 'Antigravity / Google' : 'Claude Code',
    isGoogle,
    service: isGoogle
      ? 'Google account (Gmail, Drive, YouTube, Workspace, and every service tied to it)'
      : 'Anthropic account (Claude Pro / Max subscription)',
    enforcementNote: isGoogle
      ? "Google's Antigravity Terms of Service prohibit accessing the service with third-party software or automated tools. Google has blocked accounts for using Antigravity OAuth outside the official app."
      : "Anthropic's Terms of Service prohibit routing subscription credentials through third-party software. Anthropic actively enforces this, validates request shape, and has taken legal action against other projects.",
    compatibilityNote: isGoogle
      ? undefined
      : 'For compatibility, relay-ai may reproduce Claude Code request metadata and attribution so Anthropic classifies traffic as Claude Code.',
    consequences: isGoogle
      ? ['OAuth tokens revoked', 'Antigravity access suspended', 'Google account suspended or permanently banned']
      : ['OAuth tokens revoked', 'Claude subscription suspended or permanently banned', 'Loss of paid access and any data tied to the account'],
    lossNote: isGoogle
      ? 'Loss of Gmail, Drive, YouTube, Workspace, and every other Google service on this account'
      : undefined,
    advice: isGoogle
      ? 'Do not use your primary Google account. Use a throwaway account you can afford to lose.'
      : 'Do not use an account you cannot afford to lose.',
    disclaimer: `relay-ai is not affiliated with ${provider} and cannot appeal, restore, or protect your account. By typing "${acknowledgement}" you accept full responsibility for any action ${provider} takes.`,
    acknowledgement,
  };
}

/** Plain-text lines for the web UI confirmation dialog and the terminal panel. */
export function subscriptionOAuthRiskLines(providerId: RiskProvider): SubscriptionOAuthRiskLines {
  const risk = subscriptionOAuthRisk(providerId);
  return {
    title: `Account risk — ${risk.providerLabel} OAuth`,
    acknowledgement: risk.acknowledgement,
    lines: [
      `This connects relay-ai to your ${risk.service} using OAuth.`,
      "Using subscription credentials through third-party software may violate the provider's Terms of Service.",
      risk.enforcementNote,
      ...(risk.compatibilityNote ? [risk.compatibilityNote] : []),
      `Possible consequences: ${[...risk.consequences, ...(risk.lossNote ? [risk.lossNote] : [])].join('; ')}.`,
      risk.advice,
      risk.disclaimer,
      `Type "${risk.acknowledgement}" to confirm you understand and accept these risks.`,
    ],
  };
}
