// tests/core-package.test.ts — the built Core bundle must import side-effect-free.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const CORE_BUNDLE = resolve(__dirname, '../dist/core/index.js');
const built = existsSync(CORE_BUNDLE);

describe.skipIf(!built)('dist/core package surface', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'relay-core-pkg-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('imports without side effects and exposes exactly the barrel exports', () => {
    const script = `
      const mod = await import(${JSON.stringify(`file://${CORE_BUNDLE}`)});
      console.log(JSON.stringify(Object.keys(mod).sort()));
    `;
    const stdout = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      { env: { ...process.env, RELAY_AI_HOME: home }, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    // Only the export-key line on stdout — no UI, spinner, or CLI chatter.
    const lines = stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual([
      'RelayCoreError',
      'createRelayModel',
      'isRelayCoreError',
      'listRelayModels',
      'parseRelayRouteId',
      'toRelayRouteId',
    ]);
    // No files created or modified in the consumer's RELAY_AI_HOME.
    expect(readdirSync(home)).toEqual([]);
  });

  it('listRelayModels against a fixture home writes nothing', () => {
    const fixture = {
      schemaVersion: 1,
      providers: [{
        id: 'groq', templateId: 'groq', name: 'Groq', enabled: true,
        authRef: 'keyring:provider:groq', authType: 'api',
        api: { npm: '@ai-sdk/groq', url: 'https://api.groq.com/openai/v1' },
        modelsCache: {
          fetchedAt: '2026-07-23T00:00:00Z',
          models: [{ id: 'm1', name: 'M1', upstreamModelId: 'm1', modelFormat: 'openai' }],
        },
        addedAt: '2026-07-23T00:00:00Z',
      }],
    };
    const { writeFileSync, readFileSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(join(home, 'providers.json'), JSON.stringify(fixture));
    const before = readFileSync(join(home, 'providers.json'), 'utf8');
    const script = `
      const mod = await import(${JSON.stringify(`file://${CORE_BUNDLE}`)});
      const models = mod.listRelayModels();
      console.log(JSON.stringify(models.map(m => m.routeId)));
    `;
    const stdout = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      { env: { ...process.env, RELAY_AI_HOME: home }, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    expect(JSON.parse(stdout.trim().split('\n').pop()!)).toEqual(['groq::m1']);
    expect(readFileSync(join(home, 'providers.json'), 'utf8')).toBe(before);
    expect(readdirSync(home).sort()).toEqual(['providers.json']);
  });
});
