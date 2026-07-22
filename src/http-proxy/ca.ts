import { randomBytes, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import forge from 'node-forge';
import { getAppHome } from '../paths.js';

const SESSION_ROOT = 'http-proxy-sessions';
const OWNER_FILE = 'owner.pid';
// A session dir is created a moment before its owner.pid is written. Never reap
// a dir that lacks owner.pid until it is older than this window, so one
// process's cleanup cannot delete another process's session mid-creation (which
// otherwise races the CA write and fails with ENOENT).
const MID_CREATION_GRACE_MS = 30_000;

export interface HttpProxyCertificates {
  sessionDir: string;
  caCertPath: string;
  caCert: string;
  serverCert: string;
  serverKey: string;
  cleanup: () => void;
}

function serialNumber(): string {
  const bytes = randomBytes(16);
  bytes[0] &= 0x7f;
  return bytes.toString('hex');
}

function processIsRunning(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Remove certificate sessions left behind by processes that no longer exist. */
export function cleanupStaleHttpProxySessions(appHome = getAppHome()): void {
  const root = join(appHome, SESSION_ROOT);
  if (!existsSync(root)) return;
  const now = Date.now();
  for (const name of readdirSync(root)) {
    const sessionDir = join(root, name);
    try {
      const stat = statSync(sessionDir);
      if (!stat.isDirectory()) continue;
      const ownerPath = join(sessionDir, OWNER_FILE);
      if (!existsSync(ownerPath)) {
        // Either a dir another process is still creating, or a genuinely
        // abandoned one. Only reap it once it is too old to still be in the
        // create window — otherwise we would race and delete a live session.
        if (now - stat.mtimeMs > MID_CREATION_GRACE_MS) {
          rmSync(sessionDir, { recursive: true, force: true });
        }
        continue;
      }
      const pid = Number(readFileSync(ownerPath, 'utf8').trim());
      if (!processIsRunning(pid)) rmSync(sessionDir, { recursive: true, force: true });
    } catch {
      // A racing process may remove the dir between statSync and rmSync; a
      // transient read error is retried on the next launch. Best-effort only.
    }
  }
}

/** Generate a private CA for one Relay AI process session. */
export function createHttpProxyCertificates(appHome = getAppHome()): HttpProxyCertificates {
  cleanupStaleHttpProxySessions(appHome);
  const root = join(appHome, SESSION_ROOT);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);

  const sessionDir = join(root, randomUUID());
  mkdirSync(sessionDir, { mode: 0o700 });
  chmodSync(sessionDir, 0o700);
  writeFileSync(join(sessionDir, OWNER_FILE), `${process.pid}\n`, { mode: 0o600 });

  try {
    const caKeys = forge.pki.rsa.generateKeyPair(2048);
    const ca = forge.pki.createCertificate();
    ca.publicKey = caKeys.publicKey;
    ca.serialNumber = serialNumber();
    ca.validity.notBefore = new Date(Date.now() - 60_000);
    ca.validity.notAfter = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const issuer = [{ name: 'commonName', value: `Relay AI session ${process.pid}` }];
    ca.setSubject(issuer);
    ca.setIssuer(issuer);
    ca.setExtensions([
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true, critical: true },
      { name: 'subjectKeyIdentifier' },
    ]);
    ca.sign(caKeys.privateKey, forge.md.sha256.create());

    const serverKeys = forge.pki.rsa.generateKeyPair(2048);
    const server = forge.pki.createCertificate();
    server.publicKey = serverKeys.publicKey;
    server.serialNumber = serialNumber();
    server.validity.notBefore = new Date(Date.now() - 60_000);
    server.validity.notAfter = new Date(Date.now() + 48 * 60 * 60 * 1000);
    server.setSubject([{ name: 'commonName', value: 'api.anthropic.com' }]);
    server.setIssuer(ca.subject.attributes);
    server.setExtensions([
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 2, value: 'api.anthropic.com' }] },
      { name: 'subjectKeyIdentifier' },
    ]);
    server.sign(caKeys.privateKey, forge.md.sha256.create());

    const caCert = forge.pki.certificateToPem(ca);
    const caCertPath = join(sessionDir, 'relay-ai-ca.pem');
    writeFileSync(caCertPath, caCert, { encoding: 'utf8', mode: 0o600 });
    chmodSync(caCertPath, 0o600);

    let cleaned = false;
    const cleanupOnExit = () => {
      if (cleaned) return;
      cleaned = true;
      rmSync(sessionDir, { recursive: true, force: true });
    };
    const cleanupOnSighup = () => {
      cleanupOnExit();
      process.off('SIGHUP', cleanupOnSighup);
      try {
        process.kill(process.pid, 'SIGHUP');
      } catch {
        process.exit(129);
      }
    };
    const cleanup = () => {
      process.off('exit', cleanupOnExit);
      process.off('SIGHUP', cleanupOnSighup);
      cleanupOnExit();
    };
    process.once('exit', cleanupOnExit);
    process.once('SIGHUP', cleanupOnSighup);

    return {
      sessionDir,
      caCertPath,
      caCert,
      serverCert: forge.pki.certificateToPem(server),
      serverKey: forge.pki.privateKeyToPem(serverKeys.privateKey),
      cleanup,
    };
  } catch (error) {
    rmSync(sessionDir, { recursive: true, force: true });
    throw error;
  }
}

/** Preserve an existing Node CA bundle alongside the per-session Relay CA. */
export function createHttpProxyCaBundle(
  relayCaCertPath: string,
  additionalCaCertPath: string | undefined,
): string {
  if (!additionalCaCertPath?.trim()) return relayCaCertPath;
  if (resolve(additionalCaCertPath) === resolve(relayCaCertPath)) {
    return relayCaCertPath;
  }
  const relayCa = readFileSync(relayCaCertPath, 'utf8').trimEnd();
  const additionalCa = readFileSync(additionalCaCertPath, 'utf8').trim();
  if (!additionalCa) return relayCaCertPath;
  const combinedPath = join(dirname(relayCaCertPath), 'combined-ca.pem');
  writeFileSync(
    combinedPath,
    `${relayCa}\n${additionalCa}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  chmodSync(combinedPath, 0o600);
  return combinedPath;
}
