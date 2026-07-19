/** Return the short credential label used on a provider card. */
export function oauthConnectionLabel(provider) {
  if (!provider?.hasKey) return provider?.freeAccess ? 'Free models' : 'Not configured';
  if (provider.authType !== 'oauth') return 'Key stored';
  const planLabel = provider.subscription?.label;
  return typeof planLabel === 'string' && planLabel.trim()
    ? `Connected · ${planLabel.trim()}`
    : 'Connected';
}

/** Copy a device code, with a small legacy fallback for older browser contexts. */
export async function copyDeviceCode(code, clipboard = globalThis.navigator?.clipboard) {
  if (clipboard?.writeText) {
    await clipboard.writeText(code);
    return;
  }
  if (!globalThis.document?.body || typeof globalThis.document.execCommand !== 'function') {
    throw new Error('Clipboard access is unavailable');
  }
  const input = globalThis.document.createElement('textarea');
  input.value = code;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  globalThis.document.body.appendChild(input);
  input.select();
  const copied = globalThis.document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('Copy failed');
}
