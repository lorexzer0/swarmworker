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
  agent: { id: string; status: AgentStatus; model: string; mode: PermissionMode; name: string } | null;
}
