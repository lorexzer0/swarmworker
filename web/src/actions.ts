import { api } from './api';
import type {
  AgentMeta,
  DiscoveredRepo,
  Discussion,
  GitProfile,
  GitProfileDraft,
  Project,
  ProjectRoot,
  Settings,
  WorktreeRow,
} from './types';

export const spawnAgent = (body: Record<string, unknown>) =>
  api<AgentMeta>('/agents', { method: 'POST', body: JSON.stringify(body) });

export const stopAgent = (id: string) => api(`/agents/${id}/stop`, { method: 'POST' });

export const resumeAgent = (id: string) => api<AgentMeta>(`/agents/${id}/resume`, { method: 'POST' });

export const cycleAgentMode = (id: string) => api(`/agents/${id}/mode/cycle`, { method: 'POST' });

export const deleteAgent = (id: string, worktree = false) =>
  api(`/agents/${id}?worktree=${worktree}`, { method: 'DELETE' });

export const addProject = (path: string) =>
  api<Project>('/projects', { method: 'POST', body: JSON.stringify({ path }) });

export const removeProject = (id: string) => api(`/projects/${id}`, { method: 'DELETE' });

export const getBranches = (projectId: string) =>
  api<{ branches: string[]; current: string }>(`/projects/${projectId}/branches`);

export const getBranchesByPath = (repoPath: string) =>
  api<{ branches: string[]; current: string }>(`/repos/branches?path=${encodeURIComponent(repoPath)}`);

export const listRoots = () => api<{ roots: ProjectRoot[] }>('/roots');

export const addRoot = (path: string) =>
  api<ProjectRoot>('/roots', { method: 'POST', body: JSON.stringify({ path }) });

export const removeRoot = (id: string) => api(`/roots/${id}`, { method: 'DELETE' });

export const listRepos = () => api<{ repos: DiscoveredRepo[] }>('/repos');

export const createProfile = (draft: GitProfileDraft) =>
  api<GitProfile>('/profiles', { method: 'POST', body: JSON.stringify(draft) });

export const updateProfile = (id: string, draft: GitProfileDraft) =>
  api<GitProfile>(`/profiles/${id}`, { method: 'PUT', body: JSON.stringify(draft) });

export const deleteProfile = (id: string) => api(`/profiles/${id}`, { method: 'DELETE' });

export const getGitIdentity = () =>
  api<{ userName: string; userEmail: string; signingKey: string; gpgSign: boolean; gpgFormat: 'openpgp' | 'ssh' }>(
    '/git/identity',
  );

export const setAgentProfile = (id: string, profileId: string | null) =>
  api<AgentMeta>(`/agents/${id}/profile`, { method: 'PATCH', body: JSON.stringify({ profileId }) });

export const patchSettings = (body: Partial<Settings>) =>
  api<Settings>('/settings', { method: 'PATCH', body: JSON.stringify(body) });

export const listWorktrees = () => api<{ worktrees: WorktreeRow[] }>('/worktrees');

export const openWorktree = (body: {
  projectId: string;
  worktreePath: string;
  branch: string | null;
  sessionId?: string;
  fresh?: boolean;
}) => api<AgentMeta>('/worktrees/open', { method: 'POST', body: JSON.stringify(body) });

export const listDiscussions = (worktreePath: string) =>
  api<{ discussions: Discussion[] }>(`/worktrees/discussions?path=${encodeURIComponent(worktreePath)}`);

export const deleteWorktree = (body: {
  projectId: string;
  worktreePath: string;
  branch: string | null;
  deleteBranch: boolean;
}) => api('/worktrees', { method: 'DELETE', body: JSON.stringify(body) });
