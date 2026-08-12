import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

type WindowProbe = (display: string, windowId: string) => boolean;

function displayHasWindow(display: string, windowId: string): boolean {
  try {
    const output = execFileSync('xprop', ['-display', display, '-id', windowId, 'WM_CLASS'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return /WM_CLASS(?:\(STRING\))?\s*=\s*"/.test(output);
  } catch {
    return false;
  }
}

function availableDisplays(): string[] {
  try {
    return readdirSync('/tmp/.X11-unix')
      .filter(name => /^X\d+$/.test(name))
      .map(name => `:${name.slice(1)}`);
  } catch {
    return [];
  }
}

export function resolveLinuxDisplay(
  env: NodeJS.ProcessEnv = process.env,
  probe: WindowProbe = displayHasWindow,
  displays: string[] = availableDisplays(),
): string | undefined {
  const configured = env.DISPLAY;
  const windowId = env.WINDOWID;
  if (!windowId) return configured;
  if (configured && probe(configured, windowId)) return configured;
  for (const display of displays) {
    if (display !== configured && probe(display, windowId)) return display;
  }
  return configured;
}

export function linuxLaunchEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const display = resolveLinuxDisplay(env);
  return display ? { ...env, DISPLAY: display } : { ...env };
}
