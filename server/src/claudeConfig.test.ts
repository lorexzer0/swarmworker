import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  encodeProjectDir,
  transcriptDirFor,
  sanitizedEnv,
  ensureTrusted,
} from './claudeConfig.js';

describe('encodeProjectDir', () => {
  it('replaces every non-alphanumeric character with a dash', () => {
    expect(encodeProjectDir('W:\\Sandbox\\swarmworker')).toBe('W--Sandbox-swarmworker');
    expect(encodeProjectDir('V:/Work/Projects/x')).toBe('V--Work-Projects-x');
  });

  it('leaves bare alphanumerics untouched', () => {
    expect(encodeProjectDir('abc123')).toBe('abc123');
  });
});

describe('transcriptDirFor', () => {
  afterEach(() => vi.restoreAllMocks());

  it('composes homedir + .claude/projects + the encoded cwd', () => {
    vi.spyOn(os, 'homedir').mockReturnValue(path.join('/fake', 'home'));
    expect(transcriptDirFor('/repo/x')).toBe(
      path.join('/fake', 'home', '.claude', 'projects', '-repo-x'),
    );
  });
});

describe('sanitizedEnv', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('strips inherited Claude session vars but keeps the rest', () => {
    vi.stubEnv('CLAUDECODE', '1');
    vi.stubEnv('CLAUDE_CODE_SESSION_ID', 'abc');
    vi.stubEnv('CLAUDE_CODE_CHILD_SESSION', '1');
    vi.stubEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    vi.stubEnv('SWARM_KEEP_ME', 'yes');

    const env = sanitizedEnv();

    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined();
    expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(env.SWARM_KEEP_ME).toBe('yes');
  });

  it('merges extra vars, which override inherited ones', () => {
    vi.stubEnv('SWARM_OVERRIDE_ME', 'old');
    const env = sanitizedEnv({ SWARM_OVERRIDE_ME: 'new', SWARM_EXTRA: 'x' });
    expect(env.SWARM_OVERRIDE_ME).toBe('new');
    expect(env.SWARM_EXTRA).toBe('x');
  });
});

describe('ensureTrusted', () => {
  let home: string;
  const cwd = process.platform === 'win32' ? 'W:\\repo\\wt' : '/home/u/repo/wt';
  const key = cwd.replace(/\\/g, '/');

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-trust-'));
    vi.spyOn(os, 'homedir').mockReturnValue(home);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(home, { recursive: true, force: true });
  });

  const claudeJson = () => path.join(home, '.claude.json');

  it('returns false when there is no ~/.claude.json', () => {
    expect(ensureTrusted(cwd)).toBe(false);
  });

  it('sets hasTrustDialogAccepted, then is idempotent', () => {
    fs.writeFileSync(claudeJson(), JSON.stringify({ projects: {} }));

    expect(ensureTrusted(cwd)).toBe(true);
    const cfg = JSON.parse(fs.readFileSync(claudeJson(), 'utf8'));
    expect(cfg.projects[key].hasTrustDialogAccepted).toBe(true);

    // Already trusted -> no write needed the second time.
    expect(ensureTrusted(cwd)).toBe(false);
  });

  it('preserves existing keys for the project', () => {
    fs.writeFileSync(
      claudeJson(),
      JSON.stringify({ projects: { [key]: { allowedTools: ['Bash'], custom: 42 } } }),
    );
    ensureTrusted(cwd);
    const cfg = JSON.parse(fs.readFileSync(claudeJson(), 'utf8'));
    expect(cfg.projects[key].hasTrustDialogAccepted).toBe(true);
    expect(cfg.projects[key].allowedTools).toEqual(['Bash']);
    expect(cfg.projects[key].custom).toBe(42);
  });

  it('refuses to touch an unparseable config', () => {
    fs.writeFileSync(claudeJson(), '{ not valid json');
    expect(ensureTrusted(cwd)).toBe(false);
    expect(fs.readFileSync(claudeJson(), 'utf8')).toBe('{ not valid json');
  });

  it('writes a one-time backup before modifying', () => {
    fs.writeFileSync(claudeJson(), JSON.stringify({ projects: {} }));
    ensureTrusted(cwd);
    expect(fs.existsSync(claudeJson() + '.swarmworker.bak')).toBe(true);
  });
});
