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

/** Grid layout: 'auto' = responsive auto-fit; a number = fixed column count. */
export type GridCols = 'auto' | 1 | 2 | 3 | 4;
export const GRID_COLS: GridCols[] = ['auto', 1, 2, 3, 4];

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  lastModel?: string;
  turns: number;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  defaultBranch: string;
  addedAt: number;
}

export interface AgentMeta {
  id: string;
  projectId: string;
  projectName: string;
  repoPath: string;
  branch: string;
  baseBranch: string;
  worktreePath: string;
  inPlace: boolean;
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

export interface WorktreeRow {
  projectId: string;
  projectName: string;
  path: string;
  branch: string | null;
  head: string;
  isMain: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
  dirtyFiles: number;
  commitsAhead: number;
  discussions: number; // count of prior Claude conversations for this cwd
  liveAgents: number; // agents currently running in this worktree
  agent: { id: string; status: AgentStatus; model: string; mode: PermissionMode; name: string } | null;
}

/** A prior Claude conversation recorded for a worktree. */
export interface Discussion {
  sessionId: string;
  title: string | null;
  preview: string | null;
  updatedAt: number;
  sizeBytes: number;
}
