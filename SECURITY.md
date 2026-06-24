# Security Policy

## ⚠️ Understand what swarmworker does before you run it

swarmworker launches and supervises **real, interactive `claude` (Claude Code)
sessions** on your machine. Each agent is a Claude Code process running in a
pseudo-terminal with access to a git worktree (or, in "work in place" mode, your
actual repo checkout). **These agents can read, write, and execute code and
shell commands on your computer.**

By design, agents default to the **`auto` permission mode**, and
`bypassPermissions` is available — meaning an agent can take actions
**without asking you to confirm each one**. This is the entire point of the
tool, but it means you should treat every running agent as code executing with
your user's privileges.

Run swarmworker only on repositories and prompts you trust, and review what your
agents are doing.

### Network exposure

The server binds to the port (default `8787`) on **all network interfaces**, and
the WebSocket API lets any connected client send keystrokes to every agent's
terminal. There is **no authentication**. Anyone who can reach the port can
drive your agents.

Recommendations:

- Run it on a trusted machine on a trusted network only.
- Do **not** port-forward or expose `8787` (or the Vite dev port `5173`) to the
  public internet.
- If you need remote access, put it behind a VPN or an authenticating reverse
  proxy, or bind it to localhost and tunnel over SSH.

### Trust pre-seeding

To avoid the interactive trust dialog stalling a head-less PTY, swarmworker
writes `hasTrustDialogAccepted: true` for each worktree path into
`~/.claude.json` (atomic, backed up once). This means agents skip the trust
prompt for paths swarmworker manages — another reason to only point it at repos
you trust.

### Local state

Settings, registered projects, and agent metadata are written to
`~/.swarmworker/state.json` (override with `SWARM_DATA_DIR`). No credentials are
stored by swarmworker itself — authentication is handled entirely by your local
`claude` CLI login.

## Supported versions

This project is pre-1.0 and moves quickly. Security fixes are applied to the
`main` branch; please run the latest `main`.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use GitHub's [private vulnerability reporting](https://github.com/lorexzer0/swarmworker/security/advisories/new)
("Report a vulnerability" on the repo's **Security** tab). If that is
unavailable, open a minimal issue asking for a private contact channel without
disclosing details.

When reporting, please include:

- A description of the issue and its impact
- Steps to reproduce or a proof of concept
- Affected version / commit
- Any suggested remediation

You can expect an initial acknowledgement within a few days. We'll work with you
on a fix and coordinate disclosure. Thank you for helping keep users safe.
