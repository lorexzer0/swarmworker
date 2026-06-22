import type { AgentMeta } from '../types';
import { useApp } from '../store';
import { STATUS_COLOR, STATUS_LABEL, fmtTokens } from '../util';
import { stopAgent, resumeAgent, cycleAgentMode, deleteAgent, setAgentProfile } from '../actions';

export function StatusDot({ agent }: { agent: AgentMeta }) {
  return (
    <span
      className="dot"
      style={{ background: STATUS_COLOR[agent.status] }}
      title={STATUS_LABEL[agent.status]}
    />
  );
}

/** Assign a git profile to an agent. Applies on the agent's next launch/resume. */
export function AgentProfilePicker({ agent }: { agent: AgentMeta }) {
  const { profiles } = useApp();
  const running = agent.status === 'running' || agent.status === 'starting';
  return (
    <select
      className="profile-pick"
      value={agent.profileId ?? ''}
      title={`Git identity + signing${running ? ' — applies on next resume' : ''}`}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => setAgentProfile(agent.id, e.target.value || null).catch((err) => alert(err.message))}
    >
      <option value="">git: ambient</option>
      {profiles.map((p) => (
        <option key={p.id} value={p.id}>
          {p.label}
          {p.gpgSign ? ' ✶' : ''}
        </option>
      ))}
    </select>
  );
}

export function ModeChip({ agent }: { agent: AgentMeta }) {
  return (
    <span className={`chip mode-${agent.mode}`} title="permission mode at launch">
      {agent.mode}
    </span>
  );
}

export function Tokens({ agent, compact }: { agent: AgentMeta; compact?: boolean }) {
  const u = agent.usage;
  return (
    <span className="tokens">
      <span className="tok in" title="input tokens (cumulative)">
        ↑ {fmtTokens(u.inputTokens)}
      </span>
      <span className="tok out" title="output tokens (cumulative)">
        ↓ {fmtTokens(u.outputTokens)}
      </span>
      {!compact && (
        <span className="tok cache" title="cache-read tokens">
          ⚡ {fmtTokens(u.cacheReadTokens)}
        </span>
      )}
    </span>
  );
}

export function AgentActions({ agent, compact }: { agent: AgentMeta; compact?: boolean }) {
  const running = agent.status === 'running' || agent.status === 'starting';

  const onRemove = () => {
    const detail = agent.inPlace
      ? `\n\nThis agent runs directly in the repo checkout — nothing on disk is touched:\n${agent.worktreePath}`
      : `\n\nIts git worktree and branch are kept on disk at:\n${agent.worktreePath}`;
    if (confirm(`Remove "${agent.name}" from the list?${detail}`)) {
      deleteAgent(agent.id, false).catch((e) => alert(e.message));
    }
  };

  return (
    <span className="actions" onMouseDown={(e) => e.stopPropagation()}>
      {running ? (
        <button className="act stop" onClick={() => stopAgent(agent.id)} title="Stop (keeps branch)">
          ■{compact ? '' : ' stop'}
        </button>
      ) : (
        <button className="act go" onClick={() => resumeAgent(agent.id).catch((e) => alert(e.message))} title="Resume session">
          ▶{compact ? '' : ' resume'}
        </button>
      )}
      <button
        className="act"
        onClick={() => cycleAgentMode(agent.id)}
        disabled={!running}
        title="Cycle permission mode (sends Shift+Tab to the TUI)"
      >
        ⇄{compact ? '' : ' mode'}
      </button>
      <button className="act del" onClick={onRemove} title="Remove from list (keeps worktree + branch)">
        ✕
      </button>
    </span>
  );
}
