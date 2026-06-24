# Contributing to swarmworker

Thanks for your interest in improving swarmworker! This project is a local
control room for a swarm of Claude Code agents. Contributions of all kinds are
welcome — bug reports, features, docs, and refactors.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating, you agree to uphold it.

## Getting started

### Prerequisites

- **Node 18+** (the project is developed on Node 22) and npm
- **git 2.30+**
- The **`claude` CLI** installed and logged in (`claude auth`). A Max/Pro
  subscription works via the normal OAuth login — no API key is required.

### Setup

```bash
git clone https://github.com/lorexzer0/swarmworker.git
cd swarmworker
npm install
```

This is an npm-workspaces monorepo:

```
server/   Node + TypeScript backend (PTY supervisor, git, transcript tailing, WS/REST)
web/      React + Vite + xterm.js SPA (list view, camera grid, dialogs)
```

### Running locally

```bash
# Dev: hot-reload SPA + server (Vite proxies /api and /ws to :8787)
npm run dev          # -> http://localhost:5173

# Production-style: build the SPA and serve everything from one Node process
npm run build
npm start            # -> http://localhost:8787
```

> ⚠️ swarmworker runs `claude` agents that can execute commands on your machine,
> by default without per-action confirmation. Please read [SECURITY.md](SECURITY.md)
> before running it, especially the note about network exposure.

## Development workflow

1. **Fork** the repo and create a branch off `main`:
   `git checkout -b feat/short-description`
2. Make your change. Keep it focused — one logical change per PR.
3. **Type-check, test, and build** before pushing — this is exactly what CI runs:
   ```bash
   npm run typecheck   # web tsc --noEmit + server tsc
   npm test            # vitest unit tests (server + web)
   npm run build       # full production build
   ```
   Add or update unit tests for any logic you change. Tests live next to the
   code as `*.test.ts` and run in Node via [Vitest](https://vitest.dev). Run a
   single workspace's tests in watch mode with `npm -w server run test:watch`
   (or `-w web`).
4. If you touched the PTY/transcript plumbing, run the smoke checks (require a
   logged-in `claude` CLI):
   ```bash
   npm -w server run smoke         # spawns one claude PTY, confirms token tailing
   npm -w server run smoke:rename  # confirms auto-/rename lands a custom-title
   ```
5. Commit with a clear message (see below), push, and open a Pull Request
   against `main`. Fill out the PR template and link any related issue.

## Coding guidelines

- **TypeScript everywhere.** No new `any` where a real type is reasonable.
- **Match the surrounding style** — naming, comment density, and idioms. The
  codebase favors small modules with a short header comment explaining intent.
- **Keep the server cross-platform.** Windows (ConPTY) is a first-class target;
  don't assume POSIX-only paths or shells.
- **No secrets, absolute personal paths, or machine-specific config** in commits.
- Prefer small, reviewable PRs over large sweeping ones.

## Commit messages

Use short, imperative summaries, e.g. `Add per-agent git profiles`. Reference
issues where relevant (`Fix #123: …`).

## Reporting bugs & requesting features

Use the [issue templates](https://github.com/lorexzer0/swarmworker/issues/new/choose).
Include your OS, Node version, and steps to reproduce. For security issues, do
**not** open a public issue — see [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
