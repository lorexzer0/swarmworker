// Helpers for locating Claude Code's on-disk state: per-session transcripts
// and the workspace-trust registry in ~/.claude.json.
import os from 'os';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';

/**
 * How to launch Claude under a PTY. ConPTY's CreateProcess can't run the
 * `claude` shim or PATH-resolve it, so on Windows we point at the real
 * native `claude.exe` (or fall back to a cmd.exe wrapper).
 */
export interface ClaudeLauncher {
  file: string;
  prefixArgs: string[];
}

let cachedLauncher: ClaudeLauncher | undefined;

function exeFromShimDir(dir: string): string {
  return path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
}

export function resolveClaudeLauncher(): ClaudeLauncher {
  if (cachedLauncher) return cachedLauncher;

  const override = process.env.SWARM_CLAUDE_EXE;
  if (override && fs.existsSync(override)) {
    return (cachedLauncher = { file: override, prefixArgs: [] });
  }

  if (process.platform !== 'win32') {
    return (cachedLauncher = { file: 'claude', prefixArgs: [] });
  }

  const candidates: string[] = [];
  // Derive from wherever the `claude` shim lives on PATH.
  try {
    const out = execFileSync('where.exe', ['claude'], { encoding: 'utf8' });
    for (const line of out.split(/\r?\n/)) {
      const p = line.trim();
      if (p) candidates.push(exeFromShimDir(path.dirname(p)));
    }
  } catch {
    /* where.exe failed — fall through to known locations */
  }
  // Common global install locations.
  candidates.push(exeFromShimDir(path.join(os.homedir(), 'AppData', 'Roaming', 'npm')));
  candidates.push(exeFromShimDir('C:\\nvm4w\\nodejs'));

  for (const c of candidates) {
    if (fs.existsSync(c)) return (cachedLauncher = { file: c, prefixArgs: [] });
  }

  // Last resort: run the shim through cmd.exe (works, but extra process in tree).
  return (cachedLauncher = {
    file: process.env.ComSpec || 'cmd.exe',
    prefixArgs: ['/c', 'claude'],
  });
}

export function projectsRoot(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

/**
 * Claude encodes a project's absolute cwd into a directory name by replacing
 * every non-alphanumeric character with '-'.
 *   W:\Sandbox\swarmworker  ->  W--Sandbox-swarmworker
 *   V:/Work/Projects/x      ->  V--Work-Projects-x
 */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

export function transcriptDirFor(cwd: string): string {
  return path.join(projectsRoot(), encodeProjectDir(cwd));
}

/**
 * Env vars that mark a process as running *inside* a Claude Code session. If we
 * inherit them, a spawned `claude` thinks it's a child/sub-session and won't
 * persist its own transcript (so token tracking breaks). Strip them so every
 * agent is a clean top-level session — important if the manager itself was
 * launched from within a Claude session.
 */
const INHERITED_SESSION_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
];

export function sanitizedEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  for (const k of INHERITED_SESSION_VARS) delete env[k];
  return { ...env, ...extra };
}

const claudeJsonPath = () => path.join(os.homedir(), '.claude.json');

/** Trust keys in ~/.claude.json use forward slashes + the drive's given case. */
function trustKeyFor(cwd: string): string {
  return cwd.replace(/\\/g, '/');
}

/**
 * Ensure the workspace-trust dialog won't block an interactive launch in `cwd`.
 * Reads ~/.claude.json, sets projects[key].hasTrustDialogAccepted = true, and
 * writes it back atomically. Safe: aborts on parse failure, keeps a one-time
 * backup, never drops existing keys. Returns true if a write was needed.
 */
export function ensureTrusted(cwd: string): boolean {
  const file = claudeJsonPath();
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    // No global config yet — let Claude create it on first run.
    return false;
  }
  let cfg: any;
  try {
    cfg = JSON.parse(raw);
  } catch {
    // Refuse to touch a file we can't parse.
    return false;
  }
  const key = trustKeyFor(cwd);
  cfg.projects = cfg.projects || {};
  const existing = cfg.projects[key] || {};
  if (existing.hasTrustDialogAccepted === true) return false;

  cfg.projects[key] = {
    allowedTools: [],
    history: [],
    mcpContextUris: [],
    mcpServers: {},
    enabledMcpjsonServers: [],
    disabledMcpjsonServers: [],
    projectOnboardingSeenCount: 1,
    hasClaudeMdExternalIncludesApproved: false,
    hasClaudeMdExternalIncludesWarningShown: false,
    ...existing,
    hasTrustDialogAccepted: true,
  };

  const bak = file + '.swarmworker.bak';
  if (!fs.existsSync(bak)) {
    try { fs.writeFileSync(bak, raw, 'utf8'); } catch { /* best effort */ }
  }
  const tmp = file + '.swarmworker.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return true;
}
