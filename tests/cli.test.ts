// tests/cli.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseArgs, rootHelpText, claudeHelpText, serverHelpText, modelsHelpText, main } from '../src/cli.js';
import { VERSION } from '../src/constants.js';
import { codexHelpText } from '../src/codex.js';
import { codexAppHelpText } from '../src/codex-app.js';
import { claudeAppHelpText } from '../src/claude-app.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseArgs', () => {
  it('parses bare root command without launching claude', () => {
    expect(parseArgs([])).toEqual({
      command: 'root',
      showHelp: true,
      showVersion: false,
      dryRun: false,
      setup: false,
      trace: false,
      vertex: false,
      claudeArgs: [],
    });
  });

  it('parses root help', () => {
    expect(parseArgs(['--help'])).toMatchObject({
      command: 'root',
      showHelp: true,
      claudeArgs: [],
    });
  });

  it('parses root version', () => {
    expect(parseArgs(['--version'])).toMatchObject({
      command: 'root',
      showVersion: true,
      claudeArgs: [],
    });
  });

  it('parses claude command with no passthrough args', () => {
    expect(parseArgs(['claude'])).toMatchObject({
      command: 'claude',
      showHelp: false,
      dryRun: false,
      setup: false,
      trace: false,
      claudeArgs: [],
    });
  });

  it('parses Claude and server HTTP proxy mode', () => {
    expect(parseArgs(['claude', '--http-proxy', '-c'])).toMatchObject({
      command: 'claude',
      httpProxy: true,
      claudeArgs: ['-c'],
    });
    expect(parseArgs(['server', '--http-proxy'])).toMatchObject({
      command: 'server',
      httpProxy: true,
    });
  });

  it('passes claude -c through unchanged', () => {
    expect(parseArgs(['claude', '-c']).claudeArgs).toEqual(['-c']);
  });

  it('passes claude resume session through unchanged', () => {
    expect(parseArgs(['claude', '--resume', 'abc-123']).claudeArgs).toEqual(['--resume', 'abc-123']);
  });

  it('keeps starter dry-run while passing claude -c through', () => {
    expect(parseArgs(['claude', '--dry-run', '-c'])).toMatchObject({
      command: 'claude',
      dryRun: true,
      claudeArgs: ['-c'],
    });
  });

  it('passes everything after separator to claude unchanged', () => {
    expect(parseArgs(['claude', '--', '--print', 'hello']).claudeArgs).toEqual(['--print', 'hello']);
  });

  it('treats claude help as starter claude help', () => {
    expect(parseArgs(['claude', '--help'])).toMatchObject({
      command: 'claude',
      showHelp: true,
      claudeArgs: [],
    });
  });

  it('parses codex-app command', () => {
    expect(parseArgs(['codex-app'])).toMatchObject({
      command: 'codex-app',
      showHelp: false,
      claudeArgs: [],
    });
  });

  it('parses codex command', () => {
    expect(parseArgs(['codex'])).toMatchObject({
      command: 'codex',
      showHelp: false,
      claudeArgs: [],
    });
  });

  it('parses codex help flag', () => {
    expect(parseArgs(['codex', '--help'])).toMatchObject({
      command: 'codex',
      showHelp: true,
    });
  });

  it('consumes codex --trace without passing it to Codex CLI', () => {
    expect(parseArgs(['codex', '--trace'])).toMatchObject({
      command: 'codex',
      trace: true,
      claudeArgs: [],
    });
    expect(parseArgs(['codex', '--trace', '-s', 'danger-full-access'])).toMatchObject({
      command: 'codex',
      trace: true,
      claudeArgs: ['-s', 'danger-full-access'],
    });
  });

  it('consumes relay launch flags for claude and codex', () => {
    expect(parseArgs(['claude', '--provider', 'groq', '--model', 'llama-3.3-70b', '-p', 'hi'])).toMatchObject({
      command: 'claude',
      launchProvider: 'groq',
      launchModel: 'llama-3.3-70b',
      claudeArgs: ['-p', 'hi'],
    });
    expect(parseArgs(['codex', '--provider=zen', '--model=deepseek-v4-flash-free', 'exec', 'fix'])).toMatchObject({
      command: 'codex',
      launchProvider: 'zen',
      launchModel: 'deepseek-v4-flash-free',
      claudeArgs: ['exec', 'fix'],
    });
  });

  it('parses server command', () => {
    expect(parseArgs(['server'])).toMatchObject({
      command: 'server',
      showHelp: false,
      vertex: false,
      claudeArgs: [],
    });
  });

  it('parses server --vertex', () => {
    expect(parseArgs(['server', '--vertex'])).toMatchObject({
      command: 'server',
      vertex: true,
      showHelp: false,
    });
  });

  it('parses server quick-start aliases', () => {
    expect(parseArgs(['server', '--quick'])).toMatchObject({
      command: 'server',
      serverQuick: true,
    });
    expect(parseArgs(['server', '--saved'])).toMatchObject({
      command: 'server',
      serverQuick: true,
    });
  });

  it('parses one-run server options', () => {
    expect(parseArgs([
      'server',
      '--quick',
      '--listen',
      'network',
      '--providers',
      'openai,anthropic',
      '--free-only',
      '--no-mask-gateway-ids',
      '--password',
      'secret',
    ])).toMatchObject({
      command: 'server',
      serverQuick: true,
      serverListenMode: 'network',
      serverProvidersMode: 'specific',
      serverProviderIds: ['openai', 'anthropic'],
      serverFreeOnly: true,
      serverMaskGatewayIds: false,
      serverPassword: 'secret',
    });
  });

  it('parses server provider presets and mask flag', () => {
    expect(parseArgs(['server', '--providers', 'all', '--mask-gateway-ids'])).toMatchObject({
      command: 'server',
      serverProvidersMode: 'all',
      serverMaskGatewayIds: true,
    });
    expect(parseArgs(['server', '--providers=favorites'])).toMatchObject({
      command: 'server',
      serverProvidersMode: 'favorites',
    });
    expect(parseArgs(['server', '--no-free-only'])).toMatchObject({
      command: 'server',
      serverFreeOnly: false,
    });
  });

  it('parses server help', () => {
    expect(parseArgs(['server', '--help'])).toMatchObject({
      command: 'server',
      showHelp: true,
    });
  });

  it('rejects removed server flags', () => {
    expect(parseArgs(['server', '--select'])).toMatchObject({
      command: 'server',
      error: 'Unknown server option: --select',
    });
    expect(parseArgs(['server', '--favorites'])).toMatchObject({
      command: 'server',
      error: 'Unknown server option: --favorites',
    });
    expect(parseArgs(['server', '--mask-vendors'])).toMatchObject({
      command: 'server',
      error: 'Unknown server option: --mask-vendors',
    });
  });

  it('rejects unknown server options', () => {
    expect(parseArgs(['server', '--port', '1234'])).toMatchObject({
      command: 'server',
      error: 'Unknown server option: --port',
    });
  });

  it('parses models command', () => {
    expect(parseArgs(['models'])).toMatchObject({
      command: 'models',
      showHelp: false,
      claudeArgs: [],
    });
  });

  it('parses non-interactive HTTP proxy model listing', () => {
    expect(parseArgs(['models', '--list'])).toMatchObject({
      command: 'models',
      favoritesList: true,
    });
  });

  it('parses favorites --agy command', () => {
    expect(parseArgs(['favorites', '--agy'])).toMatchObject({
      command: 'models',
      favoritesAgy: true,
      showHelp: false,
      claudeArgs: [],
    });
  });

  it('parses models help', () => {
    expect(parseArgs(['models', '--help'])).toMatchObject({
      command: 'models',
      showHelp: true,
    });
  });

  it('rejects unknown models options', () => {
    expect(parseArgs(['models', '--filter', 'groq'])).toMatchObject({
      command: 'models',
      error: 'Unknown models option: --filter',
    });
  });

  it('parses providers command', () => {
    expect(parseArgs(['providers'])).toMatchObject({
      command: 'providers',
      showHelp: false,
      claudeArgs: [],
    });
  });

  it('consumes ui --trace', () => {
    expect(parseArgs(['ui', '--trace'])).toMatchObject({
      command: 'ui',
      trace: true,
      claudeArgs: [],
    });
  });

  it('parses providers import subcommand', () => {
    expect(parseArgs(['providers', 'import'])).toMatchObject({
      command: 'providers',
      claudeArgs: ['import'],
    });
  });

  it('parses providers help', () => {
    expect(parseArgs(['providers', '--help'])).toMatchObject({
      command: 'providers',
      showHelp: true,
    });
  });
});

describe('help text', () => {
  it('root help documents every accepted command and alias', () => {
    const help = rootHelpText();
    const commands = [
      'claude',
      'claude-app',
      'codex',
      'codex-app',
      'antigravity',
      'server',
      'models',
      'favorites',
      'providers',
    ];

    expect(help).toContain(`v${VERSION}`);
    for (const command of commands) {
      expect(help).toContain(`relay-ai ${command}`);
      expect(parseArgs([command]).error).toBeUndefined();
    }
    expect(help).toContain('relay-ai --version');
    expect(help).toContain('relay-ai --help');
    expect(help).toContain('relay-ai --ai');
    for (const option of ['-h', '--help', '-v', '--version', '--ai', '--install', '--force']) {
      expect(help).toContain(option);
    }
    expect(help).toContain('local providers');
    expect(help).toContain('Commands:');
    expect(help).toContain('Launch OpenAI Codex CLI');
    expect(help).toContain('relay-ai antigravity');
    expect(help).toContain('six Antigravity favorites');
  });

  it('claude help includes starter options, providers, and switch menu', () => {
    const help = claudeHelpText();

    expect(help).toContain(`v${VERSION}`);
    expect(help).toContain('relay-ai claude --resume abc-123');
    expect(help).toContain('relay-ai claude -c');
    expect(help).toContain('--dry-run');
    expect(help).toContain('--setup');
    expect(help).toContain('--trace');
    expect(help).toContain('--provider');
    expect(help).toContain('--model');
    expect(help).toContain('Registry');
    expect(help).toContain('Model switching');
    expect(help).toContain('relay-ai models');
    expect(help).toContain('settings.json');
  });

  it('server help explains wizard, endpoints, and network behavior', () => {
    const help = serverHelpText();
    expect(help).toContain('wizard');
    expect(help).toMatch(/Claude[\s\S]*Cowork/);

    expect(help).toContain(`v${VERSION}`);
    expect(help).toContain('relay-ai server');
    expect(help).toContain('relay-ai server --quick');
    expect(help).toContain('relay-ai server --vertex');
    for (const option of ['--quick', '--saved', '--listen', '--providers', '--free-only', '--no-free-only', '--mask-gateway-ids', '--no-mask-gateway-ids', '--password']) {
      expect(help).toContain(option);
    }
    expect(help).toContain('registry providers');
    expect(help).toContain('Vertex AI');
    expect(help).toContain('17645');
    expect(help).toContain('ANTHROPIC_BASE_URL');
    expect(help).toContain('OPENAI_BASE_URL');
    expect(help).toContain('network');
    expect(help).toContain('server password');
    expect(help).toContain('assets/vertex-models.example.json');
  });

  it('models help explains favorites, local providers, and /model behavior', () => {
    const help = modelsHelpText();

    expect(help).toContain(`v${VERSION}`);
    expect(help).toContain('relay-ai favorites');
    expect(help).toContain('relay-ai favorites --agy');
    expect(help).toContain('favorites');
    expect(help).toContain('registry');
    expect(help).toContain('/model');
    expect(help).toContain('20');
    expect(help).toContain('6');
    expect(help).toContain('Antigravity CLI favorites');
    expect(help).toContain('~/.relay-ai/config.json');
  });

  it('app and Codex help document every relay-ai-managed option', () => {
    const codex = codexHelpText();
    for (const option of ['--trace', '--provider', '--model', '--vertex', '--restore', '--config', '--help', '--version']) {
      expect(codex).toContain(option);
    }

    const codexApp = codexAppHelpText();
    for (const option of ['--vertex', '--restore', '--config', '--help', '--version']) {
      expect(codexApp).toContain(option);
    }

    const claudeApp = claudeAppHelpText();
    for (const option of ['--trace', '--restore', '--help', '--version']) {
      expect(claudeApp).toContain(option);
    }
  });
});

describe('main routing', () => {
  it('prints root help and returns 0 for no args', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(main([])).resolves.toBe(0);
    expect(log.mock.calls.flat().join('\n')).toContain('relay-ai claude');
  });

  it('prints root help and returns 1 for unknown root subcommands', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(main(['not-a-command'])).resolves.toBe(1);
    expect(error.mock.calls.flat().join('\n')).toContain('Unknown command: not-a-command');
    expect(log.mock.calls.flat().join('\n')).toContain('relay-ai claude');
  });

  it('prints server help and returns 0', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(main(['server', '--help'])).resolves.toBe(0);
    expect(log.mock.calls.flat().join('\n')).toContain('relay-ai server');
  });
});

describe('parseArgs — antigravity commands', () => {
  it('parses antigravity app command with no passthrough args', () => {
    expect(parseArgs(['antigravity'])).toMatchObject({
      command: 'antigravity',
      showHelp: false,
      dryRun: false,
      trace: false,
      claudeArgs: [],
    });
  });

  it('parses antigravity app --help', () => {
    expect(parseArgs(['antigravity', '--help'])).toMatchObject({
      command: 'antigravity',
      showHelp: true,
      claudeArgs: [],
    });
  });

  it('consumes relay launch flags for antigravity app', () => {
    expect(parseArgs(['antigravity', '--provider=zen', '--model=deepseek-v4-flash-free', '--wait'])).toMatchObject({
      command: 'antigravity',
      launchProvider: 'zen',
      launchModel: 'deepseek-v4-flash-free',
      claudeArgs: ['--wait'],
    });
  });

  it('parses agy command with no passthrough args', () => {
    expect(parseArgs(['agy'])).toMatchObject({
      command: 'agy',
      showHelp: false,
      dryRun: false,
      trace: false,
      claudeArgs: [],
    });
  });

  it('parses agy --help', () => {
    expect(parseArgs(['agy', '--help'])).toMatchObject({
      command: 'agy',
      showHelp: true,
      claudeArgs: [],
    });
  });

  it('parses agy --version', () => {
    expect(parseArgs(['agy', '--version'])).toMatchObject({
      command: 'agy',
      showVersion: true,
      claudeArgs: [],
    });
  });

  it('passes agy passthrough args unchanged', () => {
    expect(parseArgs(['agy', '-p', 'say hello']).claudeArgs).toEqual(['-p', 'say hello']);
  });

  it('consumes agy --trace without passing it to agy', () => {
    expect(parseArgs(['agy', '--trace'])).toMatchObject({
      command: 'agy',
      trace: true,
    });
    expect(parseArgs(['agy', '--trace']).claudeArgs).toEqual([]);
  });

  it('consumes relay launch flags for agy', () => {
    expect(parseArgs(['agy', '--provider=zen', '--model=deepseek-v4-flash-free', '-p', 'fix'])).toMatchObject({
      command: 'agy',
      launchProvider: 'zen',
      launchModel: 'deepseek-v4-flash-free',
      claudeArgs: ['-p', 'fix'],
    });
  });

  it('passes everything after separator to agy unchanged', () => {
    expect(parseArgs(['agy', '--', '-p', 'hello']).claudeArgs).toEqual(['-p', 'hello']);
  });

  it('parses antigravity-ide command with no passthrough args', () => {
    expect(parseArgs(['antigravity-ide'])).toMatchObject({
      command: 'antigravity-ide',
      showHelp: false,
      dryRun: false,
      trace: false,
      claudeArgs: [],
    });
  });

  it('parses antigravity-ide --help', () => {
    expect(parseArgs(['antigravity-ide', '--help'])).toMatchObject({
      command: 'antigravity-ide',
      showHelp: true,
      claudeArgs: [],
    });
  });

  it('consumes antigravity-ide --trace', () => {
    expect(parseArgs(['antigravity-ide', '--trace'])).toMatchObject({
      command: 'antigravity-ide',
      trace: true,
    });
    expect(parseArgs(['antigravity-ide', '--trace']).claudeArgs).toEqual([]);
  });

  it('passes antigravity-ide passthrough args unchanged', () => {
    expect(parseArgs(['antigravity-ide', '--user-data-dir', '/tmp/test']).claudeArgs).toEqual(['--user-data-dir', '/tmp/test']);
  });
});
