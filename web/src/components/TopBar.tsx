import { useApp } from '../store';
import { fmtTokens } from '../util';
import { GRID_COLS, type GridCols } from '../types';

export function TopBar({
  view,
  setView,
  gridCols,
  setGridCols,
  onNew,
  onSettings,
  onWorktrees,
  onProjects,
  onGitProfiles,
}: {
  view: 'grid' | 'list';
  setView: (v: 'grid' | 'list') => void;
  gridCols: GridCols;
  setGridCols: (c: GridCols) => void;
  onNew: () => void;
  onSettings: () => void;
  onWorktrees: () => void;
  onProjects: () => void;
  onGitProfiles: () => void;
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
      {view === 'grid' && (
        <div className="seg hide-narrow" title="Grid columns (auto = fit to width)">
          {GRID_COLS.map((c) => (
            <button
              key={c}
              className={gridCols === c ? 'on' : ''}
              onClick={() => setGridCols(c)}
              title={c === 'auto' ? 'Auto-fit columns to width' : `${c} column${c > 1 ? 's' : ''}`}
            >
              {c === 'auto' ? 'auto' : c}
            </button>
          ))}
        </div>
      )}
      <span className="stat hide-mobile">
        <b>{live}</b>/{agents.length} live
      </span>
      <span className="stat hide-mobile" title="total tokens across all agents">
        Σ ↑{fmtTokens(totIn)} ↓{fmtTokens(totOut)}
      </span>
      <span className="spacer" />
      {settings && (
        <span className="muted small hide-mobile">
          default {settings.defaultModel} · {settings.defaultMode}
        </span>
      )}
      <span className={`conn ${connected ? 'ok' : 'bad'}`} title={connected ? 'backend connected' : 'reconnecting…'}>
        {connected ? '● connected' : '○ offline'}
      </span>
      <button className="ghost" onClick={onProjects} title="Project manager — add folders of repos">
        ⊞ Projects
      </button>
      <button className="ghost" onClick={onWorktrees} title="Worktree manager">
        ⌗ Worktrees
      </button>
      <button className="ghost" onClick={onGitProfiles} title="Git profiles — identity & signing per agent">
        ⎇ Git
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
