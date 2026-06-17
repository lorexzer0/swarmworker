import { useEffect, useState } from 'react';
import { useApp } from '../store';
import { PERMISSION_MODES, type PermissionMode } from '../types';
import { addProject, getBranches, spawnAgent } from '../actions';
import { Modal } from './Modal';

export function SpawnDialog({ onClose }: { onClose: () => void }) {
  const { projects, settings, agents } = useApp();
  const [projectId, setProjectId] = useState(projects[0]?.id || '');
  const [branches, setBranches] = useState<string[]>([]);
  const [base, setBase] = useState('');
  const [branch, setBranch] = useState('');
  const [model, setModel] = useState(settings?.defaultModel || 'opus');
  const [mode, setMode] = useState<PermissionMode>(settings?.defaultMode || 'auto');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [inPlace, setInPlace] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setBranches([]);
      setBase('');
      return;
    }
    getBranches(projectId)
      .then((r) => {
        setBranches(r.branches);
        // Always reconcile base to a branch that actually exists, so the
        // selected value can never silently mismatch the rendered option.
        setBase((prev) => {
          if (prev && r.branches.includes(prev)) return prev;
          if (r.current && r.branches.includes(r.current)) return r.current;
          return r.branches[0] || r.current || '';
        });
      })
      .catch(() => setBranches([]));
  }, [projectId]);

  const onAddProject = async () => {
    setErr('');
    try {
      const p = await addProject(newPath.trim());
      setNewPath('');
      setProjectId(p.id);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const onSpawn = async () => {
    if (!projectId) {
      setErr('add and select a project first');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await spawnAgent({
        projectId,
        base,
        branch: branch.trim() || undefined,
        model,
        mode,
        name: name.trim() || undefined,
        initialPrompt: prompt.trim() || undefined,
        inPlace,
      });
      onClose();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };

  // Warn (don't block) when the selected checkout already has a live in-place
  // agent — a second one shares the same working files.
  const project = projects.find((p) => p.id === projectId);
  const inPlaceLive = inPlace && project
    ? agents.filter(
        (a) =>
          a.inPlace &&
          (a.status === 'running' || a.status === 'starting') &&
          a.repoPath === project.path,
      ).length
    : 0;

  return (
    <Modal title="New agent" onClose={onClose} wide>
      <div className="form">
        <label>
          <span>Project</span>
          <div className="row">
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {!projects.length && <option value="">— none registered —</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.path})
                </option>
              ))}
            </select>
          </div>
        </label>

        <label>
          <span>Add a project</span>
          <div className="row">
            <input
              placeholder="absolute path to a git repo, e.g. W:\Work\myproject"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && newPath.trim() && onAddProject()}
            />
            <button onClick={onAddProject} disabled={!newPath.trim()}>
              + add
            </button>
          </div>
        </label>

        <label className="checkbox-row">
          <input type="checkbox" checked={inPlace} onChange={(e) => setInPlace(e.target.checked)} />
          <span>
            Work in the repo directly (no worktree)
            <span className="muted small"> — runs on the repo's current branch; no separate worktree or branch is created.</span>
          </span>
        </label>

        {inPlaceLive > 0 && (
          <div className="warn">
            ⚠ {inPlaceLive} agent{inPlaceLive > 1 ? 's' : ''} already running in this checkout. A new one shares the same
            working files — fine for parallel research, risky for concurrent edits.
          </div>
        )}

        {!inPlace && (
          <div className="grid2">
            <label>
              <span>Base branch (worktree forks from here)</span>
              <select value={base} onChange={(e) => setBase(e.target.value)}>
                {branches.length === 0 && <option value="">{base || '—'}</option>}
                {base && !branches.includes(base) && <option value={base}>{base} (not found)</option>}
                {branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>New branch name (blank = auto)</span>
              <input placeholder={`swarm/${base || 'base'}-xxxxxxxx`} value={branch} onChange={(e) => setBranch(e.target.value)} />
            </label>
          </div>
        )}

        <div className="grid2">
          <label>
            <span>Model</span>
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="opus / sonnet / haiku / full id" />
          </label>
          <label>
            <span>Permission mode</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as PermissionMode)}>
              {PERMISSION_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                  {m === settings?.defaultMode ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          <span>Display name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="what this agent is doing" />
        </label>

        <label>
          <span>Initial prompt (optional — sent once the TUI is ready)</span>
          <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Leave blank to start an empty session and type later." />
        </label>

        {err && <div className="err">{err}</div>}

        <div className="form-actions">
          <button className="ghost" onClick={onClose}>
            cancel
          </button>
          <button className="primary" onClick={onSpawn} disabled={busy || !projectId}>
            {busy ? 'spawning…' : 'spawn agent'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
