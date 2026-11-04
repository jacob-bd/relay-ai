// src/tls-trust.ts — opt-in trust of the operating system's certificate store.
//
// Node only trusts its bundled public CAs. Corporate endpoints signed by an
// internal CA (e.g. behind a VPN) fail with UNABLE_TO_GET_ISSUER_CERT_LOCALLY even
// though the browser and curl trust them via the OS keychain. This module lets the
// user opt in to adding the OS store to Node's trusted set for the whole process.

import tls from 'node:tls';

/** Error code reported on an untrusted-issuer failure, so UIs can offer the fix. */
export const UNTRUSTED_CERTIFICATE_CODE = 'untrusted-certificate';

// Only "issuer not trusted" failures: trusting more CAs can fix these. Expired
// certificates and hostname mismatches are different problems and stay unmatched.
const UNTRUSTED_ISSUER_CODES = new Set([
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_UNTRUSTED',
]);

type CaApi = {
  getCACertificates?: (type?: string) => string[];
  setDefaultCACertificates?: (certs: string[]) => void;
};

const caApi = tls as unknown as CaApi;

let originalCertificates: string[] | undefined;
let applied = false;

/** True when this Node can swap its trusted CA list at runtime (22.19+/24.5+). */
export function isSystemCaSupported(): boolean {
  return typeof caApi.setDefaultCACertificates === 'function'
    && typeof caApi.getCACertificates === 'function';
}

/** True when the process already trusts the OS store (via this module or NODE_USE_SYSTEM_CA). */
export function isSystemCaActive(): boolean {
  return applied || process.env.NODE_USE_SYSTEM_CA === '1';
}

/** Trust the OS certificate store in addition to Node's defaults. Idempotent. */
export function applySystemCaTrust(): { ok: boolean; reason?: string } {
  if (applied || process.env.NODE_USE_SYSTEM_CA === '1') return { ok: true };
  if (!isSystemCaSupported()) {
    return {
      ok: false,
      reason: `This Node version (${process.version}) cannot do this at runtime. Update Node to 22.19 or newer, or start Relay with NODE_USE_SYSTEM_CA=1.`,
    };
  }
  try {
    const current = caApi.getCACertificates!('default');
    const system = caApi.getCACertificates!('system');
    originalCertificates = current;
    caApi.setDefaultCACertificates!([...current, ...system]);
    applied = true;
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Undo applySystemCaTrust(). Has no effect when trust came from NODE_USE_SYSTEM_CA. */
export function revertSystemCaTrust(): void {
  if (!applied || !originalCertificates) return;
  caApi.setDefaultCACertificates!(originalCertificates);
  originalCertificates = undefined;
  applied = false;
}

/** True when a fetch failure was caused by a certificate issuer Node does not trust. */
export function isUntrustedCertificateError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && UNTRUSTED_ISSUER_CODES.has(code)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Plain-English error + hint for an untrusted-certificate failure. */
export function untrustedCertificateMessage(): { error: string; hint: string } {
  const error = "Relay doesn't trust this server's security certificate.";
  if (isSystemCaActive()) {
    return {
      error,
      hint: "Relay already trusts this computer's certificates, so this computer doesn't trust it either. Ask your IT team for the company CA certificate and install it in Keychain Access.",
    };
  }
  return {
    error,
    hint: "Your computer may trust it (browsers do) but Relay doesn't. Turn on \"Trust this computer's certificates\" and try again. CLI: relay-ai providers trust-certs on",
  };
}

/** Shown before the user turns trust on. Plain English, no jargon. */
export const TRUST_SYSTEM_CERTS_NOTICE =
  "Relay will trust every certificate authority your computer trusts (the same list your browser uses), "
  + "including company ones added by your employer or IT tools. Only turn this on if you trust this computer's setup.";
