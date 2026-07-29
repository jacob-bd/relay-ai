import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readReleaseMetadata } from '../scripts/release-metadata.mjs';

const tempDirs: string[] = [];

function releaseFixture(options: { packageVersion?: string; lockVersion?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'relay-ai-release-'));
  tempDirs.push(root);
  mkdirSync(join(root, 'scripts'));
  const packageVersion = options.packageVersion ?? '0.7.5';
  const lockVersion = options.lockVersion ?? packageVersion;
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: '@jacobbd/relay-ai',
    version: packageVersion,
  }));
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({
    name: '@jacobbd/relay-ai',
    version: lockVersion,
    packages: {
      '': {
        name: '@jacobbd/relay-ai',
        version: lockVersion,
      },
    },
  }));
  writeFileSync(join(root, 'CHANGELOG.md'), [
    '# Changelog',
    '',
    '## [0.7.5] - 2026-07-28',
    '',
    '### Fixed',
    '',
    '- Correct release notes.',
    '',
    '## [0.7.4] - 2026-07-28',
    '',
    '- Previous release notes.',
    '',
  ].join('\n'));
  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('release metadata verification', () => {
  it('returns notes from the section matching the release tag', () => {
    const metadata = readReleaseMetadata(releaseFixture(), 'v0.7.5');

    expect(metadata.version).toBe('0.7.5');
    expect(metadata.notes).toContain('Correct release notes.');
    expect(metadata.notes).not.toContain('Previous release notes.');
  });

  it('rejects the stale lockfile state that broke the v0.7.4 publish', () => {
    expect(() => readReleaseMetadata(
      releaseFixture({ packageVersion: '0.7.5', lockVersion: '0.7.4' }),
      'v0.7.5',
    )).toThrow('package-lock.json versions must both equal 0.7.5');
  });

  it('rejects a tag that does not match package.json', () => {
    expect(() => readReleaseMetadata(releaseFixture(), 'v0.7.6'))
      .toThrow('Release tag v0.7.6 must equal v0.7.5');
  });
});
