import { useApp } from '../store';
import { fmtTokens } from '../util';

export function TopBar({
  view,
  setView,
  onNew,
  onSettings,
  onWorktrees,
}: {
  view: 'grid' | 'list';
  setView: (v: 'grid' | 'list') => void;
  onNew: () => void;
  onSettings: () => void;
  onWorktrees: () => void;
}) {
  const { agents, connected, settings } = useApp();
  const live = agents.filter((a) => a.status === 'running' || a.status === 'starting').length;
  const totIn = agents.reduce((s, a) => s + a.usage.inputTokens, 0);
  const totOut = agents.reduce((s, a) => s + a.usage.outputTokens, 0);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">◰</span> swarmworker
      </div>
      <div className="seg">
        <button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')} title="Security-camera grid">
          ▦ Grid
        </button>
        <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} title="List / metrics">
          ≣ List
        </button>
      </div>
      <span className="stat">
        <b>{live}</b>/{agents.length} live
      </span>
      <span className="stat" title="total tokens across all agents">
        Σ ↑{fmtTokens(totIn)} ↓{fmtTokens(totOut)}
      </span>
      <span className="spacer" />
      {settings && (
        <span className="muted small">
          default {settings.defaultModel} · {settings.defaultMode}
        </span>
      )}
      <span className={`conn ${connected ? 'ok' : 'bad'}`} title={connected ? 'backend connected' : 'reconnecting…'}>
        {connected ? '● connected' : '○ offline'}
      </span>
      <button className="ghost" onClick={onWorktrees} title="Worktree manager">
        ⌗ Worktrees
      </button>
      <button className="primary" onClick={onNew}>
        + New agent
      </button>
      <button className="ghost" onClick={onSettings} title="Settings">
        ⚙
      </button>
    </header>
  );
}
