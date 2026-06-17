// Tails a Claude Code session transcript (~/.claude/projects/<enc>/<id>.jsonl)
// and accumulates token usage. This is how we get exact input/output token
// counts while mirroring the raw TUI in a PTY (the TUI itself emits no usage).
import fs from 'fs';
import path from 'path';
import { transcriptDirFor, projectsRoot } from './claudeConfig.js';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  lastModel?: string;
  turns: number;
}

export function emptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    turns: 0,
  };
}

/** One Claude conversation ("discussion") recorded for a worktree cwd. */
export interface SessionInfo {
  sessionId: string;
  title: string | null; // set via /rename (custom-title line)
  preview: string | null; // last user prompt, as a fallback label
  updatedAt: number; // file mtime (ms)
  sizeBytes: number;
}

/** Count session transcripts ("discussions") recorded for a worktree cwd. Cheap
 *  — just a directory listing, no file reads. */
export function countSessions(cwd: string): number {
  try {
    return fs.readdirSync(transcriptDirFor(cwd)).filter((f) => f.endsWith('.jsonl')).length;
  } catch {
    return 0;
  }
}

/** id of the most-recently-touched discussion for a cwd (mtime only, no reads). */
export function mostRecentSession(cwd: string): string | undefined {
  let best: { id: string; m: number } | undefined;
  try {
    const dir = transcriptDirFor(cwd);
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.jsonl')) continue;
      let m = 0;
      try {
        m = fs.statSync(path.join(dir, name)).mtimeMs;
      } catch {
        continue;
      }
      if (!best || m > best.m) best = { id: name.replace(/\.jsonl$/, ''), m };
    }
  } catch {
    /* no transcript dir */
  }
  return best?.id;
}

/** Locate the last JSONL line containing `marker` and parse it (titles/prompts
 *  are tiny single lines that can appear anywhere, so we scan from the end). */
function lastLineWith(raw: string, marker: string): any | null {
  const i = raw.lastIndexOf(marker);
  if (i < 0) return null;
  const start = raw.lastIndexOf('\n', i) + 1;
  let end = raw.indexOf('\n', i);
  if (end < 0) end = raw.length;
  try {
    return JSON.parse(raw.slice(start, end));
  } catch {
    return null;
  }
}

/** List a worktree's discussions, newest first. Reads each transcript (for its
 *  title/preview) — call on demand, not on every poll. */
export function listSessions(cwd: string): SessionInfo[] {
  const dir = transcriptDirFor(cwd);
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
  const out: SessionInfo[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    let title: string | null = null;
    let preview: string | null = null;
    try {
      const raw = fs.readFileSync(file, 'utf8');
      title = lastLineWith(raw, '"type":"custom-title"')?.customTitle ?? null;
      const lp = lastLineWith(raw, '"type":"last-prompt"')?.lastPrompt;
      if (typeof lp === 'string') preview = lp.replace(/\s+/g, ' ').slice(0, 140);
    } catch {
      /* unreadable transcript */
    }
    out.push({
      sessionId: name.replace(/\.jsonl$/, ''),
      title,
      preview,
      updatedAt: stat.mtimeMs,
      sizeBytes: stat.size,
    });
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/** True if Claude has a resumable transcript on disk for this session. */
export function transcriptExists(cwd: string, sessionId: string): boolean {
  if (fs.existsSync(path.join(transcriptDirFor(cwd), `${sessionId}.jsonl`))) return true;
  try {
    const root = projectsRoot();
    for (const d of fs.readdirSync(root)) {
      if (fs.existsSync(path.join(root, d, `${sessionId}.jsonl`))) return true;
    }
  } catch {
    /* projects dir may not exist */
  }
  return false;
}

export class TranscriptWatcher {
  private file?: string;
  private offset = 0;
  private partial = '';
  private seenIds = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  usage: TokenUsage = emptyUsage();

  constructor(
    private cwd: string,
    private sessionId: string,
    private onUpdate: (u: TokenUsage) => void,
  ) {}

  start(intervalMs = 700): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Locate <sessionId>.jsonl: try the computed dir, then scan all projects. */
  private resolveFile(): string | undefined {
    if (this.file && fs.existsSync(this.file)) return this.file;
    const candidate = path.join(transcriptDirFor(this.cwd), `${this.sessionId}.jsonl`);
    if (fs.existsSync(candidate)) return (this.file = candidate);
    try {
      const root = projectsRoot();
      for (const d of fs.readdirSync(root)) {
        const f = path.join(root, d, `${this.sessionId}.jsonl`);
        if (fs.existsSync(f)) return (this.file = f);
      }
    } catch {
      /* projects dir may not exist yet */
    }
    return undefined;
  }

  private tick(): void {
    const f = this.resolveFile();
    if (!f) return;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(f);
    } catch {
      return;
    }
    if (stat.size < this.offset) {
      // file truncated/rotated — restart
      this.offset = 0;
      this.partial = '';
    }
    if (stat.size === this.offset) return;

    const fd = fs.openSync(f, 'r');
    try {
      const len = stat.size - this.offset;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, this.offset);
      this.offset = stat.size;
      this.partial += buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }

    let idx: number;
    let changed = false;
    while ((idx = this.partial.indexOf('\n')) >= 0) {
      const line = this.partial.slice(0, idx).trim();
      this.partial = this.partial.slice(idx + 1);
      if (line && this.ingest(line)) changed = true;
    }
    if (changed) this.onUpdate(this.usage);
  }

  private ingest(line: string): boolean {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      return false;
    }
    const msg = obj?.message;
    if (!msg || msg.role !== 'assistant' || !msg.usage) return false;
    const id: string | undefined = msg.id || obj.uuid;
    if (id) {
      if (this.seenIds.has(id)) return false; // avoid double counting
      this.seenIds.add(id);
    }
    const u = msg.usage;
    this.usage.inputTokens += u.input_tokens || 0;
    this.usage.outputTokens += u.output_tokens || 0;
    this.usage.cacheReadTokens += u.cache_read_input_tokens || 0;
    this.usage.cacheCreationTokens += u.cache_creation_input_tokens || 0;
    if (msg.model) this.usage.lastModel = msg.model;
    this.usage.turns += 1;
    return true;
  }
}
