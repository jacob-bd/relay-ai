import { describe, expect, it } from 'vitest';
import {
  isSubscriptionOAuthAcknowledgement,
  subscriptionOAuthRiskLines,
} from '../src/oauth/risk-notice.js';

describe('subscription OAuth risk notice', () => {
  it('only accepts the typed agree phrase', () => {
    expect(isSubscriptionOAuthAcknowledgement('agree')).toBe(true);
    expect(isSubscriptionOAuthAcknowledgement(' AGREE ')).toBe(true);
    for (const value of [true, 1, 'yes', 'agree now', '', undefined, null]) {
      expect(isSubscriptionOAuthAcknowledgement(value)).toBe(false);
    }
  });

  it('names the permanent ban and the Google services at risk', () => {
    const risk = subscriptionOAuthRiskLines('antigravity');
    const text = risk.lines.join(' ');
    expect(risk.title).toMatch(/Antigravity/);
    expect(risk.acknowledgement).toBe('agree');
    expect(text).toMatch(/permanently banned/i);
    expect(text).toMatch(/Gmail/);
    expect(text).toMatch(/Terms of Service/);
    expect(text).toMatch(/Type "agree"/);
  });

  it('names Anthropic enforcement and the subscription at risk', () => {
    const risk = subscriptionOAuthRiskLines('claude-code');
    const text = risk.lines.join(' ');
    expect(risk.title).toMatch(/Claude Code/);
    expect(risk.acknowledgement).toBe('agree');
    expect(text).toMatch(/legal action/i);
    expect(text).toMatch(/permanently banned/i);
    expect(text).toMatch(/Type "agree"/);
  });
});
