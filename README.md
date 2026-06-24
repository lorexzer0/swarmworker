# swarmworker

[![CI](https://github.com/lorexzer0/swarmworker/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/lorexzer0/swarmworker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-3c873a.svg)](.nvmrc)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

A local control room for a swarm of **Claude Code** agents, each isolated in its
own **git worktree**, all on your machine, all driven by the real interactive
`claude` TUI mirrored into the browser.

> ⚠️ **Security:** swarmworker runs `claude` agents that can execute commands on
> your machine — by default *without* per-action confirmation — and the server
> has no authentication and binds to all network interfaces. Run it only on
> trusted machines/networks. Read [SECURITY.md](SECURITY.md) before you start.

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

**Working in place (no worktree).** Sometimes you want an agent to operate
directly on the repo's main checkout rather than an isolated worktree. Tick
**Work in the repo directly (no worktree)** in the New-agent dialog (or hit
*start agent* on the **repo root** row in the Worktrees manager). The agent runs
in the repo's current working dir on its current branch — no worktree or branch
is created, and removing the agent never deletes that checkout.

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

### Environment variables

All are optional; see [`.env.example`](.env.example). swarmworker reads them from
the process environment (it does not auto-load a `.env` file).

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | HTTP + WebSocket server port. |
| `SWARM_WORKTREE_ROOT` | `<app-drive>:\swarmworker-worktrees` | Where agent worktrees are created (also editable in Settings). |
| `SWARM_DATA_DIR` | `~/.swarmworker` | Where state is persisted. |
| `SWARM_CLAUDE_EXE` | resolved from `PATH` | Explicit path to the `claude` executable. |

### Named conversations & discussions

- **Auto-named conversations.** When an agent is *opened* (new agent, or a fresh
  conversation in a worktree), swarmworker drives the TUI with
  `/rename <window_name_in_snake_case>` *before* sending the initial prompt, so
  every conversation has a stable, recognizable title on disk.
- **Re-entering a worktree continues a discussion.** Each worktree row in the
  Worktrees manager shows a **💬 count** of prior Claude conversations
  ("discussions"). Opening a worktree resumes the most recent discussion by
  default; expand the 💬 chip to pick a specific one, or hit **＋ new** to start
  a fresh conversation. Discussions are read from the on-disk session
  transcripts (`custom-title` for the name, file mtime for recency).

## Layout

```
server/   Node + TypeScript backend (PTY supervisor, git, transcript tailing, WS/REST)
web/      React + Vite + xterm.js SPA (list view, camera grid, dialogs)
```

### Tests

Unit tests (Vitest) cover the pure logic — branch-name generation, Claude
project-dir encoding / env sanitizing / trust-config writing, and the transcript
token-accumulation watcher. Run the whole suite (server + web) with:

```bash
npm test
```

Tests live next to the code as `*.test.ts`. They run in Node with no external
processes, so they're safe in CI (where they run on every push/PR).

In addition, `server/src/smoke.ts` is a standalone integration check
(`npm -w server run smoke`) that spawns one claude PTY and confirms token
tailing. `smoke-rename.ts` (`npm -w server run smoke:rename`) confirms the
auto-`/rename` lands a `custom-title` in the transcript. The smoke checks need a
logged-in `claude` CLI and are not part of CI.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup,
the PR workflow, and coding guidelines, and please follow our
[Code of Conduct](CODE_OF_CONDUCT.md).

Quick start for hacking:

```bash
git clone https://github.com/lorexzer0/swarmworker.git
cd swarmworker
npm install
npm run dev
```

## Security

swarmworker executes agent commands on your machine and exposes an
unauthenticated control API. Please read [SECURITY.md](SECURITY.md) for the
threat model and how to report vulnerabilities **privately**.

## License

[MIT](LICENSE) © Lorex
