import { useEffect, useState } from 'react';
import { useApp } from '../store';
import { addRoot, removeRoot, listRepos } from '../actions';
import type { DiscoveredRepo } from '../types';
import { Modal } from './Modal';

export function ProjectManager({ onClose }: { onClose: () => void }) {
  const { roots } = useApp();
  const [repos, setRepos] = useState<DiscoveredRepo[] | null>(null);
  const [newPath, setNewPath] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const scan = () => {
    setRepos(null);
    setErr('');
    listRepos()
      .then((r) => setRepos(r.repos))
      .catch((e) => setErr(e.message));
  };
  useEffect(scan, []);

  const add = async () => {
    const p = newPath.trim();
    if (!p) return;
    setErr('');
    setBusy(true);
    try {
      await addRoot(p);
      setNewPath('');
      scan();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const del = async (id: string) => {
    setErr('');
    setBusy(true);
    try {
      await removeRoot(id);
      scan();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const reposByRoot = (rootId: string) => (repos ?? []).filter((r) => r.rootId === rootId);
  const standalone = (repos ?? []).filter((r) => !r.rootId);

  return (
    <Modal title="Project manager" onClose={onClose} wide>
      <div className="form">
        <label>
          <span>Add a project folder (holds many repos) — or a single repo path</span>
          <div className="row">
            <input
              className="mono"
              placeholder="absolute path, e.g. W:\Projects"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <button onClick={add} disabled={busy || !newPath.trim()}>
              + add folder
            </button>
          </div>
        </label>

        {err && <div className="err">{err}</div>}

        <div className="wt-toolbar">
          <span className="muted small">
            {repos ? `${repos.length} repo(s) across ${roots.length} folder(s)` : 'scanning…'}
          </span>
          <span className="spacer" />
          <button onClick={scan} disabled={busy}>
            ↻ rescan
          </button>
        </div>

        {roots.length === 0 && (
          <div className="muted small">No folders yet. Add one above to discover the repos inside it.</div>
        )}

        {roots.map((root) => {
          const items = reposByRoot(root.id);
          return (
            <div className="wt-group" key={root.id}>
              <div className="pm-root-head">
                <span className="mono">{root.path}</span>
                <span className="muted small">{items.length} repo(s)</span>
                <span className="spacer" />
                <button
                  className="act del"
                  title="Remove folder (does not delete files)"
                  disabled={busy}
                  onClick={() => del(root.id)}
                >
                  ✕ remove
                </button>
              </div>
              {repos && items.length === 0 && <div className="muted small">no git repos found here</div>}
              {items.map((r) => (
                <div className="proj-row" key={r.path}>
                  <b>{r.name}</b>
                  {r.registered && <span className="chip">used</span>}
                  <span className="spacer" />
                  <span className="muted small mono">{r.path}</span>
                </div>
              ))}
            </div>
          );
        })}

        {standalone.length > 0 && (
          <div className="wt-group">
            <div className="pm-root-head">
              <span className="muted small">Other registered repos</span>
            </div>
            {standalone.map((r) => (
              <div className="proj-row" key={r.path}>
                <b>{r.name}</b>
                {r.registered && <span className="chip">used</span>}
                <span className="spacer" />
                <span className="muted small mono">{r.path}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
