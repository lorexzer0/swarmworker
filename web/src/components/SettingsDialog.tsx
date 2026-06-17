import { useState } from 'react';
import { useApp } from '../store';
import { PERMISSION_MODES, type PermissionMode } from '../types';
import { patchSettings, removeProject } from '../actions';
import { Modal } from './Modal';

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { settings, projects } = useApp();
  const [model, setModel] = useState(settings?.defaultModel || 'opus');
  const [mode, setMode] = useState<PermissionMode>(settings?.defaultMode || 'auto');
  const [cap, setCap] = useState(settings?.concurrencyCap ?? 6);
  const [worktreeRoot, setWorktreeRoot] = useState(settings?.worktreeRoot || '');
  const [saved, setSaved] = useState(false);

  const save = async () => {
    await patchSettings({
      defaultModel: model,
      defaultMode: mode,
      concurrencyCap: Number(cap),
      worktreeRoot: worktreeRoot.trim() || undefined,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="form">
        <div className="grid2">
          <label>
            <span>Default model</span>
            <input value={model} onChange={(e) => setModel(e.target.value)} />
          </label>
          <label>
            <span>Default permission mode</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as PermissionMode)}>
              {PERMISSION_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          <span>Concurrency cap (max simultaneously running agents)</span>
          <input type="number" min={1} max={32} value={cap} onChange={(e) => setCap(Number(e.target.value))} />
        </label>
        <label>
          <span>Worktree root (put this on a fast drive — applies to new agents)</span>
          <input
            className="mono"
            value={worktreeRoot}
            onChange={(e) => setWorktreeRoot(e.target.value)}
            placeholder="W:\swarmworker-worktrees"
          />
        </label>

        <div className="form-actions">
          <span className="muted small">{saved ? 'saved ✓' : ''}</span>
          <button className="primary" onClick={save}>
            save
          </button>
        </div>

        <div className="divider" />
        <span className="muted small">Registered projects</span>
        <div className="proj-list">
          {!projects.length && <div className="muted small">none yet — add one when spawning an agent</div>}
          {projects.map((p) => (
            <div className="proj-row" key={p.id}>
              <b>{p.name}</b>
              <span className="muted small mono">{p.path}</span>
              <span className="spacer" />
              <button
                className="act del"
                title="Unregister (does not delete files)"
                onClick={() => removeProject(p.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
