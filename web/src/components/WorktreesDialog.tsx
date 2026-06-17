import { useEffect, useState } from 'react';
import type { Discussion, WorktreeRow } from '../types';
import { listWorktrees, openWorktree, deleteWorktree, listDiscussions } from '../actions';
import { STATUS_COLOR, STATUS_LABEL, fmtAgo } from '../util';
import { Modal } from './Modal';

type OpenOpts = { sessionId?: string; fresh?: boolean };

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

  const doOpen = async (w: WorktreeRow, opts?: OpenOpts) => {
    setBusy(w.path);
    setErr('');
    try {
      const meta = await openWorktree({ projectId: w.projectId, worktreePath: w.path, branch: w.branch, ...opts });
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
              onOpen={(opts) => doOpen(w, opts)}
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
  onOpen: (opts?: OpenOpts) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const running = w.agent?.status === 'running' || w.agent?.status === 'starting';

  // Primary action: focus/resume a bound agent, else continue the latest
  // discussion, else start the first one.
  const openLabel = w.agent
    ? running
      ? 'open'
      : 'resume'
    : w.discussions > 0
      ? 'resume latest'
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
        {w.discussions > 0 && (
          <button
            className="wt-disc-toggle"
            onClick={() => setExpanded((v) => !v)}
            title="Prior Claude conversations here — click to pick one"
          >
            {expanded ? '▾' : '▸'} 💬 {w.discussions}
          </button>
        )}
        {w.dirtyFiles > 0 && <span className="wt-dirty" title="uncommitted files">● {w.dirtyFiles} dirty</span>}
        {w.commitsAhead > 0 && <span className="muted" title="commits ahead of default branch">↑{w.commitsAhead}</span>}
        <span className="muted">{w.head}</span>
      </div>

      <div className="wt-actions">
        <button
          className="act go"
          disabled={busy}
          onClick={() => onOpen()}
          title={w.isMain ? 'Work directly in the repo checkout (no worktree)' : 'Continue working in this worktree'}
        >
          {busy ? '…' : `▶ ${openLabel}`}
        </button>
        {!running && w.discussions > 0 && (
          <button className="act" disabled={busy} onClick={() => onOpen({ fresh: true })} title="Start a new conversation here">
            ＋ new
          </button>
        )}
        {w.isMain ? (
          <span className="muted small" title="the repo's main checkout is never deleted">—</span>
        ) : (
          <button className="act del" disabled={busy} onClick={onDelete} title="Delete worktree">
            ✕ delete
          </button>
        )}
      </div>

      {expanded && (
        <DiscussionList
          worktreePath={w.path}
          disabled={busy || running}
          onResume={(sessionId) => onOpen({ sessionId })}
        />
      )}
    </div>
  );
}

function DiscussionList({
  worktreePath,
  disabled,
  onResume,
}: {
  worktreePath: string;
  disabled: boolean;
  onResume: (sessionId: string) => void;
}) {
  const [items, setItems] = useState<Discussion[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    listDiscussions(worktreePath)
      .then((r) => setItems(r.discussions))
      .catch((e) => setErr(e.message));
  }, [worktreePath]);

  if (err) return <div className="wt-discussions err small">{err}</div>;
  if (!items) return <div className="wt-discussions muted small">loading discussions…</div>;
  if (!items.length) return <div className="wt-discussions muted small">no recorded discussions</div>;

  return (
    <div className="wt-discussions">
      {items.map((d) => (
        <button
          key={d.sessionId}
          className="wt-disc"
          disabled={disabled}
          onClick={() => onResume(d.sessionId)}
          title={disabled ? 'stop the running agent to switch discussions' : 'Resume this conversation'}
        >
          <span className="wt-disc-title">{d.title || d.preview || `session ${d.sessionId.slice(0, 8)}`}</span>
          <span className="wt-disc-meta muted">{fmtAgo(d.updatedAt)}</span>
        </button>
      ))}
    </div>
  );
}
