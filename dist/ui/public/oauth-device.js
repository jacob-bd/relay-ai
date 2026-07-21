/** Clipboard helpers for the web UI (works on http://LAN as well as https/localhost). */

/**
 * Copy text to the clipboard. Prefer the async Clipboard API in secure contexts;
 * fall back to a hidden textarea + execCommand for plain HTTP (LAN Docker UI).
 */
export async function copyTextToClipboard(
  text,
  clipboard = globalThis.navigator?.clipboard,
  doc = globalThis.document,
) {
  const secure = typeof globalThis.isSecureContext === 'boolean'
    ? globalThis.isSecureContext
    : Boolean(clipboard?.writeText);

  if (secure && clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return;
    } catch {
      // Fall through — common on http://192.168.x.x where the API exists but throws.
    }
  }

  if (!doc?.body || typeof doc.execCommand !== 'function') {
    throw new Error('Clipboard access is unavailable');
  }
  const input = doc.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  input.style.opacity = '0';
  doc.body.appendChild(input);
  input.select();
  input.setSelectionRange(0, input.value.length);
  const copied = doc.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('Copy failed');
}

/** @deprecated Prefer copyTextToClipboard — kept for existing call sites / tests. */
export async function copyDeviceCode(code, clipboard = globalThis.navigator?.clipboard) {
  return copyTextToClipboard(code, clipboard);
}

/** Return the short credential label used on a provider card. */
export function oauthConnectionLabel(provider) {
  if (!provider?.hasKey) return provider?.freeAccess ? 'Free models' : 'Not configured';
  if (provider.authType !== 'oauth') return 'Key stored';
  const planLabel = provider.subscription?.label;
  return typeof planLabel === 'string' && planLabel.trim()
    ? `Connected · ${planLabel.trim()}`
    : 'Connected';
}
