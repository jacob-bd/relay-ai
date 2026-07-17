import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MAX_MODEL_CATALOG, VERSION } from './constants.js';
import { loadPreferences } from './config.js';
import { getAppHome, getConfigPath, getProvidersPath } from './paths.js';
import { loadRegistry } from './registry/io.js';
import type { RegistryProvider } from './registry/types.js';

const SKILL_DIR_NAME = 'relay-ai-cli';
const SKILL_INSTALL_DIRS = [
  join(getAppHome(), 'skills'),
  join(homedir(), '.claude', 'skills'),
  join(homedir(), '.agents', 'skills'),
  join(homedir(), '.codex', 'skills'),
  join(homedir(), '.cursor', 'skills'),
  join(homedir(), '.cursor', 'skills-cursor'),
];

export interface AiSkillInstallResult {
  version: string;
  installed: string[];
  updated: Array<{ path: string; fromVersion: string | null }>;
  skipped: string[];
  failed: string[];
}

export function parseSkillVersion(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  for (const line of match[1]!.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('version:')) continue;
    const raw = trimmed.slice('version:'.length).trim();
    return raw.replace(/^["']|["']$/g, '');
  }
  return null;
}

function readInstalledSkillVersion(skillDir: string): string | null {
  const skillPath = join(skillDir, 'SKILL.md');
  if (!existsSync(skillPath)) return null;
  try {
    const head = readFileSync(skillPath, 'utf-8').slice(0, 1024);
    return parseSkillVersion(head.includes('---', 4) ? head : `${head}\n---\n`);
  } catch {
    return null;
  }
}

function skillInstallTargets(): Array<{ skillDir: string; skillPath: string }> {
  return SKILL_INSTALL_DIRS.map(dir => {
    const skillDir = join(dir, SKILL_DIR_NAME);
    return { skillDir, skillPath: join(skillDir, 'SKILL.md') };
  });
}

function formatProviderModels(provider: RegistryProvider): string {
  const models = provider.modelsCache?.models ?? [];
  if (models.length === 0) return `  (no cached models — run: relay-ai providers refresh-models ${provider.id})`;
  const lines = models.slice(0, 40).map(m => `    ${m.id}${m.name !== m.id ? `  (${m.name})` : ''}`);
  if (models.length > 40) lines.push(`    ... and ${models.length - 40} more`);
  return lines.join('\n');
}

function buildLiveStateSection(): string {
  const prefs = loadPreferences();
  const registry = loadRegistry();
  const enabled = registry.providers.filter(p => p.enabled);

  const prefLines: string[] = [];
  if (prefs.lastProvider || prefs.lastModel) {
    prefLines.push(`  Claude last launch: provider=${prefs.lastProvider ?? '(none)'} model=${prefs.lastModel ?? '(none)'}`);
  }
  if (prefs.lastCodexProvider || prefs.lastCodexModel) {
    prefLines.push(`  Codex last launch:  provider=${prefs.lastCodexProvider ?? '(none)'} model=${prefs.lastCodexModel ?? '(none)'}`);
  }
  if (prefs.lastGeminiProvider || prefs.lastGeminiModel) {
    prefLines.push(`  Gemini last launch: provider=${prefs.lastGeminiProvider ?? '(none)'} model=${prefs.lastGeminiModel ?? '(none)'}`);
  }
  if (prefs.favoriteModels?.length) {
    prefLines.push(`  Favorites (${prefs.favoriteModels.length}/${MAX_MODEL_CATALOG}):`);
    for (const f of prefs.favoriteModels) {
      prefLines.push(`    ${f.providerId} / ${f.modelId}`);
    }
  }

  const providerBlocks = enabled.length === 0
    ? ['  No registry providers configured. Built-in cloud: zen, go (OpenCode Zen/Go).']
    : enabled.map(p => [
      `  ${p.name} (${p.id}) — ${p.modelsCache?.models.length ?? 0} cached model(s)`,
      formatProviderModels(p),
    ].join('\n'));

  return `
================================================================================
CURRENT LOCAL STATE (from disk — no network)
================================================================================

Config:     ${getConfigPath()}
Providers:  ${getProvidersPath()}

Saved preferences:
${prefLines.length ? prefLines.join('\n') : '  (none — run an interactive launch first or pass --provider / --model)'}

Registry providers (enabled):
${providerBlocks.join('\n\n')}

Built-in cloud providers (always available when OPENCODE_API_KEY is set):
  zen  — OpenCode Zen (free + paid models)
  go   — OpenCode Go (paid models)

To refresh model lists after adding providers:
  relay-ai providers refresh-models
  relay-ai providers refresh-models <provider-id>

Zen/Go model IDs are fetched live at launch; run relay-ai claude --dry-run or
relay-ai codex --config to preview without starting a session.
`.trimEnd();
}

let cachedStaticAiDocBody: { version: string; body: string } | null = null;

function staticAiDocBody(): string {
  if (cachedStaticAiDocBody?.version === VERSION) return cachedStaticAiDocBody.body;

  const body = `
================================================================================
RELAY-AI — AI AGENT REFERENCE (v${VERSION})
================================================================================

relay-ai launches Claude Code, OpenAI Codex, Google Gemini CLI, and desktop apps
against YOUR provider registry (Groq, Mistral, OpenAI, Zen/Go, Ollama, custom endpoints, …).
It handles API translation, local proxies, env isolation, and model routing.

SKILL VERSIONING
  The installed skill version matches relay-ai --version (currently v${VERSION}).
  After upgrading relay-ai, run:
    relay-ai --ai --install
  Installs are skipped when the skill is already at the current version.
  Use --force to rewrite anyway (e.g. after editing providers without a release).

WHEN UNSURE: run \`relay-ai --ai\` before exploring or guessing commands.

================================================================================
QUICK START FOR AI AGENTS
================================================================================

1. Discover providers and model IDs (see DISCOVERY section below).
2. Launch non-interactively with boot flags — skip all wizards:
     relay-ai claude --provider <id> --model <model-id> -p "<prompt>"
     relay-ai codex --provider <id> --model <model-id> exec "<prompt>"
3. To query many models/tools in a loop, call relay-ai once per model with -p
   (Claude) or exec (Codex). Each invocation is a separate one-shot session.
4. For a persistent HTTP gateway (scripts, other tools): relay-ai server

================================================================================
DISCOVERY — PROVIDERS AND MODELS
================================================================================

LIST CONFIGURED PROVIDERS (human-readable):
  relay-ai providers list

MACHINE-READABLE MODEL CATALOG (recommended for agents):
  Read ~/.relay-ai/providers.json
    → providers[].id          provider id for --provider
    → providers[].modelsCache.models[].id   model id for --model
    → providers[].enabled     skip if false

REFRESH STALE MODEL LISTS:
  relay-ai providers refresh-models
  relay-ai providers refresh-models groq

BUILT-IN CLOUD PROVIDERS (not in providers.json):
  Provider id: zen   (OpenCode Zen — requires OPENCODE_API_KEY)
  Provider id: go    (OpenCode Go — requires OPENCODE_API_KEY)

PREVIEW LAUNCH WITHOUT STARTING A SESSION:
  relay-ai claude --dry-run --provider groq --model <model-id>
  relay-ai codex --config --provider zen --model <model-id>

INTERACTIVE BROWSE (requires TTY — avoid in agent scripts):
  relay-ai claude          provider + model wizard
  relay-ai codex           provider + model wizard
  relay-ai gemini          provider + model wizard
  relay-ai providers       provider management hub

================================================================================
AGENT PLATFORM PATTERNS — MULTI-MODEL / ONE-SHOT QUERIES
================================================================================

relay-ai is designed so agents can use Claude Code, Codex, or Gemini CLI as a PLATFORM:
run many models sequentially or in parallel shell jobs, each with a focused
prompt, without interactive wizards.

CLAUDE CODE — PRINT MODE (-p / --print)
  Skips the provider/model wizard when:
    • Both --provider and --model are set, OR
    • Print mode (-p / --print) and saved preferences exist from a prior launch

  Examples:
    relay-ai claude --provider groq --model llama-3.3-70b-versatile -p "Summarize README.md"
    relay-ai claude --provider zen --model deepseek-v4-flash-free -p "Review this diff"
    relay-ai claude -p "quick question"    # uses lastProvider + lastModel from config

  Pass additional Claude Code flags after relay-ai flags:
    relay-ai claude --provider groq --model llama-3.3-70b-versatile -p "task" --output-format json

  Machine-readable stdout (relay-ai stays silent on stdout — boot UI goes to stderr):
    relay-ai claude --provider zen --model deepseek-v4-flash-free -p "task" --output-format stream-json
    relay-ai codex --provider zen --model deepseek-v4-flash-free exec --json "task"

  Triggers clean stdout:
    Claude: -p/--print + (--output-format stream-json|json OR --input-format stream-json)
    Codex:  exec subcommand + --json

  relay-ai auto-adds --verbose when Claude uses stream-json without it.
  Interactive TTY launches (no stream-json / exec --json) still show normal human UI.

  Boot flags (relay-ai — NOT passed to Claude):
    --provider <id>     Provider id (from providers list or providers.json)
    --model <id>        Model id, or slug form: provider__model-id

OPENAI CODEX — NON-INTERACTIVE (exec / positional prompt)
  Skips the provider/model wizard when:
    • Both --provider and --model are set, OR
    • Non-interactive args (exec subcommand or positional prompt) and saved prefs exist

  Examples:
    relay-ai codex --provider zen --model deepseek-v4-flash-free exec "fix the failing test"
    relay-ai codex --model zen__deepseek-v4-flash-free exec "fix the bug"
    relay-ai codex --provider openai --model gpt-5.4 exec "implement feature X"

  Codex does NOT use -p for print — relay-ai blocks -p (Codex uses it for --profile).

  Boot flags (relay-ai — NOT passed to Codex):
    --provider <id>
    --model <id>        or provider__model-id slug

GOOGLE GEMINI CLI — NON-INTERACTIVE (-p / --prompt)
  Skips the provider/model wizard when:
    • Both --provider and --model are set, OR
    • Non-interactive args (-p / --prompt, -i / --prompt-interactive, or positional query)
      and saved preferences exist

  Examples:
    relay-ai gemini --provider google --model gemini-2.5-flash -p "Review this file"
    relay-ai gemini -p "What is the capital of France?"

  Machine-readable stdout:
    relay-ai gemini --provider google --model gemini-2.5-flash -p "task" -o json
    relay-ai gemini --provider google --model gemini-2.5-flash -p "task" -o stream-json

  Boot flags (relay-ai — NOT passed to Gemini):
    --provider <id>
    --model <id>        or provider__model-id slug

MULTI-MODEL LOOP (shell pattern):
  for model in llama-3.3-70b-versatile mixtral-8x7b-32768; do
    relay-ai claude --provider groq --model "$model" -p "Same prompt for all models"
  done

  for model in deepseek-v4-flash-free qwen3.6-plus-free; do
    relay-ai codex --provider zen --model "$model" exec "Same task"
  done

  for model in gemini-2.5-flash gemini-2.5-pro; do
    relay-ai gemini --provider google --model "$model" -p "Same task"
  done

FAVORITES / MID-SESSION SWITCHING:
  relay-ai models              interactive favorites manager (max ${MAX_MODEL_CATALOG})
  When favorites exist, interactive claude/codex/gemini launches expose /model switching.
  Boot flags (--provider + --model) or print/exec/-p mode use SINGLE-MODEL launch
  (favorites catalog is skipped — better for agent one-shots).
  Exception: Claude --http-proxy combines the selected compatible model with
  compatible saved favorites while keeping native Anthropic models available.

================================================================================
COMMANDS
================================================================================

ROOT
  relay-ai --ai              Print this reference (stdout)
  relay-ai --ai --install    Install or upgrade SKILL.md when relay-ai version changed
  relay-ai --ai --install --force  Reinstall skill even if version already matches
  relay-ai --help            Short human help
  relay-ai --version         Version string

CLAUDE CODE
  relay-ai claude [relay-options] [claude-flags]

  Relay options:
    --provider <id>    Boot provider (skip wizard with --model)
    --model <id>       Boot model id or provider__model slug
    --http-proxy      Keep native Anthropic auth/models and add selected/favorite Relay models
    --dry-run          Preview launch, do not start Claude
    --trace            Debug logs in ~/.relay-ai/logs/
    --setup            Hint to use relay-ai providers

  Common Claude flags (passed through):
    -p, --print         One-shot print mode (agent-friendly)
    -c                  Continue previous session
    --resume <id>       Resume session
    --model <id>        Claude's own model flag (overridden by relay-ai at launch)

  Examples:
    relay-ai claude
    relay-ai claude --provider anthropic --model claude-sonnet-4-6 -p "review file.ts"
    relay-ai claude --http-proxy --provider moonshot --model kimi-k3 -p "review file.ts"
    relay-ai claude --dry-run --provider groq --model llama-3.3-70b-versatile

GOOGLE GEMINI CLI
  relay-ai gemini [relay-options] [gemini-flags]

  Relay options:
    --provider <id>    Boot provider (skip wizard with --model)
    --model <id>       Boot model id or provider__model slug
    --trace            Debug logs in ~/.relay-ai/logs/

  Examples:
    relay-ai gemini
    relay-ai gemini --provider google --model gemini-2.5-flash -p "What is the capital of France?"

OPENAI CODEX CLI
  relay-ai codex [relay-options] [codex-flags]

  Relay options:
    --provider <id>
    --model <id>
    --trace
    --restore          Remove leftover overlay files after crash
    --config           Write profile/catalog files and exit (no Codex process)

  relay-ai manages: --profile, -m, -p (profile), --provider, --model
  Sandbox defaults to danger-full-access (profile + -s flag) for network shell tools.
  Override with -s workspace-write or pass --dangerously-bypass-approvals-and-sandbox.

  Examples:
    relay-ai codex
    relay-ai codex --provider zen --model deepseek-v4-flash-free exec "fix bug"
    relay-ai codex --provider zen --model deepseek-v4-flash-free exec --json "fix bug"
    relay-ai codex -s workspace-write exec "locked down"
    relay-ai codex --trace
    relay-ai codex --restore

PROVIDERS REGISTRY
  relay-ai providers              interactive hub
  relay-ai providers add          add Groq, Mistral, OpenAI, custom URL, …
  relay-ai providers import       one-time import from OpenCode config
  relay-ai providers list         show provider ids and model counts
  relay-ai providers remove <id>
  relay-ai providers refresh-models [id]
  relay-ai providers auth <id>    OAuth (OpenAI ChatGPT, xAI, …)

MODELS / FAVORITES
  relay-ai models                 manage favoriteModels in config (alias: favorites)
  Used for mid-session /model switching in interactive Claude/Codex/Gemini sessions.

API GATEWAY (for tools that speak Anthropic/OpenAI HTTP)
  relay-ai server                 foreground gateway on port 17645
  relay-ai server --vertex        Vertex AI gateway (gcloud ADC)

DESKTOP APPS
  relay-ai codex-app              ChatGPT desktop, Codex mode (macOS/Windows); alias: chatgpt
  relay-ai claude-app             Claude desktop (macOS/Windows)

================================================================================
CONFIGURATION PATHS
================================================================================

  ~/.relay-ai/config.json         preferences (lastProvider, lastModel, favorites, …)
  ~/.relay-ai/providers.json      provider registry + cached model lists (no secrets)
  ~/.relay-ai/logs/               trace/debug logs when --trace is used
  OPENCODE_API_KEY                required for zen/go cloud providers
  RELAY_AI_HOME                   override ~/.relay-ai

Credentials live in OS keychain (macOS/Windows/Linux Secret Service), not in
providers.json. Use relay-ai providers auth or add flows to configure keys.

================================================================================
AGENT RULES OF THUMB
================================================================================

DO:
  • Run relay-ai --ai when unsure about commands or model ids
  • Use --provider + --model for every non-interactive agent invocation
  • Use Claude -p / Codex exec for one-shot tasks that must exit
  • Read providers.json for authoritative model id lists
  • Run relay-ai providers refresh-models after adding providers

DO NOT:
  • Rely on interactive wizards in CI, scripts, or headless agent loops
  • Pass --provider / --model to Claude, Codex, or Gemini directly — relay-ai consumes them
  • Use Codex -p expecting print mode (it means --profile in Codex)
  • Assume favorites catalog in print/exec/-p mode — use explicit boot flags
  • Mutate settings files (e.g. ~/.claude/settings.json, ~/.codex/config.toml, ~/.gemini/config/config.json) — relay-ai uses env +
    temporary overlay profiles only

NON-TTY:
  relay-ai codex requires --provider + --model (or saved prefs) when stdin is not
  a TTY. relay-ai claude print mode (-p) skips wizard with prefs or boot flags.

================================================================================
TROUBLESHOOTING
================================================================================

  relay-ai codex --restore         clean stale overlay after crash
  relay-ai claude --trace          proxy + Claude debug logs
  relay-ai codex --trace           proxy debug log on exit
  relay-ai gemini --trace          proxy debug log on exit
  relay-ai providers list          verify provider ids
  relay-ai providers refresh-models  repopulate model cache

Common errors:
  "Provider/model not found"       wrong id — check providers.json or providers list
  "Print mode requires …"          set --provider and --model, or run interactive once
  "requires an interactive terminal"  add --provider and --model for codex in CI
  JSON parse error on stdout line 1  missing stream-json (Claude) or exec --json (Codex)
  404 unknown model (Codex favs)   ensure zen/go routes — use --provider zen explicitly
  DeepSeek tool loop 400           update relay-ai — reasoning round-trip in Codex proxy
  Codex shell network blocked      default is danger-full-access; check relay-ai codex --config

Human-readable guide: docs/AI-AGENTS.md in the relay-ai repo.

================================================================================
ALEF AGENT INTEGRATION
================================================================================

alef-agent shells out to relay-ai to run Claude Code, Codex, or Gemini CLI against any
provider in ~/.relay-ai/providers.json. relay-ai is a launcher + proxy; the
child CLI owns NDJSON/JSONL on stdout.

WHEN TO USE RELAY-AI AS THE EXECUTABLE
  Instead of spawning claude or codex directly, spawn relay-ai with boot flags
  prepended. alef parses stdout as JSONL; relay-ai must not pollute stdout.

STDOUT / STDERR CONTRACT
  Machine-readable mode (Claude stream-json/json, Codex exec --json):
    stdout → child JSON only (every non-empty line must parse as JSON)
    stderr → relay-ai boot messages and errors (log or discard; do not parse)
    exit code → relay-ai launch failure OR child exit code

  Human interactive mode (relay-ai claude with no -p):
    stdout → normal TUI (do not parse as JSON)

RECOMMENDED SPAWN — CLAUDE BACKEND (NDJSON)
  relay-ai claude \\
    --provider <provider-id> \\
    --model <model-id> \\
    -p "<prompt>" \\
    --output-format stream-json \\
    [--verbose] \\
    [--max-turns N] \\
    [--permission-mode bypassPermissions] \\
    [--allow-dangerously-skip-permissions] \\
    [--allowed-tools tool1,tool2]

  Slug alternative:
    relay-ai claude --model zen__deepseek-v4-flash-free -p "..." --output-format stream-json

  relay-ai injects --verbose automatically when stream-json is used without it.

RECOMMENDED SPAWN — CODEX BACKEND (JSONL)
  relay-ai codex \\
    --provider <provider-id> \\
    --model <model-id> \\
    exec --json "<prompt>"

  Slug alternative:
    relay-ai codex --model zen__deepseek-v4-flash-free exec --json "..."

  Do NOT use -p for Codex print — Codex -p means --profile (relay-ai blocks it).

PROVIDER / MODEL DISCOVERY FOR ALEF CONFIG
  1. relay-ai providers list
  2. Read ~/.relay-ai/providers.json → providers[].id, modelsCache.models[].id
  3. relay-ai providers refresh-models  (after adding providers)
  4. Built-ins: zen, go (require OPENCODE_API_KEY in env or keychain)
  5. relay-ai --ai  (includes live state section at bottom of output)

ALEF CHECKLIST
  □ relay-ai on PATH (npm install -g @jacobbd/relay-ai; dev: npm link after builds)
  □ Always pass --provider + --model (or provider__model slug) — never rely on wizard
  □ Claude: --output-format stream-json (or json) with -p
  □ Codex: exec --json (not bare codex exec without --json if parsing stdout)
  □ Gemini: -o json (or stream-json) with -p
  □ Parse stdout only; ignore stderr for JSONL/NDJSON stream
  □ Zen/Go: --provider zen explicitly + OPENCODE_API_KEY available
  □ Codex network: default danger-full-access — no extra -s needed for nlm/curl/npm
  □ MCP (Claude): --allowed-tools mcp__server__tool on claude args after relay-ai flags
  □ MCP (Codex): configure in ~/.codex/config.toml (relay-ai does not inject MCP list)
  □ Install skill for agents: relay-ai --ai --install

VERIFY CLEAN STDOUT (run before wiring alef backend)
  relay-ai claude --provider zen --model deepseek-v4-flash-free \\
    -p "PONG" --output-format stream-json 2>/dev/null \\
    | node -e "process.stdin.on('data',d=>d.toString().split('\\\\n').filter(Boolean).forEach(l=>JSON.parse(l))); console.log('claude ok')"

  relay-ai codex --provider zen --model deepseek-v4-flash-free \\
    exec --json "PONG" 2>/dev/null \\
    | node -e "process.stdin.on('data',d=>d.toString().split('\\\\n').filter(Boolean).forEach(l=>JSON.parse(l))); console.log('codex ok')"

MULTI-MODEL ALEF LOOPS
  Each relay-ai invocation is one session. Loop in alef/shell with different --model values.
  Favorites catalog is NOT used in print/exec mode — always explicit boot flags.

TOOL CALLING EXAMPLE (Claude + MCP)
  relay-ai claude --provider google --model gemini-2.5-flash \\
    -p "How many notebooks?" \\
    --output-format stream-json \\
    --allowed-tools mcp__notebooklm-mcp__notebook_list

RELATED DOCS
  docs/AI-AGENTS.md     human-readable agent guide (this repo)
  docs/CODEX.md         Codex CLI, sandbox, restore, routing
  relay-ai --ai         full reference + live provider state
`.trimEnd();

  cachedStaticAiDocBody = { version: VERSION, body };
  return body;
}

export function generateAiDoc(): string {
  const frontmatter = `---
name: relay-ai-cli
description: "Launch Claude Code and OpenAI Codex against your AI provider registry. Use for alef-agent, multi-model agent workflows, NDJSON stream-json, and non-interactive codex exec --json."
version: "${VERSION}"
type: tool
status: approved
---

# relay-ai CLI Reference (v${VERSION})

`;

  return frontmatter + staticAiDocBody() + '\n\n' + buildLiveStateSection() + '\n';
}

export function installAiDoc(opts: { force?: boolean } = {}): AiSkillInstallResult {
  const version = VERSION;
  const result: AiSkillInstallResult = {
    version,
    installed: [],
    updated: [],
    skipped: [],
    failed: [],
  };

  const targets = skillInstallTargets();
  if (!opts.force && targets.every(({ skillDir }) => readInstalledSkillVersion(skillDir) === version)) {
    result.skipped.push(...targets.map(t => t.skillPath));
    return result;
  }

  const doc = generateAiDoc();
  for (const { skillDir, skillPath } of targets) {
    try {
      const previous = readInstalledSkillVersion(skillDir);
      if (!opts.force && previous === version) {
        result.skipped.push(skillPath);
        continue;
      }
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(skillPath, doc, 'utf-8');
      if (previous) {
        result.updated.push({ path: skillPath, fromVersion: previous });
      } else {
        result.installed.push(skillPath);
      }
    } catch {
      result.failed.push(skillPath);
    }
  }

  return result;
}

export function printAiInstallResult(result: AiSkillInstallResult): number {
  console.error(`relay-ai agent skill target version: v${result.version}`);
  if (result.installed.length > 0) {
    console.error(`Installed ${result.installed.length} new skill(s):`);
    for (const path of result.installed) console.error(`  ✓ ${path}`);
  }
  if (result.updated.length > 0) {
    console.error(`Updated ${result.updated.length} skill(s):`);
    for (const { path, fromVersion } of result.updated) {
      const from = fromVersion ? `v${fromVersion}` : 'unknown';
      console.error(`  ✓ ${path} (${from} → v${result.version})`);
    }
  }
  if (result.skipped.length > 0) {
    console.error(`Skipped ${result.skipped.length} (already v${result.version}):`);
    for (const path of result.skipped) console.error(`  · ${path}`);
  }
  if (result.failed.length > 0) {
    console.error(`Failed ${result.failed.length}:`);
    for (const path of result.failed) console.error(`  ✗ ${path}`);
  }
  return result.failed.length > 0 ? 1 : 0;
}
