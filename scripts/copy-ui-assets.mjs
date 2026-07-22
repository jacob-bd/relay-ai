// Copy static UI assets into dist/ after the tsup build.
//
// Cross-platform replacement for the shell one-liner
//   mkdir -p dist/ui/public && cp -r src/ui/public/. dist/ui/public/
// which fails on Windows because npm runs scripts through cmd.exe, where
// `mkdir -p` and `cp` do not exist ("The syntax of the command is incorrect").
// fs.cpSync creates the destination tree itself, so no separate mkdir is needed.

import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src', 'ui', 'public');
const dest = join(root, 'dist', 'ui', 'public');

cpSync(src, dest, { recursive: true });
