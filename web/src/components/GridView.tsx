import { useEffect, useState } from 'react';
import { useApp } from '../store';
import { terminals } from '../terminals';
import { fmtAge, useNow } from '../util';
import type { AgentMeta } from '../types';
import { TerminalMount } from './TerminalMount';
import { StatusDot, ModeChip, Tokens, AgentActions } from './AgentBits';

export function GridView({
  onNew,
  focusId,
  onFocused,
}: {
  onNew: () => void;
  focusId?: string | null;
  onFocused?: () => void;
}) {
  const { agents } = useApp();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expanded = agents.find((a) => a.id === expandedId) || null;

  // When asked to focus an agent (e.g. from the worktree manager), expand it.
  useEffect(() => {
    if (focusId && agents.some((a) => a.id === focusId)) {
      setExpandedId(focusId);
      onFocused?.();
    }
  }, [focusId, agents, onFocused]);

  // Reclaim/refit terminals when expansion toggles.
  useEffect(() => {
    const t = setTimeout(() => terminals.fitAll(), 60);
    return () => clearTimeout(t);
  }, [expandedId, agents.length]);

  if (!agents.length) return <EmptyState onNew={onNew} />;

  return (
    <>
      <div className="grid">
        {agents.map((a) => (
          <AgentTile key={a.id} agent={a} hidden={a.id === expandedId} onExpand={() => setExpandedId(a.id)} />
        ))}
      </div>
      {expanded && <ExpandOverlay agent={expanded} onClose={() => setExpandedId(null)} />}
    </>
  );
}

function AgentTile({
  agent,
  hidden,
  onExpand,
}: {
  agent: AgentMeta;
  hidden: boolean;
  onExpand: () => void;
}) {
  const now = useNow();
  return (
    <div className={`tile status-${agent.status}`}>
      <div className="tile-head">
        <StatusDot agent={agent} />
        <span className="tile-name" title={agent.branch}>
          {agent.name}
        </span>
        <span className="tile-proj" title={agent.worktreePath}>
          {agent.projectName}
        </span>
        <span className="spacer" />
        <Tokens agent={agent} compact />
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
          <span className="spacer" />
          <Tokens agent={agent} />
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
