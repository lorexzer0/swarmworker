// Owns the lifecycle of every agent: one persistent `claude` PTY per git
// worktree, plus the transcript watcher that feeds token usage. Emits events
// the WS layer broadcasts to the SPA.
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import path from 'path';
import * as pty from '@homebridge/node-pty-prebuilt-multiarch';
import type { IPty } from '@homebridge/node-pty-prebuilt-multiarch';

import { resolveClaudeLauncher, sanitizedEnv, ensureTrusted } from './claudeConfig.js';
import { TranscriptWatcher, emptyUsage, transcriptExists, mostRecentSession } from './tokens.js';
import {
  isGitRepo,
  repoToplevel,
  currentBranch,
  addWorktree,
  removeWorktree,
  deleteBranchRef,
  generateBranch,
  toSnakeCase,
} from './worktrees.js';
import type { Store } from './store.js';
import type { AgentMeta, PermissionMode, Project } from './types.js';

const RING_LIMIT = 256 * 1024; // bytes of recent PTY output kept for replay
const SHIFT_TAB = '\x1b[Z'; // cycles permission mode in the Claude TUI
// ConPTY silently drops input bytes when a single write overflows its buffer,
// which mangles large pastes. Write big input in paced chunks instead.
const PTY_INPUT_CHUNK = 1024; // code units per write
const PTY_INPUT_GAP_MS = 5; // let ConPTY drain between chunks

interface LiveAgent {
  meta: AgentMeta;
  proc?: IPty;
  watcher?: TranscriptWatcher;
  ring: string[];
  ringBytes: number;
  inBuf?: string; // input awaiting paced write to the PTY
  inFlushing?: boolean; // a drain loop is currently active
}

/** Prefix of up to `max` code units that never splits a surrogate pair. */
function sliceCodePoints(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = max;
  const c = s.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end -= 1; // trailing high surrogate → next chunk
  return s.slice(0, end);
}

export interface SpawnOptions {
  projectId: string;
  base?: string;
  branch?: string;
  model?: string;
  mode?: PermissionMode;
  name?: string;
  initialPrompt?: string;
  /** Run directly in the repo's main checkout (no worktree, no new branch). */
  inPlace?: boolean;
  /** Git profile (identity + signing) applied to this agent's commits. */
  profileId?: string;
}

export class AgentManager extends EventEmitter {
  private agents = new Map<string, LiveAgent>();

  constructor(private store: Store) {
    super();
    // Reload prior agents as "exited" so they can be resumed after a restart.
    for (const meta of store.state.agents) {
      this.agents.set(meta.id, {
        meta: { ...meta, inPlace: meta.inPlace ?? false, status: 'exited' },
        ring: [],
        ringBytes: 0,
      });
    }
  }

  list(): AgentMeta[] {
    return [...this.agents.values()].map((a) => a.meta);
  }

  getReplay(id: string): string {
    return this.agents.get(id)?.ring.join('') ?? '';
  }

  private project(id: string): Project {
    const p = this.store.state.projects.find((x) => x.id === id);
    if (!p) throw new Error(`unknown project ${id}`);
    return p;
  }

  private runningCount(): number {
    return this.list().filter((a) => a.status === 'running' || a.status === 'starting').length;
  }

  private syncStore(): void {
    this.store.state.agents = this.list();
    this.store.save();
  }

  private pushRing(a: LiveAgent, data: string): void {
    a.ring.push(data);
    a.ringBytes += data.length;
    while (a.ringBytes > RING_LIMIT && a.ring.length > 1) {
      a.ringBytes -= a.ring.shift()!.length;
    }
  }

  async spawn(opts: SpawnOptions): Promise<AgentMeta> {
    const cap = this.store.state.settings.concurrencyCap;
    if (this.runningCount() >= cap) {
      throw new Error(`concurrency cap reached (${cap}); raise it in settings`);
    }
    const project = this.project(opts.projectId);
    if (!(await isGitRepo(project.path))) {
      throw new Error(`${project.path} is not a git repository`);
    }
    const repo = await repoToplevel(project.path);
    const id = randomUUID().slice(0, 8);

    let worktreePath: string;
    let branch: string;
    let base: string;
    if (opts.inPlace) {
      // Work directly in the repo's main checkout: no worktree, no new branch.
      // We stay on whatever branch the repo is currently on. Several agents may
      // share one checkout (e.g. two researches + one writer), so we don't gate
      // this — the UI just warns when a checkout already has a live agent.
      base = await currentBranch(repo);
      branch = base;
      worktreePath = repo;
    } else {
      base = opts.base || project.defaultBranch || (await currentBranch(repo));
      branch = opts.branch?.trim() || generateBranch(base, id);
      ({ worktreePath } = await addWorktree(
        repo,
        this.store.state.settings.worktreeRoot,
        project.id,
        branch,
        base,
      ));
    }

    ensureTrusted(worktreePath);

    const sessionId = randomUUID();
    const model = opts.model || this.store.state.settings.defaultModel;
    const mode = opts.mode || this.store.state.settings.defaultMode;
    const cols = 120;
    const rows = 34;

    const meta: AgentMeta = {
      id,
      projectId: project.id,
      projectName: project.name,
      repoPath: repo,
      branch,
      baseBranch: base,
      worktreePath,
      inPlace: !!opts.inPlace,
      profileId: opts.profileId || undefined,
      sessionId,
      model,
      mode,
      name: opts.name?.trim() || branch,
      status: 'starting',
      createdAt: Date.now(),
      exitCode: null,
      cols,
      rows,
      usage: emptyUsage(),
    };

    const live: LiveAgent = { meta, ring: [], ringBytes: 0 };
    this.agents.set(id, live);

    this.startProcess(live, ['--session-id', sessionId], {
      renameTo: toSnakeCase(meta.name),
      initialPrompt: opts.initialPrompt,
    });
    this.syncStore();
    this.emit('update', meta);
    return meta;
  }

  /** (Re)launch the claude process for an existing live-agent record.
   *  `seed.renameTo` names the conversation (sent as `/rename` before anything
   *  else); `seed.initialPrompt` is the first message — typed after the rename. */
  private startProcess(
    live: LiveAgent,
    sessionArgs: string[],
    seed?: { renameTo?: string; initialPrompt?: string },
  ): void {
    const { meta } = live;
    const launcher = resolveClaudeLauncher();
    const args = [
      ...launcher.prefixArgs,
      ...sessionArgs,
      '--permission-mode', meta.mode,
      '--model', meta.model,
    ];

    const proc = pty.spawn(launcher.file, args, {
      name: 'xterm-256color',
      cols: meta.cols,
      rows: meta.rows,
      cwd: meta.worktreePath,
      env: sanitizedEnv({ FORCE_COLOR: '1', ...this.gitProfileEnv(meta.profileId) }),
    });
    live.proc = proc;
    meta.status = 'starting';
    meta.exitCode = null;

    proc.onData((data) => {
      if (meta.status === 'starting') {
        meta.status = 'running';
        this.emit('update', meta);
      }
      this.pushRing(live, data);
      this.emit('pty', meta.id, data);
    });

    proc.onExit(({ exitCode }) => {
      meta.status = 'exited';
      meta.exitCode = exitCode;
      live.proc = undefined;
      live.watcher?.stop();
      live.watcher = undefined;
      this.syncStore();
      this.emit('update', meta);
    });

    const watcher = new TranscriptWatcher(meta.worktreePath, meta.sessionId, (usage) => {
      meta.usage = usage;
      this.emit('tokens', meta.id, usage);
      this.syncStore();
    });
    watcher.start();
    live.watcher = watcher;

    // Drive the TUI once it's up: name the conversation first, then send the
    // initial prompt. Each line is typed, then submitted ~400ms later; the next
    // line starts ~900ms after that so the TUI settles between them.
    let at = 3500;
    const sendLine = (text: string) => {
      const a = at;
      setTimeout(() => proc.write(text), a);
      setTimeout(() => proc.write('\r'), a + 400);
      at += 1300;
    };
    if (seed?.renameTo) sendLine(`/rename ${seed.renameTo}`);
    if (seed?.initialPrompt) sendLine(seed.initialPrompt);
  }

  /** Reset a live record's replay/usage and (re)start its process. */
  private relaunch(
    live: LiveAgent,
    sessionArgs: string[],
    seed?: { renameTo?: string; initialPrompt?: string },
  ): void {
    live.ring = [];
    live.ringBytes = 0;
    live.meta.usage = emptyUsage();
    this.startProcess(live, sessionArgs, seed);
  }

  input(id: string, data: string): void {
    const live = this.agents.get(id);
    if (!live?.proc || !data) return;
    // Fast path: small input with nothing queued (normal typing) goes straight
    // through — no added latency.
    if (!live.inBuf && data.length <= PTY_INPUT_CHUNK) {
      live.proc.write(data);
      return;
    }
    // Otherwise queue it and drain in paced chunks. Appending preserves order
    // even if more input arrives mid-paste.
    live.inBuf = (live.inBuf ?? '') + data;
    if (!live.inFlushing) this.flushInput(live);
  }

  /** Drain a live-agent's input buffer to its PTY in paced chunks. */
  private flushInput(live: LiveAgent): void {
    live.inFlushing = true;
    const step = () => {
      if (!live.proc) {
        // Agent exited mid-paste — drop the rest.
        live.inBuf = '';
        live.inFlushing = false;
        return;
      }
      const buf = live.inBuf ?? '';
      if (!buf) {
        live.inFlushing = false;
        return;
      }
      const chunk = sliceCodePoints(buf, PTY_INPUT_CHUNK);
      live.inBuf = buf.slice(chunk.length);
      live.proc.write(chunk);
      if (live.inBuf) setTimeout(step, PTY_INPUT_GAP_MS);
      else live.inFlushing = false;
    };
    step();
  }

  resize(id: string, cols: number, rows: number): void {
    const live = this.agents.get(id);
    if (!live || !cols || !rows) return;
    live.meta.cols = cols;
    live.meta.rows = rows;
    try {
      live.proc?.resize(cols, rows);
    } catch {
      /* pty may have exited */
    }
  }

  /** Cycle the permission mode via the TUI's native Shift+Tab. */
  cycleMode(id: string): void {
    this.agents.get(id)?.proc?.write(SHIFT_TAB);
  }

  /**
   * Build the env that pins git's identity + signing for an agent. Uses git's
   * GIT_CONFIG_COUNT/KEY/VALUE override so it applies to every git command the
   * agent runs, per-process, without touching any on-disk config.
   */
  private gitProfileEnv(profileId?: string): Record<string, string> {
    if (!profileId) return {};
    const p = this.store.state.profiles?.find((x) => x.id === profileId);
    if (!p) return {};
    const kv: [string, string][] = [];
    if (p.userName) kv.push(['user.name', p.userName]);
    if (p.userEmail) kv.push(['user.email', p.userEmail]);
    kv.push(['commit.gpgsign', p.gpgSign ? 'true' : 'false']);
    kv.push(['tag.gpgsign', p.gpgSign ? 'true' : 'false']);
    if (p.gpgSign && p.signingKey) kv.push(['user.signingkey', p.signingKey]);
    if (p.gpgSign && p.gpgFormat) kv.push(['gpg.format', p.gpgFormat]);
    const env: Record<string, string> = { GIT_CONFIG_COUNT: String(kv.length) };
    kv.forEach(([k, v], i) => {
      env[`GIT_CONFIG_KEY_${i}`] = k;
      env[`GIT_CONFIG_VALUE_${i}`] = v;
    });
    return env;
  }

  /** Assign a git profile to an agent. Takes effect on its next (re)launch. */
  setProfile(id: string, profileId: string | null): AgentMeta | undefined {
    const live = this.agents.get(id);
    if (!live) return undefined;
    live.meta.profileId = profileId || undefined;
    this.syncStore();
    this.emit('update', live.meta);
    return live.meta;
  }

  async stop(id: string): Promise<void> {
    const live = this.agents.get(id);
    if (!live) return;
    live.watcher?.stop();
    if (live.proc) {
      try {
        live.proc.kill();
      } catch {
        /* already gone */
      }
    }
    live.meta.status = 'exited';
    this.syncStore();
    this.emit('update', live.meta);
  }

  /** Resume an exited agent in the same worktree via --resume. */
  resume(id: string): AgentMeta {
    const live = this.agents.get(id);
    if (!live) throw new Error(`unknown agent ${id}`);
    if (live.proc) return live.meta; // already running
    ensureTrusted(live.meta.worktreePath);
    // Resume the prior conversation if Claude saved one; otherwise the old
    // session had no transcript (e.g. stopped at idle) — start fresh in the
    // same worktree rather than failing with "No conversation found".
    if (transcriptExists(live.meta.worktreePath, live.meta.sessionId)) {
      this.relaunch(live, ['--resume', live.meta.sessionId]);
    } else {
      live.meta.sessionId = randomUUID();
      this.relaunch(live, ['--session-id', live.meta.sessionId], {
        renameTo: toSnakeCase(live.meta.name),
      });
    }
    this.emit('update', live.meta);
    return live.meta;
  }

  /** Every agent record (running or exited) bound to a worktree path. */
  private agentsInWorktree(p: string): LiveAgent[] {
    const norm = path.normalize(p);
    return [...this.agents.values()].filter(
      (a) => path.normalize(a.meta.worktreePath) === norm,
    );
  }

  /** Agents with a live PTY (running/starting) in a worktree. */
  private runningInWorktree(p: string): LiveAgent[] {
    return this.agentsInWorktree(p).filter((a) => a.proc);
  }

  /** A bound record with no live PTY — reusable for resume-in-place. */
  private findIdleByWorktree(p: string): LiveAgent | undefined {
    return this.agentsInWorktree(p).find((a) => !a.proc);
  }

  /** How many agents currently have a live PTY in this worktree. */
  liveAgentCount(p: string): number {
    return this.runningInWorktree(p).length;
  }

  /** Representative agent for a worktree row — prefer a live one, else any. */
  findByWorktree(p: string): AgentMeta | undefined {
    const all = this.agentsInWorktree(p);
    return (all.find((a) => a.proc) ?? all[0])?.meta;
  }

  /**
   * "Continue working" on an existing worktree. Re-entering a worktree almost
   * always means picking up a prior conversation, so by default we resume the
   * requested discussion (`sessionId`), or the most recent one if none is given.
   * Pass `fresh` to start a brand-new conversation instead.
   *
   * A worktree may host several agents at once (e.g. two researches + one
   * writer). We focus a conversation that is already live rather than launching
   * a duplicate PTY, reuse an idle bound record where one exists, and otherwise
   * start an ADDITIONAL agent alongside whatever is already running here.
   */
  async openWorktree(opts: {
    projectId: string;
    worktreePath: string;
    branch: string | null;
    sessionId?: string;
    fresh?: boolean;
  }): Promise<AgentMeta> {
    const worktreePath = path.normalize(opts.worktreePath);
    const running = this.runningInWorktree(worktreePath);

    // Focus an already-live conversation instead of opening a duplicate PTY:
    //  - an explicit session some agent here is already running, or
    //  - a plain re-open (no session, not fresh) → focus the latest live agent.
    if (!opts.fresh) {
      if (opts.sessionId) {
        const onSession = running.find((a) => a.meta.sessionId === opts.sessionId);
        if (onSession) return onSession.meta;
      } else if (running.length) {
        return running[running.length - 1].meta;
      }
    }

    // Reuse an idle bound record (resume in place) only when nothing is live
    // here — keeps records tidy after a restart. With an agent already running,
    // a fresh/different conversation falls through to spawn a second agent.
    const idle = this.findIdleByWorktree(worktreePath);
    if (idle && !running.length) {
      if (opts.fresh) {
        ensureTrusted(idle.meta.worktreePath);
        idle.meta.sessionId = randomUUID();
        this.relaunch(idle, ['--session-id', idle.meta.sessionId], {
          renameTo: toSnakeCase(idle.meta.name),
        });
        this.emit('update', idle.meta);
        return idle.meta;
      }
      // Explicit sessionId repoints the record; otherwise resume its own session.
      if (opts.sessionId) idle.meta.sessionId = opts.sessionId;
      return this.resume(idle.meta.id);
    }

    const cap = this.store.state.settings.concurrencyCap;
    if (this.runningCount() >= cap) {
      throw new Error(`concurrency cap reached (${cap}); raise it in settings`);
    }
    const project = this.project(opts.projectId);
    const repo = await repoToplevel(project.path);
    const inPlace = worktreePath === path.normalize(repo);
    ensureTrusted(worktreePath);

    // Re-entering an unbound worktree → continue a prior conversation by default
    // (explicit pick, else most recent); `fresh` forces a new one.
    const target = opts.fresh ? undefined : opts.sessionId || mostRecentSession(worktreePath);
    const id = randomUUID().slice(0, 8);
    const sessionId = target || randomUUID();
    const meta: AgentMeta = {
      id,
      projectId: project.id,
      projectName: project.name,
      repoPath: repo,
      branch: opts.branch || 'detached',
      baseBranch: project.defaultBranch,
      worktreePath,
      inPlace,
      sessionId,
      model: this.store.state.settings.defaultModel,
      mode: this.store.state.settings.defaultMode,
      name: opts.branch || path.basename(worktreePath),
      status: 'starting',
      createdAt: Date.now(),
      exitCode: null,
      cols: 120,
      rows: 34,
      usage: emptyUsage(),
    };
    const live: LiveAgent = { meta, ring: [], ringBytes: 0 };
    this.agents.set(id, live);
    if (target) {
      this.startProcess(live, ['--resume', target]);
    } else {
      this.startProcess(live, ['--session-id', sessionId], { renameTo: toSnakeCase(meta.name) });
    }
    this.syncStore();
    this.emit('update', meta);
    return meta;
  }

  /** Remove a worktree from disk (and optionally its branch), cleaning up any
   * bound agent first. Refuses to touch the repo's main worktree. */
  async deleteWorktree(
    projectId: string,
    worktreePath: string,
    branch: string | null,
    deleteBranch: boolean,
  ): Promise<void> {
    const project = this.project(projectId);
    const repo = await repoToplevel(project.path);
    if (path.normalize(worktreePath) === path.normalize(repo)) {
      throw new Error('cannot delete the repository\'s main worktree');
    }
    // A worktree can host several agents — clean up every one bound to it.
    for (const live of this.agentsInWorktree(worktreePath)) {
      await this.stop(live.meta.id);
      this.agents.delete(live.meta.id);
      this.emit('removed', live.meta.id);
    }
    await removeWorktree(repo, worktreePath);
    if (deleteBranch && branch && branch !== 'detached') {
      try {
        await deleteBranchRef(repo, branch);
      } catch (e) {
        console.error('[agent] branch delete failed', e);
      }
    }
    this.syncStore();
    this.emit('update', { id: '' } as AgentMeta);
  }

  async remove(id: string, deleteWorktree: boolean): Promise<void> {
    const live = this.agents.get(id);
    if (!live) return;
    await this.stop(id);
    // Never delete the repo's main checkout — an in-place agent has no worktree
    // of its own to remove.
    if (deleteWorktree && !live.meta.inPlace) {
      try {
        await removeWorktree(live.meta.repoPath, live.meta.worktreePath);
      } catch (e) {
        console.error('[agent] worktree remove failed', e);
      }
    }
    this.agents.delete(id);
    this.syncStore();
    this.emit('removed', id);
  }

  shutdown(): void {
    for (const live of this.agents.values()) {
      live.watcher?.stop();
      try {
        live.proc?.kill();
      } catch {
        /* ignore */
      }
    }
  }
}
