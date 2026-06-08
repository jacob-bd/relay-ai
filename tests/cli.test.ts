// tests/cli.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseArgs, rootHelpText, claudeHelpText, serverHelpText, modelsHelpText, main } from '../src/cli.js';

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

  it('reports unknown root subcommands', () => {
    expect(parseArgs(['codex'])).toMatchObject({
      command: 'root',
      error: 'Unknown command: codex',
    });
  });

  it('parses server command', () => {
    expect(parseArgs(['server'])).toMatchObject({
      command: 'server',
      showHelp: false,
      claudeArgs: [],
    });
  });

  it('parses server help', () => {
    expect(parseArgs(['server', '--help'])).toMatchObject({
      command: 'server',
      showHelp: true,
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
});

describe('help text', () => {
  it('root help documents v0.3.0 commands and local providers', () => {
    const help = rootHelpText();

    expect(help).toContain('v0.3.0');
    expect(help).toContain('opencode-starter claude');
    expect(help).toContain('opencode-starter models');
    expect(help).toContain('opencode-starter server');
    expect(help).toContain('local providers');
    expect(help).toContain('Commands:');
    expect(help).toContain('codex');
    expect(help).toContain('planned');
  });

  it('claude help includes starter options, providers, and switch menu', () => {
    const help = claudeHelpText();

    expect(help).toContain('v0.3.0');
    expect(help).toContain('opencode-starter claude --resume abc-123');
    expect(help).toContain('opencode-starter claude -c');
    expect(help).toContain('--dry-run');
    expect(help).toContain('--setup');
    expect(help).toContain('--trace');
    expect(help).toContain('Local');
    expect(help).toContain('Model switching');
    expect(help).toContain('opencode-starter models');
    expect(help).toContain('settings.json');
  });

  it('server help explains catalog, endpoints, and network behavior', () => {
    const help = serverHelpText();

    expect(help).toContain('v0.3.0');
    expect(help).toContain('opencode-starter server');
    expect(help).toContain('local providers');
    expect(help).toContain('17645');
    expect(help).toContain('ANTHROPIC_BASE_URL');
    expect(help).toContain('OPENAI_BASE_URL');
    expect(help).toContain('network');
    expect(help).toContain('saved only if');
  });

  it('models help explains favorites, local providers, and /model behavior', () => {
    const help = modelsHelpText();

    expect(help).toContain('v0.3.0');
    expect(help).toContain('opencode-starter models');
    expect(help).toContain('favorites');
    expect(help).toContain('local OpenCode provider');
    expect(help).toContain('/model');
    expect(help).toContain('10');
    expect(help).toContain('~/.opencode-starter/config.json');
  });
});

describe('main routing', () => {
  it('prints root help and returns 0 for no args', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(main([])).resolves.toBe(0);
    expect(log.mock.calls.flat().join('\n')).toContain('opencode-starter claude');
  });

  it('prints root help and returns 1 for unknown root subcommands', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(main(['codex'])).resolves.toBe(1);
    expect(error.mock.calls.flat().join('\n')).toContain('Unknown command: codex');
    expect(log.mock.calls.flat().join('\n')).toContain('opencode-starter claude');
  });

  it('prints server help and returns 0', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(main(['server', '--help'])).resolves.toBe(0);
    expect(log.mock.calls.flat().join('\n')).toContain('opencode-starter server');
  });
});
