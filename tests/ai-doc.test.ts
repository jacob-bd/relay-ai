import { describe, it, expect } from 'vitest';
import {
  generateAiDoc,
  parseSkillVersion,
} from '../src/ai-doc.js';
import { parseArgs } from '../src/cli.js';
import { VERSION } from '../src/constants.js';

describe('ai-doc', () => {
  it('includes agent workflow sections', () => {
    const doc = generateAiDoc();
    expect(doc).toContain('relay-ai-cli');
    expect(doc).toContain('AGENT PLATFORM PATTERNS');
    expect(doc).toContain('ALEF AGENT INTEGRATION');
    expect(doc).toContain('exec --json');
    expect(doc).toContain('danger-full-access');
    expect(doc).toContain('--provider');
    expect(doc).toContain('-p');
    expect(doc).toContain('providers.json');
    expect(doc).toContain('relay-ai codex');
    expect(doc).toContain('Exception: Claude --http-proxy');
    expect(doc).toContain('CURRENT LOCAL STATE');
    expect(doc).toContain(`version: "${VERSION}"`);
  });

  it('documents the Free Pool and its Relay Core route', () => {
    const doc = generateAiDoc();
    expect(doc).toContain('RELAY FREE POOL (EXPERIMENTAL)');
    expect(doc).toContain('relay-free-pool::relay-free-pool');
    expect(doc).toContain('relay-ai pool force-fail');
    expect(doc).toContain('docs/FREE_POOL.md');
  });

  it('uses the published scoped npm package name', () => {
    const doc = generateAiDoc();
    expect(doc).toContain('npm install -g @jacobbd/relay-ai');
    expect(doc).not.toContain('npm install -g relay-ai');
  });

  it('parseSkillVersion reads YAML frontmatter', () => {
    const doc = generateAiDoc();
    expect(parseSkillVersion(doc)).toBe(VERSION);
  });
});

describe('parseArgs --ai', () => {
  it('parses relay-ai --ai', () => {
    expect(parseArgs(['--ai'])).toMatchObject({
      command: 'root',
      showAi: true,
      aiInstall: false,
    });
  });

  it('parses relay-ai --ai --install', () => {
    expect(parseArgs(['--ai', '--install'])).toMatchObject({
      showAi: true,
      aiInstall: true,
    });
  });
});

describe('ai-doc Codex context management', () => {
  it('documents auto-summarize, its switch, and image shrinking', () => {
    const doc = generateAiDoc();
    expect(doc).toContain('CODEX CONTEXT MANAGEMENT');
    expect(doc).toContain('RELAY_AI_AUTO_SUMMARIZE=off|overflow|all');
    expect(doc).toContain('context_length_exceeded');
    expect(doc).toContain('image exceeds 10 MB maximum');
    expect(doc).toContain('Invalid JSON body');
    expect(doc).toContain('not a multimodal model');
    expect(doc).toContain('all images in one request');
  });
});
