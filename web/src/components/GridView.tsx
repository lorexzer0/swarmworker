import { useEffect, useState } from 'react';
import { useApp } from '../store';
import { terminals } from '../terminals';
import { fmtAge, useNow } from '../util';
import type { AgentMeta, GridCols } from '../types';
import { TerminalMount } from './TerminalMount';
import { StatusDot, ModeChip, Tokens, AgentActions, AgentProfilePicker } from './AgentBits';

// Minimized tiles are remembered across view switches and reloads.
const MINIMIZED_KEY = 'sw.minimized';
function loadMinimized(): Set<string> {
  try {
    const raw = localStorage.getItem(MINIMIZED_KEY);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

export function GridView({
  onNew,
  cols,
  focusId,
  onFocused,
}: {
  onNew: () => void;
  cols: GridCols;
  focusId?: string | null;
  onFocused?: () => void;
}) {
  const { agents } = useApp();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [minimized, setMinimized] = useState<Set<string>>(loadMinimized);
  const expanded = agents.find((a) => a.id === expandedId) || null;

  const restore = (id: string) =>
    setMinimized((s) => {
      if (!s.has(id)) return s;
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  const minimize = (id: string) => {
    setExpandedId((cur) => (cur === id ? null : cur)); // a minimized tile can't stay expanded
    setMinimized((s) => new Set(s).add(id));
  };

  useEffect(() => {
    try {
      localStorage.setItem(MINIMIZED_KEY, JSON.stringify([...minimized]));
    } catch {
      /* storage unavailable */
    }
  }, [minimized]);

  // When asked to focus an agent (e.g. from the worktree manager), restore it
  // if minimized and expand it.
  useEffect(() => {
    if (focusId && agents.some((a) => a.id === focusId)) {
      restore(focusId);
      setExpandedId(focusId);
      onFocused?.();
    }
  }, [focusId, agents, onFocused]);

  // Reclaim/refit terminals when the visible set or layout changes.
  useEffect(() => {
    const t = setTimeout(() => terminals.fitAll(), 60);
    return () => clearTimeout(t);
  }, [expandedId, agents.length, minimized, cols]);

  if (!agents.length) return <EmptyState onNew={onNew} />;

  const visible = agents.filter((a) => !minimized.has(a.id));
  const pilled = agents.filter((a) => minimized.has(a.id));
  // 'auto' keeps the responsive auto-fit from CSS; a number forces N columns.
  const gridStyle = cols === 'auto' ? undefined : { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` };

  return (
    <div className="grid-view">
      <div className="grid" style={gridStyle}>
        {visible.map((a) => (
          <AgentTile
            key={a.id}
            agent={a}
            hidden={a.id === expandedId}
            onExpand={() => setExpandedId(a.id)}
            onMinimize={() => minimize(a.id)}
          />
        ))}
      </div>
      {pilled.length > 0 && (
        <div className="grid-dock">
          <span className="grid-dock-label small muted">minimized · {pilled.length}</span>
          {pilled.map((a) => (
            <MinimizedPill key={a.id} agent={a} onRestore={() => restore(a.id)} />
          ))}
        </div>
      )}
      {expanded && <ExpandOverlay agent={expanded} onClose={() => setExpandedId(null)} />}
    </div>
  );
}

function MinimizedPill({ agent, onRestore }: { agent: AgentMeta; onRestore: () => void }) {
  return (
    <button className="grid-pill" onClick={onRestore} title={`Restore ${agent.name}\n${agent.worktreePath}`}>
      <StatusDot agent={agent} />
      <span className="grid-pill-name">{agent.name}</span>
      <span className="grid-pill-proj muted small">{agent.projectName}</span>
    </button>
  );
}

function AgentTile({
  agent,
  hidden,
  onExpand,
  onMinimize,
}: {
  agent: AgentMeta;
  hidden: boolean;
  onExpand: () => void;
  onMinimize: () => void;
}) {
  const now = useNow();
  return (
    <div className={`tile status-${agent.status}`}>
      <div className="tile-head">
        <StatusDot agent={agent} />
        <span className="tile-name" title={agent.branch}>
          {agent.name}
        </span>
        <span className="tile-proj">{agent.projectName}</span>
        <span className="tile-wt mono small muted" title={agent.worktreePath}>
          {agent.worktreePath}
        </span>
        <span className="spacer" />
        <Tokens agent={agent} compact />
        <button className="icon" title="Minimize to dock" onClick={onMinimize}>
          —
        </button>
        <button className="icon" title="Open viewer" onClick={onExpand}>
          ⤢
        </button>
      </div>
      <div className="tile-body" onDoubleClick={onExpand}>
        {hidden ? <div className="tile-hidden">open in viewer ↗</div> : <TerminalMount agentId={agent.id} />}
      </div>
      <div className="tile-foot">
        <ModeChip agent={agent} />
        <span className="muted small">{agent.model}</span>
        <span className="spacer" />
        <span className="muted small">{fmtAge(now - agent.createdAt)}</span>
        <AgentActions agent={agent} compact />
      </div>
    </div>
  );
}

function ExpandOverlay({ agent, onClose }: { agent: AgentMeta; onClose: () => void }) {
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="viewer" onMouseDown={(e) => e.stopPropagation()}>
        <div className="viewer-head">
          <StatusDot agent={agent} />
          <strong>{agent.name}</strong>
          <span className="muted small">
            {agent.projectName} · {agent.branch} (base {agent.baseBranch})
          </span>
          <span className="muted small mono viewer-wt" title={agent.worktreePath}>
            {agent.worktreePath}
          </span>
          <span className="spacer" />
          <Tokens agent={agent} />
          <AgentProfilePicker agent={agent} />
          <ModeChip agent={agent} />
          <AgentActions agent={agent} />
          <button className="icon" onClick={onClose} title="Close viewer">
            ✕
          </button>
        </div>
        <div className="viewer-term">
          <TerminalMount agentId={agent.id} focusOnMount />
        </div>
        <div className="viewer-hint">
          Live Claude Code session — type to talk to it. <b>Shift+Tab</b> cycles permission mode. It keeps running until
          you stop it.
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="empty">
      <div className="empty-mark">◰</div>
      <h2>No agents yet</h2>
      <p>Spawn a Claude Code agent into a fresh git worktree of one of your projects.</p>
      <button className="primary" onClick={onNew}>
        + New agent
      </button>
    </div>
  );
}
