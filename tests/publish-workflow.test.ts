import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];

function releaseStepScript(): string {
  const lines = readFileSync('.github/workflows/publish.yml', 'utf8').split('\n');
  const stepStart = lines.findIndex(line => line.trim() === '- name: Create GitHub Release');
  const runStart = lines.findIndex((line, index) => index > stepStart && line.trim() === 'run: |');
  if (stepStart < 0 || runStart < 0) throw new Error('Create GitHub Release step not found');

  const script: string[] = [];
  for (let index = runStart + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.startsWith('      - ')) break;
    if (line === '') {
      script.push('');
      continue;
    }
    if (!line.startsWith('          ')) break;
    script.push(line.slice(10));
  }
  return script.join('\n');
}

function runReleaseStep(releaseExists: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'relay-ai-publish-'));
  tempDirs.push(dir);
  const callLog = join(dir, 'gh-calls.log');
  const fakeGh = join(dir, 'gh');
  writeFileSync(fakeGh, `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$GH_CALL_LOG"
if [[ "$1 $2" == "release view" ]]; then
  [[ "$GH_RELEASE_EXISTS" == "1" ]]
elif [[ "$1 $2" == "release edit" ]]; then
  exit 0
elif [[ "$1 $2" == "release create" ]]; then
  if [[ "$GH_RELEASE_EXISTS" == "1" ]]; then
    echo "HTTP 422: Release.tag_name already exists" >&2
    exit 1
  fi
fi
`);
  chmodSync(fakeGh, 0o755);

  const result = spawnSync('bash', ['-e', '-c', releaseStepScript()], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
      GH_CALL_LOG: callLog,
      GH_RELEASE_EXISTS: releaseExists ? '1' : '0',
      GITHUB_REF_NAME: 'v0.4.9',
    },
  });

  return {
    ...result,
    calls: readFileSync(callLog, 'utf8').trim().split('\n'),
  };
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('npm publish workflow GitHub Release step', () => {
  it('updates an existing release instead of failing with a duplicate-tag error', () => {
    const result = runReleaseStep(true);

    expect(result.status, result.stderr).toBe(0);
    expect(result.calls[0]).toBe('release view v0.4.9');
    expect(result.calls[1]).toContain('release edit v0.4.9');
    expect(result.calls).not.toContain(expect.stringContaining('release create'));
  });

  it('creates the release when one does not exist', () => {
    const result = runReleaseStep(false);

    expect(result.status, result.stderr).toBe(0);
    expect(result.calls[0]).toBe('release view v0.4.9');
    expect(result.calls[1]).toContain('release create v0.4.9');
  });
});
