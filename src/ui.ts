// Shared relay-ai CLI styling — @clack/prompts + picocolors.
// Use printPanel for important callouts (p.note dims all body text).
import pc from 'picocolors';
import * as p from '@clack/prompts';
import type { ConflictInfo, LocalProvider, LocalProviderModel } from './types.js';
import { formatCodexModelLabel } from './codex/catalog.js';

export { formatCodexModelLabel as formatModelLabel } from './codex/catalog.js';

const bar = pc.gray('│');
const hline = pc.gray('─');

function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

function panelWidth(lines: string[], title: string): number {
  const maxLine = lines.reduce((max, line) => Math.max(max, stripAnsi(line).length), 0);
  return Math.max(maxLine, stripAnsi(title).length) + 2;
}

/** Colored panel — clack note shape without dimmed body. */
export function printPanel(title: string, lines: string[]): void {
  const width = panelWidth(lines, title);
  const topRule = hline.repeat(Math.max(width - stripAnsi(title).length - 1, 1));
  process.stdout.write(`${bar}\n`);
  process.stdout.write(`${pc.green('◇')}  ${pc.bold(title)} ${pc.gray(topRule + '╮')}\n`);
  for (const line of lines) {
    if (line.trim() === '') {
      process.stdout.write(`${bar}  ${bar}\n`);
      continue;
    }
    const pad = ' '.repeat(Math.max(width - stripAnsi(line).length, 0));
    process.stdout.write(`${bar}  ${line}${pad}${bar}\n`);
  }
  process.stdout.write(`${pc.gray('├' + '─'.repeat(width + 2) + '╯')}\n`);
}

export function relayIntro(section: string): void {
  p.intro(`${pc.bold(pc.cyan('Relay AI'))}${pc.bold(` — ${section}`)}`);
}

export function relayOutro(status: string, detail?: string): void {
  p.outro(detail
    ? `${pc.green(status)} ${pc.dim('—')} ${detail}`
    : pc.green(status));
}

export function fmtModel(label: string, id?: string): string {
  return id
    ? `${pc.cyan(pc.bold(label))} ${pc.dim(`(${id})`)}`
    : pc.cyan(pc.bold(label));
}

export function fmtProvider(name: string): string {
  return pc.magenta(pc.bold(name));
}

/** Bracketed provider tag for global favorites search — bright, color per provider id. */
export function fmtProviderBracket(providerId: string, providerName: string, isFree?: boolean): string {
  const color = providerTagColor(providerId);
  const text = isFree ? `${providerName} · free` : providerName;
  return color(pc.bold(`(${text})`));
}

function providerTagColor(providerId: string): (text: string) => string {
  switch (providerId) {
    case 'zen':
      return pc.yellow;
    case 'go':
      return pc.green;
    case 'openrouter':
      return pc.blue;
    case 'deepseek':
      return pc.magenta;
    case 'anthropic':
      return pc.yellow;
    case 'google':
      return pc.cyan;
    case 'openai':
      return pc.white;
    case 'xai':
    case 'xai-oauth':
      return pc.white;
    case 'groq':
      return pc.red;
    case 'mistral':
      return pc.red;
    case 'togetherai':
      return pc.blue;
    case 'nvidia':
      return pc.green;
    default:
      return pc.yellow;
  }
}

export function fmtCommand(cmd: string): string {
  return pc.cyan(cmd);
}

export function fmtPath(path: string): string {
  return pc.cyan(path);
}

export function fmtUrl(url: string): string {
  return pc.cyan(url);
}

export function fmtCount(n: number, noun: string): string {
  return `${pc.bold(String(n))} ${noun}${n === 1 ? '' : 's'}`;
}

export function fmtRecentHint(): string {
  return pc.yellow('recent');
}

export function fmtEnabledStar(enabled: boolean): string {
  return enabled ? pc.yellow('★') : pc.dim('○');
}

export function providerSelectOption(provider: Pick<LocalProvider, 'id' | 'name' | 'models'>) {
  return {
    value: provider.id,
    label: fmtProvider(provider.name),
    hint: `${provider.models.length} model${provider.models.length !== 1 ? 's' : ''}`,
  };
}

export function modelSelectOption(model: LocalProviderModel, hint?: string) {
  const label = formatCodexModelLabel(model);
  const defaultHint = hint
    ?? (model.name !== model.id ? model.id : model.brand || model.family || '');
  return {
    value: model.id,
    label: fmtModel(label),
    hint: hint === 'recent' ? fmtRecentHint() : defaultHint,
  };
}

export function navOption(value: string, label: string, hint = '') {
  return { value, label: pc.cyan(label), hint };
}

export function confirmLaunchMessage(
  target: string,
  modelLabel: string,
  modelId: string,
  providerName: string,
  via?: string,
): string {
  const viaSuffix = via ? ` ${pc.dim('(')}${via}${pc.dim(')')}` : '';
  return `Launch ${pc.bold(target)} · ${fmtModel(modelLabel, modelId)} ${pc.dim('via')} ${fmtProvider(providerName)}?${viaSuffix}`;
}

export function logActiveModel(modelLabel: string, modelId: string): void {
  p.log.success(`${pc.bold('Active model:')} ${fmtModel(modelLabel, modelId)}`);
}

export function logProxy(port: number): void {
  p.log.info(`${pc.dim('Proxy')} ${pc.cyan(pc.bold(`127.0.0.1:${port}`))}`);
}

export function logConnected(name: string, modelCount: number): void {
  p.log.success(
    `${pc.bold('Connected')} ${pc.dim('·')} ${fmtCount(modelCount, 'model')} ${pc.dim('—')} ${fmtProvider(name)}`,
  );
}

export function printWelcomePanel(): void {
  printPanel(pc.cyan('Welcome to relay-ai'), [
    `${pc.white("Let's get you set up.")}`,
    `${pc.dim('Pick a path below — you can always add more providers later with ')}${fmtCommand('relay-ai providers')}${pc.dim('.')}`,
  ]);
}

export function printEnvConflictPanel(conflicts: ConflictInfo[]): void {
  if (conflicts.length === 0) return;
  printPanel(pc.yellow('Env overrides'), [
    `${pc.white('These variables will be ')}${pc.yellow(pc.bold('temporarily removed'))}${pc.white(' for the Claude Code child process:')}`,
    '',
    ...conflicts.map(c => `  ${pc.dim(c.name)}${pc.white('=')}${pc.yellow(c.value)}`),
  ]);
}

export function printApiKeyPanel(url: string): void {
  printPanel(pc.cyan('OpenCode API key'), [
    `${pc.white('Get a free key at:')} ${fmtUrl(url)}`,
    `${pc.dim('Paste it below — relay-ai stores it in your system keychain when possible.')}`,
  ]);
}

export function printDryRunPanel(): void {
  printPanel(pc.yellow('Dry run'), [
    `${pc.white('Simulating first-run — ')}${pc.yellow(pc.bold('no keys read or written'))}${pc.white('.')}`,
  ]);
}

export function printImportConflictPanel(
  providerName: string,
  existingHint: string,
  incomingHint: string,
): void {
  printPanel(pc.yellow(`Provider "${providerName}" already configured`), [
    `${pc.bold('Existing')}  ${pc.white(existingHint)}`,
    `${pc.bold('Imported')}  ${pc.white(incomingHint)}`,
  ]);
}

export function printProviderDetailPanel(
  name: string,
  modelCount: number,
  authLabel: string,
): void {
  printPanel(fmtProvider(name), [
    `${pc.bold('Models')}  ${pc.cyan(String(modelCount))} cached`,
    `${pc.bold('Auth')}    ${pc.white(authLabel)}`,
  ]);
}

export function printCloudProviderPanel(name: string): void {
  printPanel(pc.cyan('Cloud provider'), [
    `${fmtProvider(name)} ${pc.white('is active via your saved OpenCode API key.')}`,
    `${pc.dim('Models are fetched live — no separate setup needed.')}`,
  ]);
}

export function printOAuthStepsPanel(title: string, providerLabel: string): void {
  printPanel(pc.cyan(title), [
    `${pc.white('1. Open the URL below in your browser')}`,
    `${pc.white('2. Enter the code when prompted')}`,
    `${pc.white('3. Approve access for ')}${fmtProvider(providerLabel)}`,
  ]);
}

export function printGatewayMaskPanel(): void {
  printPanel(pc.cyan('Claude Desktop / Cowork'), [
    `${pc.white('Gateway discovery filters competitor model names in ids.')}`,
    `${pc.white('Masking keeps discovery working while display names stay readable.')}`,
  ]);
}

export function printNetworkWarningPanel(): void {
  printPanel(pc.yellow('Network mode'), [
    `${pc.yellow(pc.bold('Anyone on your network'))}${pc.white(' who knows the password can use this server through your account.')}`,
  ]);
}

export function printFavoritesOnlyPanel(): void {
  printPanel(pc.cyan('Favorites-only mode'), [
    `${pc.white('Limits ')}${pc.cyan('GET /anthropic/v1/models')}${pc.white(' to your curated favorites.')}`,
    `${pc.white('Registry models not in your favorites will not appear in the Desktop / Cowork picker.')}`,
    `${pc.white('Edit with ')}${pc.cyan('relay-ai models')}${pc.white('.')}`,
  ]);
}
