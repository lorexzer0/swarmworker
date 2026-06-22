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

/** A git identity + signing config that can be assigned to an agent. */
export interface GitProfile {
  id: string;
  label: string;
  userName: string;
  userEmail: string;
  gpgSign: boolean;
  signingKey?: string; // GPG key id/fingerprint, or SSH key (path or literal)
  gpgFormat?: 'openpgp' | 'ssh';
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
  profileId?: string; // git profile applied to this agent's commits (env-injected)
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
  defaultProfileId?: string; // git profile pre-selected for new agents
}

export interface PersistedState {
  projects: Project[];
  roots: ProjectRoot[];
  profiles: GitProfile[];
  settings: Settings;
  agents: AgentMeta[];
}
