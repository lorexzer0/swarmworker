// Git worktree + project helpers. All operations shell out to `git`.
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const pexec = promisify(execFile);

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await pexec('git', ['-C', repo, ...args], {
    maxBuffer: 1024 * 1024 * 16,
    windowsHide: true,
  });
  return stdout.trim();
}

/** Run git capturing failure (stdout/stderr) instead of throwing. */
async function gitTry(repo: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  try {
    const { stdout } = await pexec('git', ['-C', repo, ...args], {
      maxBuffer: 1024 * 1024 * 16,
      windowsHide: true,
    });
    return { ok: true, out: stdout.trim(), err: '' };
  } catch (e: any) {
    return { ok: false, out: String(e?.stdout ?? '').trim(), err: String(e?.stderr ?? e?.message ?? '') };
  }
}

/** safe.directory entries use the absolute path with forward slashes. */
function gitPathKey(dir: string): string {
  return path.resolve(dir).replace(/\\/g, '/');
}

/**
 * Git refuses to operate in a directory owned by a different user ("dubious
 * ownership") — common on Windows across drives or accounts. Add a global
 * `safe.directory` exception (idempotent) so our own tool can read the repo,
 * mirroring the auto-trust we already do for Claude's workspace dialog.
 * Returns true if a new exception was added.
 */
export async function trustGitDir(dir: string): Promise<boolean> {
  const key = gitPathKey(dir);
  const cur = await gitTry(dir, ['config', '--global', '--get-all', 'safe.directory']);
  if (cur.ok) {
    const vals = cur.out.split(/\r?\n/).map((s) => s.trim());
    if (vals.includes('*') || vals.includes(key)) return false;
  }
  const res = await gitTry(dir, ['config', '--global', '--add', 'safe.directory', key]);
  return res.ok;
}

const SCAN_MAX_DEPTH = 3;
const SCAN_MAX_REPOS = 2000;
const SCAN_SKIP = new Set(['node_modules', 'dist', 'build', '.next', 'vendor', '.cache', 'target', 'out']);

/**
 * Discover git repos under a holding folder. A directory containing `.git` is a
 * repo (recorded; we don't descend into it); otherwise we recurse up to
 * SCAN_MAX_DEPTH, skipping hidden/heavy dirs. fs-only — never shells out to git,
 * so dubious-ownership repos are still discovered. If `root` is itself a repo it
 * returns just that one.
 */
export async function scanReposUnder(root: string, maxDepth = SCAN_MAX_DEPTH): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (found.length >= SCAN_MAX_REPOS) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable (permissions, missing) — skip
    }
    if (entries.some((e) => e.name === '.git')) {
      found.push(path.normalize(dir));
      return; // it's a repo — don't descend into it
    }
    if (depth >= maxDepth) return;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.') || SCAN_SKIP.has(e.name)) continue;
      await walk(path.join(dir, e.name), depth + 1);
    }
  }
  await walk(path.normalize(root), 0);
  return found;
}

/** The machine's global git identity + signing config (for profile prefill). */
export async function globalGitIdentity(): Promise<{
  userName: string;
  userEmail: string;
  signingKey: string;
  gpgSign: boolean;
  gpgFormat: 'openpgp' | 'ssh';
}> {
  const get = async (key: string) => (await gitTry('.', ['config', '--global', '--get', key])).out;
  const [userName, userEmail, signingKey, sign, format] = await Promise.all([
    get('user.name'),
    get('user.email'),
    get('user.signingkey'),
    get('commit.gpgsign'),
    get('gpg.format'),
  ]);
  return {
    userName,
    userEmail,
    signingKey,
    gpgSign: /^(true|1|yes|on)$/i.test(sign),
    gpgFormat: format === 'ssh' ? 'ssh' : 'openpgp',
  };
}

export async function isGitRepo(dir: string): Promise<boolean> {
  let r = await gitTry(dir, ['rev-parse', '--is-inside-work-tree']);
  // A real repo owned by another user aborts with exit 128 ("dubious
  // ownership"); don't misreport that as "not a git repository". Trust it and
  // retry once.
  if (!r.ok && /dubious ownership/i.test(r.err)) {
    await trustGitDir(dir);
    r = await gitTry(dir, ['rev-parse', '--is-inside-work-tree']);
  }
  return r.ok && r.out === 'true';
}

/** The repo's top-level dir (so a registered subdir resolves to its root). */
export async function repoToplevel(dir: string): Promise<string> {
  return path.normalize(await git(dir, ['rev-parse', '--show-toplevel']));
}

export async function currentBranch(repo: string): Promise<string> {
  // `--show-current` reports the branch name even on an unborn branch (no
  // commits yet), where `rev-parse HEAD` would fail.
  try {
    const b = await git(repo, ['branch', '--show-current']);
    if (b) return b;
  } catch {
    /* fall through */
  }
  try {
    return await git(repo, ['symbolic-ref', '--short', 'HEAD']);
  } catch {
    return 'main';
  }
}

/** True if the repo has at least one commit anywhere. */
export async function hasAnyCommit(repo: string): Promise<boolean> {
  try {
    return parseInt(await git(repo, ['rev-list', '--count', '--all']), 10) > 0;
  } catch {
    return false;
  }
}

async function commitishExists(repo: string, ref: string): Promise<boolean> {
  try {
    await git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

export async function listBranches(repo: string): Promise<string[]> {
  const out = await git(repo, ['branch', '--format=%(refname:short)']);
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

export function sanitizeBranchSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/** lower_snake_case form of a name, for use as a Claude session name (/rename). */
export function toSnakeCase(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'session';
}

/** Generate a unique-ish branch name like `swarm/<base>-<id>`. */
export function generateBranch(base: string, idSuffix: string): string {
  const b = sanitizeBranchSegment(base) || 'work';
  return `swarm/${b}-${idSuffix}`;
}

export interface AddWorktreeResult {
  worktreePath: string;
  branch: string;
}

/**
 * Create a worktree for `branch` based on `base`. If `branch` already exists,
 * check it out into the worktree instead of creating it.
 */
export async function addWorktree(
  repo: string,
  worktreeRoot: string,
  projectId: string,
  branch: string,
  base: string,
): Promise<AddWorktreeResult> {
  const dir = path.join(worktreeRoot, projectId, sanitizeBranchSegment(branch));
  fs.mkdirSync(path.dirname(dir), { recursive: true });

  const branches = await listBranches(repo);
  if (branches.includes(branch)) {
    await git(repo, ['worktree', 'add', dir, branch]);
  } else {
    // Need a valid commit to fork from. Give a clear reason if there isn't one.
    if (!(await commitishExists(repo, base))) {
      const name = path.basename(repo);
      if (!(await hasAnyCommit(repo))) {
        throw new Error(
          `"${name}" has no commits yet — make an initial commit before spawning agents ` +
            `(e.g. \`git -C "${repo}" add -A && git -C "${repo}" commit -m init\`). ` +
            `A worktree must fork from an existing commit.`,
        );
      }
      throw new Error(`base "${base}" is not a valid branch/commit in "${name}".`);
    }
    await git(repo, ['worktree', 'add', '-b', branch, dir, base]);
  }
  return { worktreePath: path.normalize(dir), branch };
}

export async function removeWorktree(repo: string, worktreePath: string): Promise<void> {
  await git(repo, ['worktree', 'remove', '--force', worktreePath]);
  await git(repo, ['worktree', 'prune']).catch(() => {});
}

export async function deleteBranchRef(repo: string, branch: string): Promise<void> {
  await git(repo, ['branch', '-D', branch]);
}

export interface WorktreeInfo {
  path: string;
  branch: string | null; // short name; null when detached
  head: string; // short sha
  isMain: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean; // working dir is gone / can be pruned
  dirtyFiles: number; // uncommitted changes
  commitsAhead: number; // vs the project's default branch (best effort)
}

/** Enumerate all worktrees git knows about for a repo, with quick status. */
export async function listProjectWorktrees(
  repo: string,
  defaultBranch?: string,
): Promise<WorktreeInfo[]> {
  const porcelain = await git(repo, ['worktree', 'list', '--porcelain']);
  const top = path.normalize(await repoToplevel(repo));
  const blocks = porcelain.split(/\r?\n\r?\n/).map((b) => b.trim()).filter(Boolean);
  const infos: WorktreeInfo[] = [];

  for (const block of blocks) {
    let wpath = '';
    let head = '';
    let branch: string | null = null;
    let detached = false;
    let locked = false;
    let prunable = false;
    let bare = false;
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) wpath = path.normalize(line.slice(9).trim());
      else if (line.startsWith('HEAD ')) head = line.slice(5, 13);
      else if (line.startsWith('branch ')) branch = line.slice(7).replace('refs/heads/', '').trim();
      else if (line === 'detached') detached = true;
      else if (line.startsWith('locked')) locked = true;
      else if (line.startsWith('prunable')) prunable = true;
      else if (line === 'bare') bare = true;
    }
    if (!wpath || bare) continue;

    let dirtyFiles = 0;
    let commitsAhead = 0;
    if (!prunable) {
      try {
        dirtyFiles = (await git(wpath, ['status', '--porcelain'])).split(/\r?\n/).filter(Boolean).length;
      } catch {
        /* worktree dir missing */
      }
      if (defaultBranch && branch && branch !== defaultBranch && head) {
        try {
          commitsAhead = parseInt(await git(repo, ['rev-list', '--count', `${defaultBranch}..${head}`]), 10) || 0;
        } catch {
          /* unrelated histories */
        }
      }
    }
    infos.push({
      path: wpath,
      branch,
      head,
      isMain: wpath === top,
      detached,
      locked,
      prunable,
      dirtyFiles,
      commitsAhead,
    });
  }
  return infos;
}

/** Lines of `git status --porcelain` count + insertions/deletions vs base. */
export async function worktreeDiffStat(
  worktreePath: string,
  base: string,
): Promise<{ filesChanged: number; insertions: number; deletions: number }> {
  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;
  try {
    const porcelain = await git(worktreePath, ['status', '--porcelain']);
    filesChanged = porcelain.split(/\r?\n/).filter(Boolean).length;
    const stat = await git(worktreePath, ['diff', '--shortstat', base]);
    const ins = stat.match(/(\d+) insertion/);
    const del = stat.match(/(\d+) deletion/);
    if (ins) insertions = parseInt(ins[1], 10);
    if (del) deletions = parseInt(del[1], 10);
  } catch {
    /* base may be unrelated; ignore */
  }
  return { filesChanged, insertions, deletions };
}
