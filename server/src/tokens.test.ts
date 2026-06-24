import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emptyUsage,
  countSessions,
  mostRecentSession,
  listSessions,
  transcriptExists,
  TranscriptWatcher,
} from './tokens.js';
import { encodeProjectDir } from './claudeConfig.js';

const CWD = '/projects/demo';

let home: string;
let projDir: string; // <home>/.claude/projects/<encoded CWD>

/** Write a JSONL transcript (one JSON object per line) into the demo project. */
function writeSession(id: string, lines: unknown[]): string {
  const file = path.join(projDir, `${id}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return file;
}

function setMtime(id: string, date: Date): void {
  const f = path.join(projDir, `${id}.jsonl`);
  fs.utimesSync(f, date, date);
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-tokens-'));
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  projDir = path.join(home, '.claude', 'projects', encodeProjectDir(CWD));
  fs.mkdirSync(projDir, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('emptyUsage', () => {
  it('starts every counter at zero', () => {
    expect(emptyUsage()).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      turns: 0,
    });
  });
});

describe('countSessions', () => {
  it('counts only .jsonl files', () => {
    expect(countSessions(CWD)).toBe(0);
    writeSession('s1', [{}]);
    writeSession('s2', [{}]);
    fs.writeFileSync(path.join(projDir, 'notes.txt'), 'ignore me');
    expect(countSessions(CWD)).toBe(2);
  });

  it('returns 0 for an unknown cwd', () => {
    expect(countSessions('/nope/does/not/exist')).toBe(0);
  });
});

describe('mostRecentSession', () => {
  it('returns the id of the newest transcript by mtime', () => {
    writeSession('old', [{}]);
    writeSession('new', [{}]);
    setMtime('old', new Date(2020, 0, 1));
    setMtime('new', new Date(2020, 0, 2));
    expect(mostRecentSession(CWD)).toBe('new');
  });

  it('returns undefined when there are no transcripts', () => {
    expect(mostRecentSession(CWD)).toBeUndefined();
  });
});

describe('listSessions', () => {
  it('reads custom-title + last-prompt and sorts newest first', () => {
    writeSession('a', [
      { type: 'custom-title', customTitle: 'First Session' },
      { type: 'last-prompt', lastPrompt: 'do the   thing\nplease' },
    ]);
    writeSession('b', [{ type: 'last-prompt', lastPrompt: 'no title here' }]);
    setMtime('a', new Date(2021, 0, 1));
    setMtime('b', new Date(2021, 0, 2));

    const sessions = listSessions(CWD);
    expect(sessions.map((s) => s.sessionId)).toEqual(['b', 'a']); // newest first

    const a = sessions.find((s) => s.sessionId === 'a')!;
    expect(a.title).toBe('First Session');
    expect(a.preview).toBe('do the thing please'); // whitespace collapsed

    const b = sessions.find((s) => s.sessionId === 'b')!;
    expect(b.title).toBeNull();
    expect(b.preview).toBe('no title here');
  });

  it('returns an empty array for an unknown cwd', () => {
    expect(listSessions('/nope')).toEqual([]);
  });
});

describe('transcriptExists', () => {
  it('finds a session in its computed project dir', () => {
    writeSession('xyz', [{}]);
    expect(transcriptExists(CWD, 'xyz')).toBe(true);
    expect(transcriptExists(CWD, 'nope')).toBe(false);
  });

  it('falls back to scanning other project dirs', () => {
    const otherDir = path.join(home, '.claude', 'projects', 'some-other-proj');
    fs.mkdirSync(otherDir, { recursive: true });
    fs.writeFileSync(path.join(otherDir, 'roaming.jsonl'), '{}\n');
    // The cwd's own dir does not have it, but the global scan should.
    expect(transcriptExists('/a/totally/different', 'roaming')).toBe(true);
  });
});

describe('TranscriptWatcher', () => {
  it('accumulates token usage across assistant turns', () => {
    writeSession('live', [
      { type: 'user', message: { role: 'user', content: 'hi' } },
      {
        message: {
          id: 'm1',
          role: 'assistant',
          model: 'claude-x',
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: 2,
            cache_creation_input_tokens: 1,
          },
        },
      },
      {
        message: {
          id: 'm2',
          role: 'assistant',
          model: 'claude-y',
          usage: { input_tokens: 20, output_tokens: 7 },
        },
      },
    ]);

    const updates: number[] = [];
    const w = new TranscriptWatcher(CWD, 'live', (u) => updates.push(u.turns));
    // start() ticks once synchronously; the file is already fully written.
    w.start();
    w.stop();

    expect(w.usage.inputTokens).toBe(30);
    expect(w.usage.outputTokens).toBe(12);
    expect(w.usage.cacheReadTokens).toBe(2);
    expect(w.usage.cacheCreationTokens).toBe(1);
    expect(w.usage.turns).toBe(2);
    expect(w.usage.lastModel).toBe('claude-y');
    expect(updates.length).toBeGreaterThan(0);
  });

  it('ignores non-assistant lines and de-dups by message id', () => {
    writeSession('dups', [
      { message: { id: 'dup', role: 'assistant', usage: { input_tokens: 5, output_tokens: 5 } } },
      { message: { id: 'dup', role: 'assistant', usage: { input_tokens: 5, output_tokens: 5 } } }, // dup id
      { message: { role: 'user', usage: { input_tokens: 999 } } }, // wrong role
    ]);

    const w = new TranscriptWatcher(CWD, 'dups', () => {});
    w.start();
    w.stop();

    expect(w.usage.turns).toBe(1);
    expect(w.usage.inputTokens).toBe(5);
  });

  it('does nothing when the transcript does not exist yet', () => {
    let called = false;
    const w = new TranscriptWatcher(CWD, 'missing', () => {
      called = true;
    });
    w.start();
    w.stop();
    expect(called).toBe(false);
    expect(w.usage).toEqual(emptyUsage());
  });
});
