import { useEffect, useState } from 'react';
import { connect } from './ws';
import { terminals } from './terminals';
import { TopBar } from './components/TopBar';
import { GridView } from './components/GridView';
import { ListView } from './components/ListView';
import { SpawnDialog } from './components/SpawnDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { WorktreesDialog } from './components/WorktreesDialog';

let started = false;

export function App() {
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [worktreesOpen, setWorktreesOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);

  const openAgent = (id: string) => {
    setWorktreesOpen(false);
    setView('grid');
    setFocusId(id);
  };

  useEffect(() => {
    if (!started) {
      started = true;
      connect();
    }
    const onResize = () => terminals.fitAll();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Refit terminals shortly after switching views.
  useEffect(() => {
    const t = setTimeout(() => terminals.fitAll(), 60);
    return () => clearTimeout(t);
  }, [view]);

  return (
    <div className="app">
      <TopBar
        view={view}
        setView={setView}
        onNew={() => setSpawnOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onWorktrees={() => setWorktreesOpen(true)}
      />
      <main className="main">
        {view === 'grid' ? (
          <GridView onNew={() => setSpawnOpen(true)} focusId={focusId} onFocused={() => setFocusId(null)} />
        ) : (
          <ListView onNew={() => setSpawnOpen(true)} />
        )}
      </main>
      {spawnOpen && <SpawnDialog onClose={() => setSpawnOpen(false)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {worktreesOpen && <WorktreesDialog onClose={() => setWorktreesOpen(false)} onOpenAgent={openAgent} />}
    </div>
  );
}
