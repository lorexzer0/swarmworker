# swarmworker

A local control room for a swarm of **Claude Code** agents, each isolated in its
own **git worktree**, all on your machine, all driven by the real interactive
`claude` TUI mirrored into the browser.

- **Two views.** A *list* with per-agent project / branch / model / mode and live
  input/output/cache token counts, and a *security-camera grid* of live terminals.
- **Real terminals.** Each agent is an interactive `claude` session running in a
  pseudo-terminal (ConPTY on Windows), mirrored 1:1 into an xterm.js pane. You
  type to it exactly as if you were in that Claude Code session.
- **No "done" signal.** Agents run until *you* stop them. Stopping keeps the
  branch & worktree on disk.
- **Swappable permission mode**, default **auto**. Set per-agent at spawn, change
  the global default in Settings, or cycle a running agent's mode live
  (Shift+Tab in the TUI, or the ⇄ button).

## Requirements

- Node 18+ (built on Node 22), npm
- git 2.30+
- The `claude` CLI installed and logged in (`claude auth`). A Max/Pro
  subscription is used via the normal OAuth login — no API key needed.

## Install & run

```bash
npm install

# Production-style: build the SPA and serve everything from one Node process
npm run build
npm start                      # -> http://localhost:8787

# Dev (hot-reload SPA + server, Vite proxies /api and /ws to :8787)
npm run dev                    # -> http://localhost:5173
```

Then: **+ New agent** → paste a git repo path → **+ add** → pick a base branch →
spawn. Worktrees are created automatically; you never touch the repo's main
checkout.

## How it works

```
browser SPA (React + xterm.js)
   │  WebSocket  (pty bytes, resize, input, token/status events)
   ▼
Node server (Express + ws)
   ├─ AgentManager — one persistent `claude` PTY per worktree
   │     • spawns claude.exe in a ConPTY, cwd = the worktree
   │     • strips inherited CLAUDE_CODE_* env so each agent is a clean session
   │     • pre-seeds workspace trust in ~/.claude.json (no trust dialog stall)
   ├─ TranscriptWatcher — tails ~/.claude/projects/<enc>/<session>.jsonl
   │     • exact input/output/cache tokens per turn (the TUI emits none)
   └─ worktrees — `git worktree add` off a base branch, branch `swarm/<base>-<id>`
```

Key implementation notes:

- **Token tracking with a raw TUI.** A mirrored terminal emits no usage data, so
  each agent is launched with a known `--session-id` and we tail the on-disk
  session transcript for cumulative `input_tokens` / `output_tokens` /
  `cache_read_input_tokens`.
- **Env sanitizing.** If the manager is launched from *inside* a Claude session,
  inherited `CLAUDE_CODE_CHILD_SESSION` / `CLAUDE_CODE_SESSION_ID` would make
  spawned agents act as sub-sessions and skip transcript persistence. We strip
  them (`server/src/claudeConfig.ts`).
- **Trust.** Fresh worktrees would trigger the interactive trust dialog and hang
  the PTY, so the worktree path is added to `~/.claude.json` with
  `hasTrustDialogAccepted: true` before launch (atomic, backed up once).

## Settings

- **Default model** (e.g. `opus`, `sonnet`, or a full id) and **default
  permission mode** (`auto` by default) for new agents.
- **Concurrency cap** — soft limit on simultaneously running agents.
- **Worktree root** — where worktrees live. Defaults to
  `<app-drive>:\swarmworker-worktrees` (the same drive as the app, so it stays
  off C: if you installed on a faster drive). Override with the
  `SWARM_WORKTREE_ROOT` env var or in Settings.

State (registered projects, settings, agent metadata) is persisted to
`~/.swarmworker/state.json`. Stopped agents can be **resumed** (`--resume`).

## Layout

```
server/   Node + TypeScript backend (PTY supervisor, git, transcript tailing, WS/REST)
web/      React + Vite + xterm.js SPA (list view, camera grid, dialogs)
```

`server/src/smoke.ts` is a standalone integration check (`npm -w server run smoke`)
that spawns one claude PTY and confirms token tailing.
