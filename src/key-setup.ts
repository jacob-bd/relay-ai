// src/key-setup.ts — interactive OpenCode API key collection and storage

import * as p from '@clack/prompts';
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  GLOBAL_OPENCODE_KEYRING_ACCOUNT,
  isSecretServiceAvailable,
  readFromCredentialStore,
  resolveApiKey,
  saveToCredentialStore,
} from './env.js';

export function detectShellProfile(): { display: string; path: string } {
  const shell = process.env['SHELL'] ?? '';
  if (process.platform === 'darwin') {
    if (shell.includes('zsh'))  return { display: '~/.zshrc',       path: `${homedir()}/.zshrc` };
    if (shell.includes('bash')) return { display: '~/.bash_profile', path: `${homedir()}/.bash_profile` };
    return { display: '~/.profile', path: `${homedir()}/.profile` };
  }
  if (process.platform === 'linux') {
    if (shell.includes('zsh'))  return { display: '~/.zshrc',   path: `${homedir()}/.zshrc` };
    if (shell.includes('bash')) return { display: '~/.bashrc',  path: `${homedir()}/.bashrc` };
    return { display: '~/.profile', path: `${homedir()}/.profile` };
  }
  if (shell.includes('bash')) return { display: '~/.bashrc', path: `${homedir()}/.bashrc` };
  return { display: '~/.profile', path: `${homedir()}/.profile` };
}

export async function resolveOrCollectApiKey(simulate = false, trace = false): Promise<string | null> {
  if (!simulate) {
    const existing = resolveApiKey();
    if (existing) return existing;
  }

  const isMac     = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';
  const isLinux   = process.platform === 'linux';

  if (simulate) {
    p.note(
      'Running in dry-run mode — no keys will be read from or written to your system.',
      'Simulating first-run onboarding',
    );
  }

  if (!simulate) {
    const keyDiag = (reason: string) => {
      p.log.warn(`Credential store unavailable — ${reason}`);
      if (trace) {
        try {
          appendFileSync(
            join(tmpdir(), 'relay-ai-debug.log'),
            `${new Date().toISOString()} keyring: ${reason}\n`,
          );
        } catch { /* ignore */ }
      }
    };
    const storedKey = await readFromCredentialStore(keyDiag);
    if (storedKey) {
      const storeName = isMac ? 'macOS Keychain' : isWindows ? 'Windows Credential Manager' : 'Secret Service';
      p.log.success(`Found key in ${storeName}`);
      process.env['OPENCODE_API_KEY'] = storedKey;
      return storedKey;
    }
  }

  p.note('Get your free key at: https://opencode.ai/auth', 'OpenCode API key');

  const key = await p.password({
    message: 'Paste your OPENCODE_API_KEY:',
    validate: (val) => val.trim() ? undefined : 'Key cannot be empty',
  });

  if (p.isCancel(key)) { p.cancel('Cancelled.'); return null; }

  const trimmedKey = (key as string).trim();
  let secretServiceAvailable = false;
  if (isLinux && !simulate) {
    secretServiceAvailable = await isSecretServiceAvailable();
  }

  const { display, path } = detectShellProfile();

  type SaveChoice = 'keychain' | 'keychain-autoload' | 'profile' | 'session' | 'credential-manager' | 'setx' | 'secret-service';

  const saveOptions: Array<{ value: SaveChoice; label: string; hint: string }> = (() => {
    if (isMac) {
      return [
        { value: 'keychain', label: 'Keychain only', hint: 'Key stored encrypted in Keychain; relay-ai reads it automatically next time' },
        { value: 'keychain-autoload', label: `Keychain + ${display} auto-load`, hint: `Key in Keychain; ${display} also exports it so all terminal tools can see it` },
        { value: 'profile', label: `${display} only (plaintext)`, hint: 'Key written directly to your shell profile — simpler but less secure' },
        { value: 'session', label: 'This session only', hint: "Not saved anywhere — you'll be asked again next time" },
      ];
    }
    if (isWindows) {
      return [
        { value: 'credential-manager', label: 'Windows Credential Manager', hint: 'Key stored securely; relay-ai reads it automatically next time' },
        { value: 'setx', label: 'Persistent environment variable (plaintext)', hint: 'Runs setx — key visible in System Properties → Environment Variables' },
        { value: 'session', label: 'This session only', hint: "Not saved anywhere — you'll be asked again next time" },
      ];
    }
    const opts: Array<{ value: SaveChoice; label: string; hint: string }> = [];
    if (secretServiceAvailable) {
      opts.push({ value: 'secret-service', label: 'Secret Service (GNOME Keyring / KWallet)', hint: 'Key stored securely in your desktop keyring; relay-ai reads it automatically next time' });
    } else if (!simulate) {
      p.log.info('No keyring daemon detected — secure storage requires GNOME Keyring or KWallet running.');
    }
    opts.push(
      { value: 'profile', label: `${display} (plaintext)`, hint: 'Key written directly to your shell profile' },
      { value: 'session', label: 'This session only', hint: "Not saved anywhere — you'll be asked again next time" },
    );
    return opts;
  })();

  const saveChoice = await p.select<SaveChoice>({
    message: 'Where should we save the key?',
    options: saveOptions,
    initialValue: (isMac ? 'keychain' : isWindows ? 'credential-manager' : secretServiceAvailable ? 'secret-service' : 'profile') as SaveChoice,
  });

  if (p.isCancel(saveChoice)) { p.cancel('Cancelled.'); return null; }

  if (simulate) {
    const dryRunMessages: Record<SaveChoice, string> = {
      keychain: 'Would save key to macOS Keychain',
      'keychain-autoload': `Would save key to macOS Keychain and add auto-load to ${display}`,
      'credential-manager': 'Would save key to Windows Credential Manager',
      setx: 'Would run: setx OPENCODE_API_KEY ***',
      'secret-service': 'Would save key to Secret Service (GNOME Keyring / KWallet)',
      profile: `Would append OPENCODE_API_KEY export to ${display}`,
      session: 'Would use key for this session only',
    };
    p.log.info(`[dry-run] ${dryRunMessages[saveChoice]}`);
  } else if (saveChoice === 'keychain') {
    if (await saveToCredentialStore(trimmedKey)) {
      p.log.success('Key saved to macOS Keychain — active now and automatically loaded next time.');
    } else {
      p.log.warn('Could not write to Keychain — key will be used for this session only');
    }
  } else if (saveChoice === 'keychain-autoload') {
    if (await saveToCredentialStore(trimmedKey)) {
      try {
        const autoLoadLine = `export OPENCODE_API_KEY="$(security find-generic-password -s relay-ai -a ${GLOBAL_OPENCODE_KEYRING_ACCOUNT} -w 2>/dev/null)"`;
        const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
        if (!existing.includes(autoLoadLine)) {
          appendFileSync(path, `\n# relay-ai: load API key from macOS Keychain\n${autoLoadLine}\n`);
        }
        p.log.success(`Key saved to Keychain and auto-load added to ${display} — active now and in all future terminals.`);
      } catch {
        p.log.success('Key saved to Keychain — active now and automatically loaded next time.');
        p.log.warn(`Could not write auto-load line to ${display}`);
      }
    } else {
      p.log.warn('Could not write to Keychain — key will be used for this session only');
    }
  } else if (saveChoice === 'credential-manager') {
    if (await saveToCredentialStore(trimmedKey)) {
      p.log.success('Key saved to Windows Credential Manager — active now and automatically loaded next time.');
    } else {
      p.log.warn('Could not write to Credential Manager — key will be used for this session only');
    }
  } else if (saveChoice === 'setx') {
    try {
      const result = spawnSync('setx', ['OPENCODE_API_KEY', trimmedKey], { stdio: ['pipe', 'pipe', 'pipe'] });
      if (result.status !== 0) throw new Error('setx exited with non-zero status');
      p.log.success('Key saved as a user environment variable — active now and in all future terminals.');
    } catch {
      p.log.warn('Could not run setx — key will be used for this session only');
    }
  } else if (saveChoice === 'secret-service') {
    if (await saveToCredentialStore(trimmedKey)) {
      p.log.success('Key saved to Secret Service — active now and automatically loaded next time.');
    } else {
      p.log.warn('Could not write to Secret Service — key will be used for this session only');
    }
  } else if (saveChoice === 'profile') {
    try {
      if (!existsSync(path)) appendFileSync(path, '');
      const escapedKey = trimmedKey.replace(/'/g, "'\\''");
      appendFileSync(path, `\nexport OPENCODE_API_KEY='${escapedKey}'\n`);
      p.log.success(`Key saved to ${display} — active now and in all future terminals.`);
    } catch {
      p.log.warn(`Could not write to ${display} — key will be used for this session only`);
    }
  }

  if (!simulate) process.env['OPENCODE_API_KEY'] = trimmedKey;
  return trimmedKey;
}
