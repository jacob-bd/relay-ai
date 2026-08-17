import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCodexCommand, runCodexCommandSync } from '../src/codex/process.js';

const windowsOnly = process.platform === 'win32' ? describe : describe.skip;
const cleanup: string[] = [];

afterEach(() => {
  while (cleanup.length > 0) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

function windowsArgEchoShim(): string {
  const dir = mkdtempSync(join(tmpdir(), 'relay codex cmd '));
  cleanup.push(dir);
  writeFileSync(join(dir, 'echo-args.cjs'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
  const shim = join(dir, 'codex test.cmd');
  writeFileSync(shim, '@echo off\r\nnode "%~dp0echo-args.cjs" %*\r\n');
  return shim;
}

const edgeCaseArgs = [
  'plain',
  'two words',
  'say "hello"',
  '%PATH%',
  'a&b',
  '',
  'Unicode-☃',
  'C:\\trailing\\',
];

windowsOnly('Codex Windows command shims', () => {
  it('runs a .cmd shim synchronously without changing its arguments', () => {
    const result = runCodexCommandSync(windowsArgEchoShim(), edgeCaseArgs);
    expect(JSON.parse(result.stdout)).toEqual(edgeCaseArgs);
  });

  it('runs a .cmd shim asynchronously without changing its arguments', async () => {
    const result = await runCodexCommand(windowsArgEchoShim(), edgeCaseArgs);
    expect(JSON.parse(result.stdout)).toEqual(edgeCaseArgs);
  });
});
