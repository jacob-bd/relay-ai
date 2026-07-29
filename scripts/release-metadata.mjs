import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function readReleaseMetadata(rootDir, releaseTag) {
  const pkg = readJson(resolve(rootDir, 'package.json'));
  const lock = readJson(resolve(rootDir, 'package-lock.json'));
  const expectedTag = `v${pkg.version}`;
  const tag = releaseTag ?? expectedTag;

  if (tag !== expectedTag) {
    throw new Error(`Release tag ${tag} must equal ${expectedTag}`);
  }
  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) {
    throw new Error(`package-lock.json versions must both equal ${pkg.version}`);
  }

  const changelog = readFileSync(resolve(rootDir, 'CHANGELOG.md'), 'utf8');
  const version = escapeRegExp(pkg.version);
  const section = changelog.match(
    new RegExp(`^## \\[${version}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|(?![\\s\\S]))`, 'm'),
  );
  const notes = section?.[1]?.trim() ?? '';
  if (!notes) {
    throw new Error(`CHANGELOG.md has no release notes for ${pkg.version}`);
  }

  return { version: pkg.version, tag, notes };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  try {
    const metadata = readReleaseMetadata(process.cwd(), process.env.RELEASE_TAG);
    if (process.argv.includes('--notes')) {
      process.stdout.write(metadata.notes);
    } else {
      console.log(`Release metadata valid for ${metadata.tag}.`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
