// Integration smoke test: spawn interactive `claude` inside a ConPTY, drive it
// like a terminal, and confirm the TranscriptWatcher reports token usage.
import * as pty from '@homebridge/node-pty-prebuilt-multiarch';
import { randomUUID } from 'crypto';
import { TranscriptWatcher } from './tokens.js';
import { resolveClaudeLauncher, sanitizedEnv } from './claudeConfig.js';

const cwd = process.cwd();
const sessionId = randomUUID();
console.log('[smoke] sessionId=%s cwd=%s', sessionId, cwd);

let gotTokens = false;
const watcher = new TranscriptWatcher(cwd, sessionId, (u) => {
  console.log('[smoke][TOKENS] in=%d out=%d cacheR=%d turns=%d model=%s',
    u.inputTokens, u.outputTokens, u.cacheReadTokens, u.turns, u.lastModel);
  if (u.turns > 0 && !gotTokens) {
    gotTokens = true;
    console.log('[smoke] token tracking CONFIRMED — shutting down in 2s');
    setTimeout(shutdown, 2000);
  }
});
watcher.start();

const launcher = resolveClaudeLauncher();
console.log('[smoke] launcher=%s %o', launcher.file, launcher.prefixArgs);
const p = pty.spawn(launcher.file, [
  ...launcher.prefixArgs,
  '--session-id', sessionId,
  '--permission-mode', 'default',
  '--model', 'sonnet',
], { name: 'xterm-color', cols: 110, rows: 32, cwd, env: sanitizedEnv() });

let bytes = 0;
p.onData((d) => { bytes += d.length; });

// Give the TUI time to boot, then type a prompt and submit with Enter (\r).
setTimeout(() => {
  console.log('\n[smoke] >>> typing prompt');
  p.write('Respond with a one-word greeting.');
  setTimeout(() => p.write('\r'), 500);
}, 6000);

let done = false;
function shutdown() {
  if (done) return;
  done = true;
  watcher.stop();
  try { p.write('\x03'); } catch {} // Ctrl-C
  setTimeout(() => { try { p.kill(); } catch {} ; process.exit(gotTokens ? 0 : 1); }, 800);
}

p.onExit(({ exitCode }) => {
  console.log('\n[smoke] claude exited code=%d', exitCode);
  shutdown();
});

// Hard cap so the test never hangs.
setTimeout(() => {
  console.log('\n[smoke] TIMEOUT (no tokens seen)');
  shutdown();
}, 75000);
