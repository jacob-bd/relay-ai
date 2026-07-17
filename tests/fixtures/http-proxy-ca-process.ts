import { basename } from 'node:path';
import forge from 'node-forge';
import { createHttpProxyCertificates } from '../../src/http-proxy/ca.js';

const appHome = process.argv[2];
if (!appHome) throw new Error('Expected an app-home path');

const certificates = createHttpProxyCertificates(appHome);
try {
  const ca = forge.pki.certificateFromPem(certificates.caCert);
  const server = forge.pki.certificateFromPem(certificates.serverCert);
  process.stdout.write(JSON.stringify({
    sessionId: basename(certificates.sessionDir),
    caSerial: ca.serialNumber,
    validChain: ca.verify(ca) && ca.verify(server),
  }));
} finally {
  certificates.cleanup();
}
