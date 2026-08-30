// Codex-specific terminal panels (shared primitives in ../ui.ts).
import pc from 'picocolors';
import {
  fmtCommand,
  fmtModel,
  fmtProvider,
  logActiveModel,
  logProxy,
  printPanel,
  relayIntro,
  relayOutro,
} from '../ui.js';

export {
  fmtModel as formatCodexModelRef,
  fmtProvider as formatCodexProviderRef,
  logActiveModel as logCodexActiveModel,
  logProxy as logCodexProxy,
  printPanel,
} from '../ui.js';

export function codexAppIntro(): void {
  relayIntro('Codex App');
}

export function codexCliIntro(): void {
  relayIntro('Codex');
}

export function printCodexAppSessionPanel(opts: {
  modelLabel: string;
  modelId: string;
  providerName: string;
  restoreCommand: string;
}): void {
  printPanel(pc.cyan('Foreground session'), [
    `${pc.bold('Model')}     ${fmtModel(opts.modelLabel, opts.modelId)}`,
    `${pc.bold('Provider')}  ${fmtProvider(opts.providerName)}`,
    '',
    `${pc.yellow(pc.bold('Keep this terminal open'))}${pc.white(' while you use Codex.')}`,
    `${pc.white('Press ')}${pc.bold(pc.red('Ctrl+C'))}${pc.white(' to close ChatGPT Desktop, restore ')}${fmtCommand('~/.codex/config.toml')}${pc.white(', and stop the proxy.')}`,
    `${pc.dim('Codex may show ')}${pc.yellow('"Custom"')}${pc.dim(' if the desktop picker cannot resolve registry models — check the terminal line above. After restart, pick your model from the picker if it appears.')}`,
    `${pc.dim('If Codex asks you to sign in after restart: choose API key and enter any character — that unlocks the model picker for registry providers.')}`,
    `${pc.dim('Stuck? Run ')}${fmtCommand(opts.restoreCommand)}${pc.dim('.')}`,
  ]);
}

export function printCodexCliCleanupPanel(restoreCommand: string): void {
  printPanel(pc.cyan('While Codex runs'), [
    `${pc.white('Temporary profile: ')}${fmtCommand('~/.codex/relay-ai-launch.config.toml')}`,
    `${pc.white('Removed automatically when Codex exits.')}`,
    `${pc.dim('After a crash: ')}${fmtCommand(restoreCommand)}${pc.dim('.')}`,
  ]);
}

export function codexAppOutro(modelLabel: string): void {
  relayOutro('Codex App', fmtModel(modelLabel));
}

export function codexCliOutro(providerName: string, modelLabel: string, modelId: string): void {
  relayOutro(
    'Launching Codex',
    `${fmtProvider(providerName)} ${pc.dim('/')} ${fmtModel(modelLabel, modelId)}`,
  );
}
