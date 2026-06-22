// Minimal observable app state. PTY bytes do NOT flow through here (they go
// straight to xterm); only low-frequency metadata does, so React stays cheap.
import { useSyncExternalStore } from 'react';
import type { AgentMeta, Project, ProjectRoot, Settings, TokenUsage } from './types';

export interface AppState {
  projects: Project[];
  roots: ProjectRoot[];
  agents: AgentMeta[];
  settings: Settings | null;
  connected: boolean;
}

let state: AppState = { projects: [], roots: [], agents: [], settings: null, connected: false };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getState(): AppState {
  return state;
}

export function setConnected(connected: boolean) {
  state = { ...state, connected };
  emit();
}

export function applyServerState(s: {
  projects: Project[];
  roots?: ProjectRoot[];
  agents: AgentMeta[];
  settings: Settings;
}) {
  state = { ...state, projects: s.projects, roots: s.roots ?? [], agents: s.agents, settings: s.settings };
  emit();
}

export function updateAgentTokens(agentId: string, usage: TokenUsage) {
  state = {
    ...state,
    agents: state.agents.map((a) => (a.id === agentId ? { ...a, usage } : a)),
  };
  emit();
}

export function removeAgent(agentId: string) {
  state = { ...state, agents: state.agents.filter((a) => a.id !== agentId) };
  emit();
}

export function useApp(): AppState {
  return useSyncExternalStore(subscribe, getState);
}
