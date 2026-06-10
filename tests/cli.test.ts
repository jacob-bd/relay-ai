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
  it('root help documents v0.1.0 commands and local providers', () => {
    const help = rootHelpText();

    expect(help).toContain('v0.1.0');
    expect(help).toContain('relay-ai claude');
    expect(help).toContain('relay-ai models');
    expect(help).toContain('relay-ai providers');
    expect(help).toContain('relay-ai server');
    expect(help).toContain('local providers');
    expect(help).toContain('Commands:');
    expect(help).toContain('codex');
    expect(help).toContain('planned');
  });

  it('claude help includes starter options, providers, and switch menu', () => {
    const help = claudeHelpText();

    expect(help).toContain('v0.1.0');
    expect(help).toContain('relay-ai claude --resume abc-123');
    expect(help).toContain('relay-ai claude -c');
    expect(help).toContain('--dry-run');
    expect(help).toContain('--setup');
    expect(help).toContain('--trace');
    expect(help).toContain('Local');
    expect(help).toContain('Model switching');
    expect(help).toContain('relay-ai models');
    expect(help).toContain('settings.json');
  });

  it('server help explains wizard, endpoints, and network behavior', () => {
    const help = serverHelpText();
    expect(help).toContain('wizard');
    expect(help).toMatch(/Claude[\s\S]*Cowork/);

    expect(help).toContain('v0.1.0');
    expect(help).toContain('relay-ai server');
    expect(help).toContain('relay-ai server --vertex');
    expect(help).toContain('local OpenCode providers');
    expect(help).toContain('Vertex AI');
    expect(help).toContain('17645');
    expect(help).toContain('ANTHROPIC_BASE_URL');
    expect(help).toContain('OPENAI_BASE_URL');
    expect(help).toContain('network');
    expect(help).toContain('server password');
    expect(help).toContain('vertex-models.example.json');
  });

  it('models help explains favorites, local providers, and /model behavior', () => {
    const help = modelsHelpText();

    expect(help).toContain('v0.1.0');
    expect(help).toContain('relay-ai models');
    expect(help).toContain('favorites');
    expect(help).toContain('local OpenCode provider');
    expect(help).toContain('/model');
    expect(help).toContain('20');
    expect(help).toContain('~/.relay-ai/config.json');
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

    await expect(main(['codex'])).resolves.toBe(1);
    expect(error.mock.calls.flat().join('\n')).toContain('Unknown command: codex');
    expect(log.mock.calls.flat().join('\n')).toContain('relay-ai claude');
  });

  it('prints server help and returns 0', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(main(['server', '--help'])).resolves.toBe(0);
    expect(log.mock.calls.flat().join('\n')).toContain('relay-ai server');
  });
});
