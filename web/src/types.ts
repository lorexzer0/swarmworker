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
  profileId?: string;
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
  defaultProfileId?: string;
}

/** A git identity + signing config that can be assigned to an agent. */
export interface GitProfile {
  id: string;
  label: string;
  userName: string;
  userEmail: string;
  gpgSign: boolean;
  signingKey?: string;
  gpgFormat?: 'openpgp' | 'ssh';
}

/** Form/draft shape when creating or editing a profile. */
export interface GitProfileDraft {
  label: string;
  userName: string;
  userEmail: string;
  gpgSign: boolean;
  signingKey?: string;
  gpgFormat?: 'openpgp' | 'ssh';
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

/** A holding folder scanned for git repos (or a single repo path). */
export interface ProjectRoot {
  id: string;
  path: string;
  addedAt: number;
}

/** A git repo discovered under a root (or a standalone registered project). */
export interface DiscoveredRepo {
  path: string;
  name: string;
  registered: boolean;
  projectId?: string;
  rootId?: string;
}

/** A prior Claude conversation recorded for a worktree. */
export interface Discussion {
  sessionId: string;
  title: string | null;
  preview: string | null;
  updatedAt: number;
  sizeBytes: number;
}
