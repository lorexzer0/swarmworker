import { useEffect, useState } from 'react';
import type { WorktreeRow } from '../types';
import { listWorktrees, openWorktree, deleteWorktree } from '../actions';
import { STATUS_COLOR, STATUS_LABEL } from '../util';
import { Modal } from './Modal';

export function WorktreesDialog({
  onClose,
  onOpenAgent,
}: {
  onClose: () => void;
  onOpenAgent: (agentId: string) => void;
}) {
  const [rows, setRows] = useState<WorktreeRow[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    setErr('');
    listWorktrees()
      .then((r) => setRows(r.worktrees))
      .catch((e) => setErr(e.message));
  };
  useEffect(load, []);

  const doOpen = async (w: WorktreeRow) => {
    setBusy(w.path);
    setErr('');
    try {
      const meta = await openWorktree({ projectId: w.projectId, worktreePath: w.path, branch: w.branch });
      onOpenAgent(meta.id);
    } catch (e: any) {
      setErr(e.message);
      setBusy(null);
    }
  };

  const doDelete = async (w: WorktreeRow) => {
    const warn = w.dirtyFiles ? `\n\n⚠ ${w.dirtyFiles} uncommitted change(s) will be lost.` : '';
    if (!confirm(`Delete this worktree?\n\n${w.path}${warn}`)) return;
    let deleteBranch = false;
    if (w.branch) {
      deleteBranch = confirm(
        `Also delete branch "${w.branch}"?\n\nOK = delete the branch too (unmerged work is lost).\nCancel = keep the branch.`,
      );
    }
    setBusy(w.path);
    setErr('');
    try {
      await deleteWorktree({ projectId: w.projectId, worktreePath: w.path, branch: w.branch, deleteBranch });
      load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  // group rows by project for display
  const groups = new Map<string, WorktreeRow[]>();
  for (const w of rows ?? []) {
    const arr = groups.get(w.projectName) ?? [];
    arr.push(w);
    groups.set(w.projectName, arr);
  }

  return (
    <Modal title="Worktrees" onClose={onClose} wide>
      <div className="wt-toolbar">
        <span className="muted small">
          {rows ? `${rows.length} worktree(s) across ${groups.size} project(s)` : 'loading…'}
        </span>
        <span className="spacer" />
        <button onClick={load}>↻ refresh</button>
      </div>
      {err && <div className="err">{err}</div>}

      {rows && rows.length === 0 && <div className="muted small">No worktrees. Register a project and spawn an agent.</div>}

      {[...groups.entries()].map(([proj, items]) => (
        <div className="wt-group" key={proj}>
          <div className="wt-group-head">{proj}</div>
          {items.map((w) => (
            <WorktreeItem
              key={w.path}
              w={w}
              busy={busy === w.path}
              onOpen={() => doOpen(w)}
              onDelete={() => doDelete(w)}
            />
          ))}
        </div>
      ))}
    </Modal>
  );
}

function WorktreeItem({
  w,
  busy,
  onOpen,
  onDelete,
}: {
  w: WorktreeRow;
  busy: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const openLabel = w.agent
    ? w.agent.status === 'running' || w.agent.status === 'starting'
      ? 'open'
      : 'resume'
    : 'start agent';

  return (
    <div className={`wt-row ${w.isMain ? 'main' : ''}`}>
      <div className="wt-main">
        <span className="wt-branch mono">
          {w.branch || `detached @ ${w.head}`}
          {w.isMain && <span className="chip" style={{ marginLeft: 6 }}>repo root</span>}
          {w.locked && <span className="chip" style={{ marginLeft: 6 }}>locked</span>}
          {w.prunable && <span className="chip" style={{ marginLeft: 6 }}>missing</span>}
        </span>
        <span className="wt-path muted small mono">{w.path}</span>
      </div>

      <div className="wt-stats small">
        {w.agent && (
          <span className="wt-agent" title={`agent ${w.agent.name}`}>
            <span className="dot" style={{ background: STATUS_COLOR[w.agent.status] }} />
            {STATUS_LABEL[w.agent.status]}
          </span>
        )}
        {w.dirtyFiles > 0 && <span className="wt-dirty" title="uncommitted files">● {w.dirtyFiles} dirty</span>}
        {w.commitsAhead > 0 && <span className="muted" title="commits ahead of default branch">↑{w.commitsAhead}</span>}
        <span className="muted">{w.head}</span>
      </div>

      <div className="wt-actions">
        {w.isMain ? (
          <span className="muted small">—</span>
        ) : (
          <>
            <button className="act go" disabled={busy} onClick={onOpen} title="Continue working in this worktree">
              {busy ? '…' : `▶ ${openLabel}`}
            </button>
            <button className="act del" disabled={busy} onClick={onDelete} title="Delete worktree">
              ✕ delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}
