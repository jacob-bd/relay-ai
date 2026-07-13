import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import forge from 'node-forge';
import { getAppHome } from '../paths.js';

export interface HttpProxyCertificates {
  caCertPath: string;
  caCert: string;
  serverCert: string;
  serverKey: string;
}

const CERT_DIR = 'http-proxy';
const CA_CERT_FILE = 'relay-ai-ca.pem';
const CA_KEY_FILE = 'relay-ai-ca-key.pem';
const SERVER_CERT_FILE = 'api.anthropic.com.pem';
const SERVER_KEY_FILE = 'api.anthropic.com-key.pem';
const CERT_VERSION_FILE = 'version';
const CERT_VERSION = '1\n';

function serialNumber(): string {
  const bytes = randomBytes(16);
  bytes[0] &= 0x7f;
  return bytes.toString('hex');
}

function certPaths(): Record<'dir' | 'caCert' | 'caKey' | 'serverCert' | 'serverKey' | 'version', string> {
  const dir = join(getAppHome(), CERT_DIR);
  return {
    dir,
    caCert: join(dir, CA_CERT_FILE),
    caKey: join(dir, CA_KEY_FILE),
    serverCert: join(dir, SERVER_CERT_FILE),
    serverKey: join(dir, SERVER_KEY_FILE),
    version: join(dir, CERT_VERSION_FILE),
  };
}

function writePrivate(path: string, value: string): void {
  writeFileSync(path, value, { encoding: 'utf8', mode: 0o600 });
  chmodSync(path, 0o600);
}

function writePublic(path: string, value: string): void {
  writeFileSync(path, value, { encoding: 'utf8', mode: 0o644 });
  chmodSync(path, 0o644);
}

function generateCertificates(paths: ReturnType<typeof certPaths>): void {
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  chmodSync(paths.dir, 0o700);

  const caKeys = forge.pki.rsa.generateKeyPair(2048);
  const caCert = forge.pki.createCertificate();
  caCert.publicKey = caKeys.publicKey;
  caCert.serialNumber = serialNumber();
  caCert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  caCert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);
  const caAttrs = [{ name: 'commonName', value: 'Relay AI local HTTP proxy CA' }];
  caCert.setSubject(caAttrs);
  caCert.setIssuer(caAttrs);
  caCert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  caCert.sign(caKeys.privateKey, forge.md.sha256.create());

  const serverKeys = forge.pki.rsa.generateKeyPair(2048);
  const serverCert = forge.pki.createCertificate();
  serverCert.publicKey = serverKeys.publicKey;
  serverCert.serialNumber = serialNumber();
  serverCert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  serverCert.validity.notAfter = new Date(Date.now() + 825 * 24 * 60 * 60 * 1000);
  serverCert.setSubject([{ name: 'commonName', value: 'api.anthropic.com' }]);
  serverCert.setIssuer(caCert.subject.attributes);
  serverCert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: [{ type: 2, value: 'api.anthropic.com' }] },
    { name: 'subjectKeyIdentifier' },
  ]);
  serverCert.sign(caKeys.privateKey, forge.md.sha256.create());

  writePrivate(paths.caKey, forge.pki.privateKeyToPem(caKeys.privateKey));
  writePublic(paths.caCert, forge.pki.certificateToPem(caCert));
  writePrivate(paths.serverKey, forge.pki.privateKeyToPem(serverKeys.privateKey));
  writePublic(paths.serverCert, forge.pki.certificateToPem(serverCert));
  writePublic(paths.version, CERT_VERSION);
}

function storedCertificatesAreCurrent(paths: ReturnType<typeof certPaths>): boolean {
  try {
    const ca = forge.pki.certificateFromPem(readFileSync(paths.caCert, 'utf8'));
    const server = forge.pki.certificateFromPem(readFileSync(paths.serverCert, 'utf8'));
    const now = Date.now();
    const renewalBuffer = 7 * 24 * 60 * 60 * 1000;
    return ca.validity.notBefore.getTime() <= now
      && ca.validity.notAfter.getTime() > now + renewalBuffer
      && server.validity.notBefore.getTime() <= now
      && server.validity.notAfter.getTime() > now + renewalBuffer
      && ca.verify(ca)
      && ca.verify(server);
  } catch {
    return false;
  }
}

/** Create the local CA once, then reuse it so active sessions keep trusting the proxy. */
export function ensureHttpProxyCertificates(): HttpProxyCertificates {
  const paths = certPaths();
  const required = [paths.caCert, paths.caKey, paths.serverCert, paths.serverKey, paths.version];
  const current = required.every(existsSync)
    && readFileSync(paths.version, 'utf8') === CERT_VERSION
    && storedCertificatesAreCurrent(paths);
  if (!current) generateCertificates(paths);

  return {
    caCertPath: paths.caCert,
    caCert: readFileSync(paths.caCert, 'utf8'),
    serverCert: readFileSync(paths.serverCert, 'utf8'),
    serverKey: readFileSync(paths.serverKey, 'utf8'),
  };
}

/** Preserve an existing corporate/custom Node CA bundle alongside Relay's CA. */
export function ensureHttpProxyCaBundle(
  relayCaCertPath: string,
  additionalCaCertPath: string | undefined,
): string {
  if (!additionalCaCertPath?.trim()) return relayCaCertPath;
  try {
    if (resolve(additionalCaCertPath) === resolve(relayCaCertPath)) return relayCaCertPath;
    const relayCa = readFileSync(relayCaCertPath, 'utf8').trimEnd();
    const additionalCa = readFileSync(additionalCaCertPath, 'utf8').trim();
    if (!additionalCa) return relayCaCertPath;
    const combinedPath = join(dirname(relayCaCertPath), 'combined-ca.pem');
    writePublic(combinedPath, `${relayCa}\n${additionalCa}\n`);
    return combinedPath;
  } catch {
    return relayCaCertPath;
  }
}
