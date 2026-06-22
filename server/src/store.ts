// Tiny persistent JSON store for projects, settings, and agent metadata.
// Lives in ~/.swarmworker/state.json. Atomic writes, debounced.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import type { PersistedState, Settings } from './types.js';

// Data dir (state.json) — override with SWARM_DATA_DIR to run isolated instances.
const dataDir = process.env.SWARM_DATA_DIR
  ? path.resolve(process.env.SWARM_DATA_DIR)
  : path.join(os.homedir(), '.swarmworker');
const stateFile = path.join(dataDir, 'state.json');

export const DATA_DIR = dataDir;

/**
 * Where worktrees live. Worktrees are the hot path for file I/O, so we default
 * them to the SAME DRIVE as the app (e.g. W:) rather than C: under the home
 * dir. Override explicitly with SWARM_WORKTREE_ROOT or via Settings.
 */
function defaultWorktreeRoot(): string {
  if (process.env.SWARM_WORKTREE_ROOT) return process.env.SWARM_WORKTREE_ROOT;
  const appDriveRoot = path.parse(fileURLToPath(import.meta.url)).root; // "W:\\" / "/"
  return path.join(appDriveRoot, 'swarmworker-worktrees');
}

function defaultSettings(): Settings {
  return {
    defaultModel: 'opus',
    defaultMode: 'auto',
    concurrencyCap: 6,
    worktreeRoot: defaultWorktreeRoot(),
  };
}

export class Store {
  state: PersistedState;
  private saveTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    fs.mkdirSync(dataDir, { recursive: true });
    this.state = this.load();
    fs.mkdirSync(this.state.settings.worktreeRoot, { recursive: true });
  }

  private load(): PersistedState {
    try {
      const raw = fs.readFileSync(stateFile, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      const settings = { ...defaultSettings(), ...(parsed.settings ?? {}) };
      // An explicit env override always wins over the persisted value.
      if (process.env.SWARM_WORKTREE_ROOT) settings.worktreeRoot = process.env.SWARM_WORKTREE_ROOT;
      return {
        projects: parsed.projects ?? [],
        roots: parsed.roots ?? [],
        profiles: parsed.profiles ?? [],
        settings,
        agents: parsed.agents ?? [],
      };
    } catch {
      return { projects: [], roots: [], profiles: [], settings: defaultSettings(), agents: [] };
    }
  }

  /** Debounced atomic save. */
  save(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      const tmp = stateFile + '.tmp';
      try {
        fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
        fs.renameSync(tmp, stateFile);
      } catch (e) {
        console.error('[store] save failed', e);
      }
    }, 200);
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.state.settings = { ...this.state.settings, ...patch };
    this.save();
    return this.state.settings;
  }
}
