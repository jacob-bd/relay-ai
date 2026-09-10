// Point every test file at a throwaway app home.
//
// Without this, any test that does not set RELAY_AI_HOME itself reads and writes
// the developer's real ~/.relay-ai. `npm test` was rewriting saved preferences on
// every run, and a test that loads an isolated (empty) config while another test
// has cleared the override can write that empty config back to the real path.
// The default belongs here rather than in each test so a new test file cannot
// forget it.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

const testHome = mkdtempSync(join(tmpdir(), 'relay-ai-test-home-'));
process.env['RELAY_AI_HOME'] = testHome;
// paths.ts still honours this legacy variable, and a developer's real value would
// otherwise win over the override above.
delete process.env['OPENCODE_STARTER_HOME'];

afterAll(() => {
  rmSync(testHome, { recursive: true, force: true });
});
