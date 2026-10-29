// oauth/risk-notice.ts — the account-risk warning shown before a subscription sign-in
//
// Plain text, shared by the terminal prompt (ui.ts) and the web UI confirmation (ui/api.ts),
// so both always say the same thing.

export type RiskProvider = 'claude-code' | 'antigravity';

export interface SubscriptionOAuthRisk {
  providerLabel: string;
  isGoogle: boolean;
  service: string;
  enforcementNote: string;
  compatibilityNote?: string;
  consequences: string[];
  /** Highlighted line, Google only. */
  lossNote?: string;
  advice?: string;
  disclaimer: string;
}

export function subscriptionOAuthRisk(providerId: RiskProvider): SubscriptionOAuthRisk {
  const isGoogle = providerId === 'antigravity';
  return {
    providerLabel: isGoogle ? 'Antigravity / Google' : 'Claude Code',
    isGoogle,
    service: isGoogle
      ? 'Google account (Gmail, Drive, YouTube, Workspace, and all tied services)'
      : 'Anthropic account (Claude Pro / Max subscription)',
    enforcementNote: isGoogle
      ? 'Community reports: Google has issued account bans for this usage.'
      : 'Anthropic actively enforces this — validating request shape and has taken legal action against other projects.',
    compatibilityNote: isGoogle
      ? undefined
      : 'For compatibility, relay-ai may reproduce Claude Code-style request metadata and attribution so Anthropic classifies traffic as Claude Code.',
    consequences: ['Token revocation', 'Account suspension or permanent ban'],
    lossNote: isGoogle ? 'Loss of ALL services tied to this Google account' : undefined,
    advice: isGoogle ? 'Do not use your primary Google account. Use a throwaway account.' : undefined,
    disclaimer: `relay-ai is not affiliated with ${isGoogle ? 'Google' : 'Anthropic'} and cannot protect you.`,
  };
}

/** Plain-text lines for the web UI confirmation dialog. */
export function subscriptionOAuthRiskLines(providerId: RiskProvider): { title: string; lines: string[] } {
  const risk = subscriptionOAuthRisk(providerId);
  return {
    title: `Account risk — ${risk.providerLabel} OAuth`,
    lines: [
      `This extracts OAuth tokens from your ${risk.service}.`,
      "Routing subscription tokens through relay-ai to power other tools may violate the provider's Terms of Service.",
      risk.enforcementNote,
      ...(risk.compatibilityNote ? [risk.compatibilityNote] : []),
      `Possible consequences: ${[...risk.consequences, ...(risk.lossNote ? [risk.lossNote] : [])].join('; ')}.`,
      ...(risk.advice ? [risk.advice] : []),
      risk.disclaimer,
    ],
  };
}
