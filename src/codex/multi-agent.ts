import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCodexCommandSync } from './process.js';

/** The Codex Router-compatible feature shape that exposes model overrides. */
export const CODEX_MULTI_AGENT_V2 = Object.freeze({
  enabled: true,
  max_concurrent_threads_per_session: 6,
  expose_spawn_agent_model_overrides: true,
});

export function renderMultiAgentV2Feature(): string {
  return '[features]\nmulti_agent_v2 = { enabled = true, max_concurrent_threads_per_session = 6, expose_spawn_agent_model_overrides = true }\n';
}

type ProbeResult = { stdout?: string | Buffer; stderr?: string | Buffer } | string | void;
type ProbeRunner = (binaryPath: string, args: string[], env: NodeJS.ProcessEnv) => ProbeResult;

function probeText(value: unknown): string {
  if (!value || typeof value !== 'object') return String(value ?? '');
  const result = value as { stdout?: unknown; stderr?: unknown };
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

/**
 * Ask the installed Codex binary whether it accepts the v2 feature block.
 * `login status` is intentional: it loads configuration but does not require
 * a successful login to answer the compatibility question.
 */
export function supportsMultiAgentV2(
  binaryPath: string,
  run: ProbeRunner = (path, args, env) => runCodexCommandSync(path, args, { timeout: 10_000, env }),
): boolean {
  const probeHome = mkdtempSync(join(tmpdir(), 'relay-codex-v2-probe-'));
  try {
    writeFileSync(join(probeHome, 'config.toml'), renderMultiAgentV2Feature(), { encoding: 'utf8', mode: 0o600 });
    const env = { ...process.env, CODEX_HOME: probeHome };
    let output = '';
    try {
      output = probeText(run(binaryPath, ['login', 'status'], env));
    } catch (error) {
      output = probeText(error);
    }
    if (/ENOENT|not found|cannot find the file/i.test(output)) return false;
    return !/error loading configuration|invalid configuration|unknown field/i.test(output);
  } finally {
    rmSync(probeHome, { recursive: true, force: true });
  }
}
