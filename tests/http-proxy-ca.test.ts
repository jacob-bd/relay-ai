import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import forge from 'node-forge';
import { createHttpProxyCertificates } from '../src/http-proxy/ca.js';

const testHomes: string[] = [];
const execFileAsync = promisify(execFile);
const viteNodePath = fileURLToPath(new URL('../node_modules/vite-node/vite-node.mjs', import.meta.url));
const caProcessPath = fileURLToPath(new URL('./fixtures/http-proxy-ca-process.ts', import.meta.url));

interface ProcessCertificateResult {
  sessionId: string;
  caSerial: string;
  validChain: boolean;
}

async function createCertificatesInSeparateProcess(appHome: string): Promise<ProcessCertificateResult> {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [viteNodePath, caProcessPath, appHome],
    { encoding: 'utf8', timeout: 30_000 },
  );
  if (stderr.trim()) throw new Error(stderr.trim());
  return JSON.parse(stdout.trim()) as ProcessCertificateResult;
}

afterEach(() => {
  for (const home of testHomes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe('transparent HTTP proxy certificates', () => {
  it('creates a unique per-session CA and removes it on cleanup', () => {
    const home = mkdtempSync(join(tmpdir(), 'relay-ai-proxy-ca-'));
    testHomes.push(home);
    const first = createHttpProxyCertificates(home);
    const second = createHttpProxyCertificates(home);

    expect(first.sessionDir).not.toBe(second.sessionDir);
    expect(existsSync(first.caCertPath)).toBe(true);
    expect(statSync(first.sessionDir).mode & 0o777).toBe(0o700);
    expect(statSync(first.caCertPath).mode & 0o777).toBe(0o600);

    const ca = forge.pki.certificateFromPem(readFileSync(first.caCertPath, 'utf8'));
    const server = forge.pki.certificateFromPem(first.serverCert);
    expect(ca.verify(ca)).toBe(true);
    expect(ca.verify(server)).toBe(true);

    first.cleanup();
    expect(existsSync(first.sessionDir)).toBe(false);
    expect(existsSync(second.sessionDir)).toBe(true);
    second.cleanup();
  });

  it('creates isolated valid certificates for simultaneous process launches', async () => {
    const home = mkdtempSync(join(tmpdir(), 'relay-ai-proxy-ca-'));
    testHomes.push(home);

    const results = await Promise.all(
      Array.from({ length: 4 }, () => createCertificatesInSeparateProcess(home)),
    );

    expect(new Set(results.map(result => result.sessionId)).size).toBe(4);
    expect(new Set(results.map(result => result.caSerial)).size).toBe(4);
    expect(results.every(result => result.validChain)).toBe(true);
  }, 30_000);

  it('registers process-exit cleanup and removes the listener after normal close', () => {
    const home = mkdtempSync(join(tmpdir(), 'relay-ai-proxy-ca-'));
    testHomes.push(home);
    const before = process.listenerCount('exit');
    const beforeSighup = process.listenerCount('SIGHUP');
    const previousSighupListeners = new Set(process.rawListeners('SIGHUP'));
    const certificates = createHttpProxyCertificates(home);
    expect(process.listenerCount('exit')).toBe(before + 1);
    expect(process.listenerCount('SIGHUP')).toBe(beforeSighup + 1);

    const sighupCleanup = process.rawListeners('SIGHUP')
      .find(listener => !previousSighupListeners.has(listener));
    expect(sighupCleanup).toBeTypeOf('function');
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    sighupCleanup?.();
    expect(existsSync(certificates.sessionDir)).toBe(false);
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGHUP');
    kill.mockRestore();

    certificates.cleanup();
    expect(process.listenerCount('exit')).toBe(before);
    expect(process.listenerCount('SIGHUP')).toBe(beforeSighup);
  });
});
