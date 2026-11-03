// src/claude-settings-cleanup.ts
//
// Claude Code persists the model chosen at launch (or via /model) to the user's
// settings.json. After a Relay session that leaves a Relay alias such as
// `anthropic-a2agent__DeepSeek-V4.1-Flash-1017[1m]` as the default, and a later
// bare `claude` fails against it (it is not an Anthropic model: no advisor tool,
// no gateway). Relay never writes settings.json at launch; it only undoes this
// one side effect when the session ends.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Relay-owned Claude model ids: prefixed aliases or the single pool model. */
export function isRelayAliasModel(value: unknown): boolean {
  return typeof value === 'string'
    && (/^anthropic-[^_\s]+__/.test(value) || /^claude-pool(?:\[1m\])?$/i.test(value));
}

export interface ClaudeModelSnapshot {
  path: string;
  hadModel: boolean;
  model?: unknown;
}

export function claudeSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude');
  return join(dir, 'settings.json');
}

function readSettings(path: string): Record<string, unknown> | undefined {
  try {
    if (!existsSync(path)) return undefined;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

export function snapshotClaudeModel(env: NodeJS.ProcessEnv = process.env): ClaudeModelSnapshot {
  const path = claudeSettingsPath(env);
  const settings = readSettings(path);
  const hadModel = !!settings && 'model' in settings;
  return { path, hadModel, ...(hadModel ? { model: settings!['model'] } : {}) };
}

/**
 * Put the user's `model` back if the session left a Relay alias in its place.
 * Touches nothing else, and does nothing when the model is not a Relay alias
 * (a deliberate non-Relay choice made during the session is respected).
 * Returns true when the file was changed. Never throws.
 */
export function restoreClaudeModel(snapshot: ClaudeModelSnapshot): boolean {
  try {
    const settings = readSettings(snapshot.path);
    if (!settings || !isRelayAliasModel(settings['model'])) return false;
    // An alias that was already there before launch is stale: drop it too.
    if (snapshot.hadModel && !isRelayAliasModel(snapshot.model)) {
      settings['model'] = snapshot.model;
    } else {
      delete settings['model'];
    }
    const tmp = `${snapshot.path}.relay-tmp`;
    writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, snapshot.path);
    return true;
  } catch {
    return false;
  }
}
