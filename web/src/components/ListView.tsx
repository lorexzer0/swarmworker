import { useState } from 'react';
import { useApp } from '../store';
import { fmtAge, fmtTokens, useNow } from '../util';
import { TerminalMount } from './TerminalMount';
import { StatusDot, ModeChip, Tokens, AgentActions } from './AgentBits';

export function ListView({ onNew }: { onNew: () => void }) {
  const { agents } = useApp();
  const now = useNow();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = agents.find((a) => a.id === selectedId) || agents[0] || null;

  if (!agents.length)
    return (
      <div className="empty">
        <div className="empty-mark">≣</div>
        <h2>No agents yet</h2>
        <button className="primary" onClick={onNew}>
          + New agent
        </button>
      </div>
    );

  return (
    <div className="list-layout">
      <div className="table-wrap">
        <table className="agents">
          <thead>
            <tr>
              <th></th>
              <th>Agent</th>
              <th>Project</th>
              <th>Branch</th>
              <th>Model</th>
              <th>Mode</th>
              <th className="num">In</th>
              <th className="num">Out</th>
              <th className="num">Cache</th>
              <th className="num">Turns</th>
              <th className="num">Age</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr
                key={a.id}
                className={a.id === selected?.id ? 'sel' : ''}
                onClick={() => setSelectedId(a.id)}
              >
                <td>
                  <StatusDot agent={a} />
                </td>
                <td>{a.name}</td>
                <td>{a.projectName}</td>
                <td className="mono small">{a.branch}</td>
                <td className="small">{a.model}</td>
                <td>
                  <ModeChip agent={a} />
                </td>
                <td className="num">{fmtTokens(a.usage.inputTokens)}</td>
                <td className="num">{fmtTokens(a.usage.outputTokens)}</td>
                <td className="num">{fmtTokens(a.usage.cacheReadTokens)}</td>
                <td className="num">{a.usage.turns}</td>
                <td className="num">{fmtAge(now - a.createdAt)}</td>
                <td>
                  <AgentActions agent={a} compact />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="dock">
          <div className="dock-head">
            <StatusDot agent={selected} />
            <strong>{selected.name}</strong>
            <span className="muted small mono">{selected.worktreePath}</span>
            <span className="spacer" />
            <Tokens agent={selected} />
            <AgentActions agent={selected} />
          </div>
          <div className="dock-term">
            <TerminalMount agentId={selected.id} focusOnMount />
          </div>
        </div>
      )}
    </div>
  );
}
