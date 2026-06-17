// Owns the lifecycle of every agent: one persistent `claude` PTY per git
// worktree, plus the transcript watcher that feeds token usage. Emits events
// the WS layer broadcasts to the SPA.
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import path from 'path';
import * as pty from '@homebridge/node-pty-prebuilt-multiarch';
import type { IPty } from '@homebridge/node-pty-prebuilt-multiarch';

import { resolveClaudeLauncher, sanitizedEnv, ensureTrusted } from './claudeConfig.js';
import { TranscriptWatcher, emptyUsage, transcriptExists } from './tokens.js';
import {
  isGitRepo,
  repoToplevel,
  currentBranch,
  addWorktree,
  removeWorktree,
  deleteBranchRef,
  generateBranch,
} from './worktrees.js';
import type { Store } from './store.js';
import type { AgentMeta, PermissionMode, Project } from './types.js';

const RING_LIMIT = 256 * 1024; // bytes of recent PTY output kept for replay
const SHIFT_TAB = '\x1b[Z'; // cycles permission mode in the Claude TUI

interface LiveAgent {
  meta: AgentMeta;
  proc?: IPty;
  watcher?: TranscriptWatcher;
  ring: string[];
  ringBytes: number;
}

export interface SpawnOptions {
  projectId: string;
  base?: string;
  branch?: string;
  model?: string;
  mode?: PermissionMode;
  name?: string;
  initialPrompt?: string;
}

export class AgentManager extends EventEmitter {
  private agents = new Map<string, LiveAgent>();

  constructor(private store: Store) {
    super();
    // Reload prior agents as "exited" so they can be resumed after a restart.
    for (const meta of store.state.agents) {
      this.agents.set(meta.id, {
        meta: { ...meta, status: 'exited' },
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
    const base = opts.base || project.defaultBranch || (await currentBranch(repo));

    const id = randomUUID().slice(0, 8);
    const branch = opts.branch?.trim() || generateBranch(base, id);
    const { worktreePath } = await addWorktree(
      repo,
      this.store.state.settings.worktreeRoot,
      project.id,
      branch,
      base,
    );

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

    this.startProcess(live, ['--session-id', sessionId], opts.initialPrompt);
    this.syncStore();
    this.emit('update', meta);
    return meta;
  }

  /** (Re)launch the claude process for an existing live-agent record. */
  private startProcess(live: LiveAgent, sessionArgs: string[], initialPrompt?: string): void {
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
      env: sanitizedEnv({ FORCE_COLOR: '1' }),
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

    if (initialPrompt) {
      setTimeout(() => {
        proc.write(initialPrompt);
        setTimeout(() => proc.write('\r'), 400);
      }, 3500);
    }
  }

  input(id: string, data: string): void {
    this.agents.get(id)?.proc?.write(data);
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
    live.ring = [];
    live.ringBytes = 0;
    live.meta.usage = emptyUsage();
    // Resume the prior conversation if Claude saved one; otherwise the old
    // session had no transcript (e.g. stopped at idle) — start fresh in the
    // same worktree rather than failing with "No conversation found".
    let sessionArgs: string[];
    if (transcriptExists(live.meta.worktreePath, live.meta.sessionId)) {
      sessionArgs = ['--resume', live.meta.sessionId];
    } else {
      live.meta.sessionId = randomUUID();
      sessionArgs = ['--session-id', live.meta.sessionId];
    }
    this.startProcess(live, sessionArgs);
    this.emit('update', live.meta);
    return live.meta;
  }

  private findLiveByWorktree(p: string): LiveAgent | undefined {
    const norm = path.normalize(p);
    for (const live of this.agents.values()) {
      if (path.normalize(live.meta.worktreePath) === norm) return live;
    }
    return undefined;
  }

  /** Metadata of any agent (live or exited) bound to a worktree path. */
  findByWorktree(p: string): AgentMeta | undefined {
    return this.findLiveByWorktree(p)?.meta;
  }

  /**
   * "Continue working" on an existing worktree: if an agent is already bound,
   * focus it (running) or resume it (stopped); otherwise adopt the worktree
   * with a fresh agent — WITHOUT creating a new worktree.
   */
  async openWorktree(opts: {
    projectId: string;
    worktreePath: string;
    branch: string | null;
  }): Promise<AgentMeta> {
    const existing = this.findLiveByWorktree(opts.worktreePath);
    if (existing) {
      return existing.proc ? existing.meta : this.resume(existing.meta.id);
    }

    const cap = this.store.state.settings.concurrencyCap;
    if (this.runningCount() >= cap) {
      throw new Error(`concurrency cap reached (${cap}); raise it in settings`);
    }
    const project = this.project(opts.projectId);
    const repo = await repoToplevel(project.path);
    const worktreePath = path.normalize(opts.worktreePath);
    ensureTrusted(worktreePath);

    const id = randomUUID().slice(0, 8);
    const sessionId = randomUUID();
    const meta: AgentMeta = {
      id,
      projectId: project.id,
      projectName: project.name,
      repoPath: repo,
      branch: opts.branch || 'detached',
      baseBranch: project.defaultBranch,
      worktreePath,
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
    this.startProcess(live, ['--session-id', sessionId]);
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
    const live = this.findLiveByWorktree(worktreePath);
    if (live) {
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
    this.emit('update', live?.meta ?? ({ id: '' } as AgentMeta));
  }

  async remove(id: string, deleteWorktree: boolean): Promise<void> {
    const live = this.agents.get(id);
    if (!live) return;
    await this.stop(id);
    if (deleteWorktree) {
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
