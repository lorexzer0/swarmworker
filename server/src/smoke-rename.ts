// Focused check: spawn claude under a PTY exactly like AgentManager.startProcess,
// drive `/rename <name>` before any prompt, and confirm a `custom-title` line
// with that name lands in the session transcript. Cheap — /rename is local.
import * as pty from '@homebridge/node-pty-prebuilt-multiarch';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveClaudeLauncher, sanitizedEnv, ensureTrusted, transcriptDirFor } from './claudeConfig.js';

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-rename-'));
const sessionId = randomUUID();
const NAME = 'smoke_rename_check';
ensureTrusted(cwd);
console.log('[rename] cwd=%s sessionId=%s', cwd, sessionId);

const launcher = resolveClaudeLauncher();
const p = pty.spawn(launcher.file, [
  ...launcher.prefixArgs,
  '--session-id', sessionId,
  '--permission-mode', 'default',
  '--model', 'sonnet',
], { name: 'xterm-256color', cols: 120, rows: 34, cwd, env: sanitizedEnv({ FORCE_COLOR: '1' }) });

p.onData(() => {});

// Mirror startProcess timing: type at 3500ms, submit 400ms later.
setTimeout(() => {
  console.log('[rename] >>> /rename %s', NAME);
  p.write(`/rename ${NAME}`);
  setTimeout(() => p.write('\r'), 400);
}, 3500);

function transcriptHasTitle(): string | null {
  const dir = transcriptDirFor(cwd);
  const f = path.join(dir, `${sessionId}.jsonl`);
  if (!fs.existsSync(f)) return null;
  const raw = fs.readFileSync(f, 'utf8');
  const i = raw.lastIndexOf('"type":"custom-title"');
  if (i < 0) return null;
  const start = raw.lastIndexOf('\n', i) + 1;
  let end = raw.indexOf('\n', i);
  if (end < 0) end = raw.length;
  try { return JSON.parse(raw.slice(start, end)).customTitle ?? null; } catch { return null; }
}

// Poll the transcript for the custom-title line.
let done = false;
const poll = setInterval(() => {
  const title = transcriptHasTitle();
  if (title !== null) {
    console.log('[rename] custom-title found: %j  -> %s', title, title === NAME ? 'MATCH ✓' : 'MISMATCH ✗');
    finish(title === NAME ? 0 : 2);
  }
}, 500);

function finish(code: number) {
  if (done) return;
  done = true;
  clearInterval(poll);
  try { p.write('\x03'); } catch {}
  setTimeout(() => {
    try { p.kill(); } catch {}
    try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {}
    process.exit(code);
  }, 600);
}

setTimeout(() => {
  console.log('[rename] TIMEOUT — no custom-title line appeared');
  finish(1);
}, 30000);
