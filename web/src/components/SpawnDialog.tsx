import { useEffect, useState } from 'react';
import { useApp } from '../store';
import { PERMISSION_MODES, type DiscoveredRepo, type PermissionMode } from '../types';
import { getBranchesByPath, listRepos, spawnAgent } from '../actions';
import { Modal } from './Modal';
import { SearchableSelect } from './SearchableSelect';

export function SpawnDialog({ onClose, onManageProjects }: { onClose: () => void; onManageProjects: () => void }) {
  const { settings, agents } = useApp();
  const [repos, setRepos] = useState<DiscoveredRepo[] | null>(null);
  const [repoPath, setRepoPath] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [base, setBase] = useState('');
  const [branch, setBranch] = useState('');
  const [model, setModel] = useState(settings?.defaultModel || 'opus');
  const [mode, setMode] = useState<PermissionMode>(settings?.defaultMode || 'auto');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [inPlace, setInPlace] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listRepos()
      .then((r) => setRepos(r.repos))
      .catch((e) => setErr(e.message));
  }, []);

  // Load the chosen repo's branches by path and pick a sensible default base.
  useEffect(() => {
    if (!repoPath) {
      setBranches([]);
      setBase('');
      return;
    }
    getBranchesByPath(repoPath)
      .then((r) => {
        setBranches(r.branches);
        setBase((prev) => {
          if (prev && r.branches.includes(prev)) return prev;
          if (r.current && r.branches.includes(r.current)) return r.current;
          return r.branches[0] || r.current || '';
        });
      })
      .catch(() => setBranches([]));
  }, [repoPath]);

  const onSpawn = async () => {
    if (!repoPath) {
      setErr('pick a repository first');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await spawnAgent({
        repoPath,
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

  const repoOptions =
    repos?.map((r) => ({
      value: r.path,
      label: r.name,
      sub: r.path,
      tag: r.registered ? 'used' : undefined,
    })) ?? [];

  // Warn (don't block) when this checkout already has a live in-place agent.
  const inPlaceLive = inPlace && repoPath
    ? agents.filter(
        (a) => a.inPlace && (a.status === 'running' || a.status === 'starting') && a.repoPath === repoPath,
      ).length
    : 0;

  // Non-blocking base-branch validation: only flag a base we know isn't here.
  const baseUnknown =
    !inPlace && base.trim() !== '' && branches.length > 0 && !branches.includes(base.trim());

  return (
    <Modal title="New agent" onClose={onClose} wide>
      <div className="form">
        <label>
          <span>
            Repository
            <button type="button" className="linkish" onClick={onManageProjects}>
              manage folders…
            </button>
          </span>
          {repos && repos.length === 0 ? (
            <div className="muted small">
              No repos found. Add a project folder in the{' '}
              <button type="button" className="linkish" onClick={onManageProjects}>
                Project manager
              </button>
              .
            </div>
          ) : (
            <SearchableSelect
              options={repoOptions}
              value={repoPath}
              onChange={setRepoPath}
              placeholder={repos ? 'search repos by name or path…' : 'loading repos…'}
              emptyText="no matching repo"
            />
          )}
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
          <>
            <div className="grid2">
              <label>
                <span>Base branch (worktree forks from here)</span>
                <input
                  list="sw-base-branches"
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                  placeholder="branch or commit to fork from"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                />
                <datalist id="sw-base-branches">
                  {branches.map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              </label>
              <label>
                <span>New branch name (blank = auto)</span>
                <input placeholder={`swarm/${base || 'base'}-xxxxxxxx`} value={branch} onChange={(e) => setBranch(e.target.value)} />
              </label>
            </div>
            {baseUnknown && (
              <div className="warn">
                ⚠ "{base.trim()}" isn't an existing branch in this repo. Spawning works only if it's a valid branch or commit
                to fork from — otherwise it'll fail.
              </div>
            )}
          </>
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
          <button className="primary" onClick={onSpawn} disabled={busy || !repoPath}>
            {busy ? 'spawning…' : 'spawn agent'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
