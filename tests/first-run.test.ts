import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { needsFirstRunSetup } from '../src/first-run.js';
import { emptyRegistry, saveRegistry } from '../src/registry/io.js';
import { zenRegistryStub } from '../src/registry/builtins.js';
import * as env from '../src/env.js';

describe('needsFirstRunSetup', () => {
  let home: string;
  const prevHome = process.env.RELAY_AI_HOME;
  const prevKey = process.env.OPENCODE_API_KEY;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-ai-first-run-'));
    process.env.RELAY_AI_HOME = home;
    delete process.env.OPENCODE_API_KEY;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.RELAY_AI_HOME;
    else process.env.RELAY_AI_HOME = prevHome;
    if (prevKey === undefined) delete process.env.OPENCODE_API_KEY;
    else process.env.OPENCODE_API_KEY = prevKey;
    rmSync(home, { recursive: true, force: true });
  });

  it('returns true when registry is empty and no API key is configured', async () => {
    const spy = vi.spyOn(env, 'readGlobalOpencodeCredential').mockResolvedValue(null);
    expect(await needsFirstRunSetup()).toBe(true);
    spy.mockRestore();
  });

  it('returns false when registry has providers', async () => {
    const registry = emptyRegistry();
    registry.providers.push(zenRegistryStub());
    saveRegistry(registry);
    expect(await needsFirstRunSetup()).toBe(false);
  });

  it('returns false when OPENCODE_API_KEY is set even with empty registry', async () => {
    process.env.OPENCODE_API_KEY = 'test-key-abc';
    expect(await needsFirstRunSetup()).toBe(false);
  });
});
