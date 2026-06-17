import type { TokenUsage } from './tokens.js';

export type PermissionMode =
  | 'auto'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'default'
  | 'dontAsk'
  | 'plan';

export const PERMISSION_MODES: PermissionMode[] = [
  'auto',
  'acceptEdits',
  'bypassPermissions',
  'default',
  'dontAsk',
  'plan',
];

export type AgentStatus = 'starting' | 'running' | 'exited' | 'error';

export interface Project {
  id: string;
  name: string;
  path: string; // absolute repo path
  defaultBranch: string;
  addedAt: number;
}

/** Serializable view of an agent (no live pty/watcher handles). */
export interface AgentMeta {
  id: string;
  projectId: string;
  projectName: string;
  repoPath: string;
  branch: string;
  baseBranch: string;
  worktreePath: string;
  inPlace: boolean; // true = running in the repo's main checkout, no worktree
  sessionId: string;
  model: string;
  mode: PermissionMode;
  name: string;
  status: AgentStatus;
  createdAt: number;
  exitCode?: number | null;
  cols: number;
  rows: number;
  usage: TokenUsage;
}

export interface Settings {
  defaultModel: string;
  defaultMode: PermissionMode;
  concurrencyCap: number;
  worktreeRoot: string;
}

export interface PersistedState {
  projects: Project[];
  settings: Settings;
  agents: AgentMeta[];
}
