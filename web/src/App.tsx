import { useEffect, useState } from 'react';
import { connect } from './ws';
import { terminals } from './terminals';
import { TopBar } from './components/TopBar';
import { GridView } from './components/GridView';
import { ListView } from './components/ListView';
import { SpawnDialog } from './components/SpawnDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { WorktreesDialog } from './components/WorktreesDialog';
import { ProjectManager } from './components/ProjectManager';
import { GitProfilesManager } from './components/GitProfilesManager';
import type { GridCols } from './types';

let started = false;

const GRIDCOLS_KEY = 'sw.gridCols';
function loadGridCols(): GridCols {
  try {
    const v = localStorage.getItem(GRIDCOLS_KEY);
    if (v === '1' || v === '2' || v === '3' || v === '4') return Number(v) as GridCols;
  } catch {
    /* storage unavailable */
  }
  return 'auto';
}

export function App() {
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [gridCols, setGridCols] = useState<GridCols>(loadGridCols);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [worktreesOpen, setWorktreesOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [gitProfilesOpen, setGitProfilesOpen] = useState(false);
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

  useEffect(() => {
    try {
      localStorage.setItem(GRIDCOLS_KEY, String(gridCols));
    } catch {
      /* storage unavailable */
    }
  }, [gridCols]);

  return (
    <div className="app">
      <TopBar
        view={view}
        setView={setView}
        gridCols={gridCols}
        setGridCols={setGridCols}
        onNew={() => setSpawnOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onWorktrees={() => setWorktreesOpen(true)}
        onProjects={() => setProjectsOpen(true)}
        onGitProfiles={() => setGitProfilesOpen(true)}
      />
      <main className="main">
        {view === 'grid' ? (
          <GridView cols={gridCols} onNew={() => setSpawnOpen(true)} focusId={focusId} onFocused={() => setFocusId(null)} />
        ) : (
          <ListView onNew={() => setSpawnOpen(true)} />
        )}
      </main>
      {spawnOpen && (
        <SpawnDialog
          onClose={() => setSpawnOpen(false)}
          onManageProjects={() => {
            setSpawnOpen(false);
            setProjectsOpen(true);
          }}
        />
      )}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {worktreesOpen && <WorktreesDialog onClose={() => setWorktreesOpen(false)} onOpenAgent={openAgent} />}
      {projectsOpen && <ProjectManager onClose={() => setProjectsOpen(false)} />}
      {gitProfilesOpen && <GitProfilesManager onClose={() => setGitProfilesOpen(false)} />}
    </div>
  );
}
