// HTTP (REST) + WebSocket server. REST manages projects/agents/settings; the
// WebSocket multiplexes live PTY I/O, token updates, and status for all agents.
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';

import { Store } from './store.js';
import { AgentManager } from './agentManager.js';
import {
  isGitRepo,
  repoToplevel,
  currentBranch,
  listBranches,
  listProjectWorktrees,
  worktreeDiffStat,
  scanReposUnder,
  globalGitIdentity,
} from './worktrees.js';
import { countSessions, listSessions } from './tokens.js';
import type { DiscoveredRepo, GitProfile, Project, ProjectRoot } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;

const store = new Store();
const manager = new AgentManager(store);

const app = express();
app.use(express.json());

// ---- REST ----------------------------------------------------------------

app.get('/api/state', (_req, res) => {
  res.json({
    projects: store.state.projects,
    roots: store.state.roots,
    profiles: store.state.profiles,
    agents: manager.list(),
    settings: store.state.settings,
  });
});

/** Find-or-create a registered Project for a repo path. Idempotent. */
async function ensureProject(rawPath: string): Promise<Project> {
  const raw = String(rawPath || '').trim();
  if (!raw) throw new Error('path required');
  const normalized = path.normalize(raw);
  if (!fs.existsSync(normalized)) throw new Error('path does not exist');
  if (!(await isGitRepo(normalized))) throw new Error('not a git repository');
  const top = await repoToplevel(normalized);
  const existing = store.state.projects.find((p) => p.path === top);
  if (existing) return existing;
  const project: Project = {
    id: randomUUID().slice(0, 8),
    name: path.basename(top),
    path: top,
    defaultBranch: await currentBranch(top),
    addedAt: Date.now(),
  };
  store.state.projects.push(project);
  store.save();
  broadcastState();
  return project;
}

app.post('/api/projects', async (req, res) => {
  try {
    res.json(await ensureProject(String(req.body?.path || '')));
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

// ---- project roots (holding folders scanned for repos) ------------------

app.get('/api/roots', (_req, res) => res.json({ roots: store.state.roots }));

app.post('/api/roots', (req, res) => {
  const raw = String(req.body?.path || '').trim();
  if (!raw) return res.status(400).json({ error: 'path required' });
  const normalized = path.normalize(raw);
  if (!fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
    return res.status(400).json({ error: 'folder does not exist' });
  }
  if (store.state.roots.some((r) => path.normalize(r.path) === normalized)) {
    return res.status(409).json({ error: 'folder already added' });
  }
  const root: ProjectRoot = { id: randomUUID().slice(0, 8), path: normalized, addedAt: Date.now() };
  store.state.roots.push(root);
  store.save();
  broadcastState();
  res.json(root);
});

app.delete('/api/roots/:id', (req, res) => {
  store.state.roots = store.state.roots.filter((r) => r.id !== req.params.id);
  store.save();
  broadcastState();
  res.json({ ok: true });
});

// Repos discovered under all roots, merged with standalone registered projects.
app.get('/api/repos', async (_req, res) => {
  const byPath = new Map(store.state.projects.map((p) => [path.normalize(p.path), p]));
  const out = new Map<string, DiscoveredRepo>();
  for (const root of store.state.roots) {
    let repos: string[] = [];
    try {
      repos = await scanReposUnder(root.path);
    } catch {
      /* skip unreadable root */
    }
    for (const rp of repos) {
      const norm = path.normalize(rp);
      if (out.has(norm)) continue;
      const proj = byPath.get(norm);
      out.set(norm, { path: rp, name: path.basename(rp), registered: !!proj, projectId: proj?.id, rootId: root.id });
    }
  }
  for (const p of store.state.projects) {
    const norm = path.normalize(p.path);
    if (!out.has(norm)) out.set(norm, { path: p.path, name: p.name, registered: true, projectId: p.id });
  }
  const repos = [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  res.json({ repos });
});

// Branches for an arbitrary repo path (used by the spawn picker).
app.get('/api/repos/branches', async (req, res) => {
  const p = String(req.query.path || '');
  if (!p) return res.status(400).json({ error: 'path required' });
  try {
    if (!(await isGitRepo(p))) return res.status(400).json({ error: 'not a git repository' });
    res.json({ branches: await listBranches(p), current: await currentBranch(p) });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- git profiles (identity + signing, assignable per agent) ------------

function sanitizeProfile(body: any, id: string): GitProfile {
  const userName = String(body?.userName ?? '').trim();
  const userEmail = String(body?.userEmail ?? '').trim();
  if (!userName || !userEmail) throw new Error('name and email are required');
  const gpgFormat = body?.gpgFormat === 'ssh' ? 'ssh' : 'openpgp';
  return {
    id,
    label: String(body?.label ?? '').trim() || userName,
    userName,
    userEmail,
    gpgSign: !!body?.gpgSign,
    signingKey: String(body?.signingKey ?? '').trim() || undefined,
    gpgFormat,
  };
}

app.post('/api/profiles', (req, res) => {
  try {
    const profile = sanitizeProfile(req.body, randomUUID().slice(0, 8));
    store.state.profiles.push(profile);
    store.save();
    broadcastState();
    res.json(profile);
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

app.put('/api/profiles/:id', (req, res) => {
  const idx = store.state.profiles.findIndex((p) => p.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'unknown profile' });
  try {
    store.state.profiles[idx] = sanitizeProfile(req.body, req.params.id);
    store.save();
    broadcastState();
    res.json(store.state.profiles[idx]);
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

app.delete('/api/profiles/:id', (req, res) => {
  store.state.profiles = store.state.profiles.filter((p) => p.id !== req.params.id);
  if (store.state.settings.defaultProfileId === req.params.id) {
    store.updateSettings({ defaultProfileId: undefined });
  }
  store.save();
  broadcastState();
  res.json({ ok: true });
});

// The machine's global git identity — seeds the "new profile" form.
app.get('/api/git/identity', async (_req, res) => {
  try {
    res.json(await globalGitIdentity());
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.delete('/api/projects/:id', (req, res) => {
  store.state.projects = store.state.projects.filter((p) => p.id !== req.params.id);
  store.save();
  broadcastState();
  res.json({ ok: true });
});

app.get('/api/projects/:id/branches', async (req, res) => {
  const project = store.state.projects.find((p) => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });
  try {
    const branches = await listBranches(project.path);
    // Report the LIVE current branch, and refresh the stored default if it
    // drifted (e.g. registered while the repo had no commits yet).
    const current = await currentBranch(project.path);
    if (current && project.defaultBranch !== current) {
      project.defaultBranch = current;
      store.save();
    }
    res.json({ branches, current });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/agents', async (req, res) => {
  try {
    // Accept a registered projectId, or a raw repoPath we find-or-create.
    let projectId = req.body?.projectId ? String(req.body.projectId) : '';
    if (!projectId && req.body?.repoPath) {
      projectId = (await ensureProject(String(req.body.repoPath))).id;
    }
    const meta = await manager.spawn({
      projectId,
      base: req.body?.base,
      branch: req.body?.branch,
      model: req.body?.model,
      mode: req.body?.mode,
      name: req.body?.name,
      initialPrompt: req.body?.initialPrompt,
      inPlace: !!req.body?.inPlace,
      profileId: req.body?.profileId || undefined,
    });
    res.json(meta);
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

app.post('/api/agents/:id/stop', async (req, res) => {
  await manager.stop(req.params.id);
  res.json({ ok: true });
});

app.post('/api/agents/:id/resume', (req, res) => {
  try {
    res.json(manager.resume(req.params.id));
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

app.post('/api/agents/:id/mode/cycle', (req, res) => {
  manager.cycleMode(req.params.id);
  res.json({ ok: true });
});

app.patch('/api/agents/:id/profile', (req, res) => {
  const meta = manager.setProfile(req.params.id, req.body?.profileId ?? null);
  if (!meta) return res.status(404).json({ error: 'unknown agent' });
  res.json(meta);
});

app.delete('/api/agents/:id', async (req, res) => {
  await manager.remove(req.params.id, req.query.worktree === 'true');
  res.json({ ok: true });
});

app.get('/api/agents/:id/diff', async (req, res) => {
  const meta = manager.list().find((a) => a.id === req.params.id);
  if (!meta) return res.status(404).json({ error: 'not found' });
  res.json(await worktreeDiffStat(meta.worktreePath, meta.baseBranch));
});

app.get('/api/worktrees', async (_req, res) => {
  const out: unknown[] = [];
  for (const project of store.state.projects) {
    try {
      const wts = await listProjectWorktrees(project.path, project.defaultBranch);
      for (const w of wts) {
        const agent = manager.findByWorktree(w.path);
        out.push({
          projectId: project.id,
          projectName: project.name,
          ...w,
          discussions: countSessions(w.path),
          liveAgents: manager.liveAgentCount(w.path),
          agent: agent
            ? { id: agent.id, status: agent.status, model: agent.model, mode: agent.mode, name: agent.name }
            : null,
        });
      }
    } catch {
      /* skip unreadable project */
    }
  }
  res.json({ worktrees: out });
});

// Discussions (prior Claude conversations) recorded for a worktree's cwd.
app.get('/api/worktrees/discussions', (req, res) => {
  const p = String(req.query.path || '');
  if (!p) return res.status(400).json({ error: 'path required' });
  res.json({ discussions: listSessions(p) });
});

app.post('/api/worktrees/open', async (req, res) => {
  try {
    const meta = await manager.openWorktree({
      projectId: String(req.body?.projectId),
      worktreePath: String(req.body?.worktreePath),
      branch: req.body?.branch ?? null,
      sessionId: req.body?.sessionId || undefined,
      fresh: !!req.body?.fresh,
    });
    res.json(meta);
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

app.delete('/api/worktrees', async (req, res) => {
  try {
    await manager.deleteWorktree(
      String(req.body?.projectId),
      String(req.body?.worktreePath),
      req.body?.branch ?? null,
      !!req.body?.deleteBranch,
    );
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

app.patch('/api/settings', (req, res) => {
  const s = store.updateSettings(req.body || {});
  broadcastState();
  res.json(s);
});

// ---- static SPA (production build) --------------------------------------
const webDist = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

// ---- WebSocket -----------------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set<WebSocket>();

function send(ws: WebSocket, msg: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function broadcast(msg: unknown): void {
  const s = JSON.stringify(msg);
  for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(s);
}
function broadcastState(): void {
  broadcast({
    t: 'state',
    projects: store.state.projects,
    roots: store.state.roots,
    profiles: store.state.profiles,
    agents: manager.list(),
    settings: store.state.settings,
  });
}

manager.on('pty', (agentId: string, data: string) => broadcast({ t: 'pty', agentId, data }));
manager.on('tokens', (agentId: string, usage) => broadcast({ t: 'tokens', agentId, usage }));
manager.on('update', () => broadcastState());
manager.on('removed', (agentId: string) => broadcast({ t: 'removed', agentId }));

wss.on('connection', (ws) => {
  clients.add(ws);
  send(ws, {
    t: 'state',
    projects: store.state.projects,
    roots: store.state.roots,
    profiles: store.state.profiles,
    agents: manager.list(),
    settings: store.state.settings,
  });

  ws.on('message', (raw) => {
    let m: any;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (m.t) {
      case 'attach':
        send(ws, { t: 'replay', agentId: m.agentId, data: manager.getReplay(m.agentId) });
        break;
      case 'input':
        manager.input(m.agentId, m.data);
        break;
      case 'resize':
        manager.resize(m.agentId, m.cols, m.rows);
        break;
      case 'cycleMode':
        manager.cycleMode(m.agentId);
        break;
    }
  });

  ws.on('close', () => clients.delete(ws));
});

server.listen(PORT, () => {
  console.log(`[swarmworker] http+ws on http://localhost:${PORT}`);
  if (!fs.existsSync(webDist)) {
    console.log('[swarmworker] (dev) run the web workspace separately: npm run dev');
  }
});

function shutdown() {
  console.log('\n[swarmworker] shutting down…');
  manager.shutdown();
  server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
