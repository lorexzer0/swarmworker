import { useState } from 'react';
import { useApp } from '../store';
import { createProfile, updateProfile, deleteProfile, getGitIdentity, patchSettings } from '../actions';
import type { GitProfile, GitProfileDraft } from '../types';
import { Modal } from './Modal';

const EMPTY: GitProfileDraft = {
  label: '',
  userName: '',
  userEmail: '',
  gpgSign: false,
  signingKey: '',
  gpgFormat: 'openpgp',
};

export function GitProfilesManager({ onClose }: { onClose: () => void }) {
  const { profiles, settings } = useApp();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<GitProfileDraft>({ ...EMPTY });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setEditingId(null);
    setDraft({ ...EMPTY });
    setErr('');
  };

  const startEdit = (p: GitProfile) => {
    setEditingId(p.id);
    setDraft({
      label: p.label,
      userName: p.userName,
      userEmail: p.userEmail,
      gpgSign: p.gpgSign,
      signingKey: p.signingKey ?? '',
      gpgFormat: p.gpgFormat ?? 'openpgp',
    });
    setErr('');
  };

  const prefill = async () => {
    setErr('');
    try {
      const g = await getGitIdentity();
      setDraft((d) => ({
        ...d,
        userName: g.userName || d.userName,
        userEmail: g.userEmail || d.userEmail,
        gpgSign: g.gpgSign,
        signingKey: g.signingKey || d.signingKey,
        gpgFormat: g.gpgFormat,
      }));
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const save = async () => {
    if (!draft.userName.trim() || !draft.userEmail.trim()) {
      setErr('name and email are required');
      return;
    }
    setBusy(true);
    setErr('');
    const payload: GitProfileDraft = { ...draft, signingKey: draft.signingKey?.trim() || undefined };
    try {
      if (editingId) await updateProfile(editingId, payload);
      else await createProfile(payload);
      reset();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const del = async (id: string) => {
    if (!confirm('Delete this profile?')) return;
    setBusy(true);
    setErr('');
    try {
      await deleteProfile(id);
      if (editingId === id) reset();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleDefault = (id: string) => {
    const next = settings?.defaultProfileId === id ? '' : id;
    patchSettings({ defaultProfileId: next }).catch((e) => setErr(e.message));
  };

  return (
    <Modal title="Git profiles" onClose={onClose} wide>
      <div className="form">
        <div className="muted small">
          Each profile pins git identity + signing for an agent's commits — injected per process as environment, so it
          changes nothing on disk and two agents on the same repo can differ. Applies on an agent's next launch/resume.
        </div>

        <label>
          <span>Label</span>
          <input
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="e.g. Work (Adroit) — defaults to the name"
          />
        </label>
        <div className="grid2">
          <label>
            <span>user.name</span>
            <input value={draft.userName} onChange={(e) => setDraft({ ...draft, userName: e.target.value })} />
          </label>
          <label>
            <span>user.email</span>
            <input value={draft.userEmail} onChange={(e) => setDraft({ ...draft, userEmail: e.target.value })} />
          </label>
        </div>

        <label className="checkbox-row">
          <input type="checkbox" checked={draft.gpgSign} onChange={(e) => setDraft({ ...draft, gpgSign: e.target.checked })} />
          <span>Sign commits &amp; tags</span>
        </label>

        {draft.gpgSign && (
          <div className="grid2">
            <label>
              <span>Signing key</span>
              <input
                className="mono"
                value={draft.signingKey}
                onChange={(e) => setDraft({ ...draft, signingKey: e.target.value })}
                placeholder="GPG key id / fingerprint, or SSH key"
              />
            </label>
            <label>
              <span>Format</span>
              <select
                value={draft.gpgFormat}
                onChange={(e) => setDraft({ ...draft, gpgFormat: e.target.value as 'openpgp' | 'ssh' })}
              >
                <option value="openpgp">openpgp (GPG)</option>
                <option value="ssh">ssh</option>
              </select>
            </label>
          </div>
        )}

        {err && <div className="err">{err}</div>}

        <div className="form-actions">
          <button className="ghost" onClick={prefill} disabled={busy} title="Read this machine's global git config">
            prefill from global git
          </button>
          <span className="spacer" />
          {editingId && (
            <button className="ghost" onClick={reset} disabled={busy}>
              cancel edit
            </button>
          )}
          <button className="primary" onClick={save} disabled={busy}>
            {editingId ? 'save changes' : '+ add profile'}
          </button>
        </div>

        <div className="divider" />
        <span className="muted small">Profiles</span>
        <div className="proj-list">
          {!profiles.length && <div className="muted small">none yet — add one above</div>}
          {profiles.map((p) => (
            <div className="proj-row" key={p.id}>
              <b>{p.label}</b>
              {settings?.defaultProfileId === p.id && <span className="chip">default</span>}
              {p.gpgSign && (
                <span
                  className="chip mode-acceptEdits"
                  title={`signs (${p.gpgFormat ?? 'openpgp'})${p.signingKey ? ' · ' + p.signingKey : ''}`}
                >
                  signed
                </span>
              )}
              <span className="muted small mono">
                {p.userName} &lt;{p.userEmail}&gt;
              </span>
              <span className="spacer" />
              <button className="act" onClick={() => toggleDefault(p.id)} title="Default for new agents">
                {settings?.defaultProfileId === p.id ? '★' : '☆'}
              </button>
              <button className="act" onClick={() => startEdit(p)} title="Edit">
                edit
              </button>
              <button className="act del" onClick={() => del(p.id)} title="Delete profile">
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
