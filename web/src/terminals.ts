// One live xterm Terminal per agent, kept in a detached wrapper div so it can
// be moved between the grid tile, the list dock, and the expand overlay without
// losing scrollback. The PTY size follows wherever the terminal is mounted.
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { wsSend } from './ws';

/** Copy text to the clipboard, full and intact. Prefers the async Clipboard
 *  API (secure contexts / localhost) and falls back to execCommand so it also
 *  works over plain-HTTP on a LAN IP. */
function writeClipboard(text: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => execCommandCopy(text));
  } else {
    execCommandCopy(text);
  }
}
function execCommandCopy(text: string): void {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  } catch {
    /* ignore */
  }
}

interface Entry {
  term: Terminal;
  fit: FitAddon;
  wrapper: HTMLDivElement;
  lastCols: number;
  lastRows: number;
}

class TerminalManager {
  private map = new Map<string, Entry>();

  private create(agentId: string): Entry {
    const term = new Terminal({
      fontFamily: '"Cascadia Mono", "Consolas", ui-monospace, monospace',
      fontSize: 12,
      lineHeight: 1.0,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      theme: {
        background: '#0a0e14',
        foreground: '#bfbdb6',
        cursor: '#ffb454',
        selectionBackground: '#273747',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    const wrapper = document.createElement('div');
    wrapper.className = 'term-wrapper';
    term.open(wrapper);
    term.onData((d) => wsSend({ t: 'input', agentId, data: d }));

    // Ctrl+C copies the selection (then clears it) instead of sending SIGINT;
    // with nothing selected it falls through as a normal interrupt. We
    // preventDefault so the browser's own copy (which grabs only xterm's
    // partial a11y buffer) can't race and clobber our full-selection copy.
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type === 'keydown' && ev.ctrlKey && !ev.altKey && !ev.metaKey && (ev.key === 'c' || ev.key === 'C')) {
        if (term.hasSelection()) {
          ev.preventDefault();
          writeClipboard(term.getSelection());
          term.clearSelection();
          return false; // handled — don't forward ^C to the PTY
        }
      }
      return true;
    });

    // Right-click pastes the clipboard into the terminal.
    wrapper.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      navigator.clipboard
        ?.readText()
        .then((text) => {
          if (text) term.paste(text);
        })
        .catch(() => {});
    });

    const e: Entry = { term, fit, wrapper, lastCols: 0, lastRows: 0 };
    this.map.set(agentId, e);
    wsSend({ t: 'attach', agentId }); // request replay backlog
    return e;
  }

  private ensure(agentId: string): Entry {
    return this.map.get(agentId) || this.create(agentId);
  }

  has(agentId: string): boolean {
    return this.map.has(agentId);
  }

  write(agentId: string, data: string) {
    this.ensure(agentId).term.write(data);
  }

  /** Move this agent's terminal into `container` and fit it to that size. */
  mount(agentId: string, container: HTMLElement) {
    const e = this.ensure(agentId);
    // A container shows exactly one terminal. Evict any other agent's wrapper
    // left behind — e.g. the list dock reuses one node across selections, so
    // without this the previous agent's terminal stays stacked on top.
    for (const child of Array.from(container.children)) {
      if (child !== e.wrapper && child instanceof HTMLElement && child.classList.contains('term-wrapper')) {
        container.removeChild(child);
      }
    }
    if (e.wrapper.parentElement !== container) container.appendChild(e.wrapper);
    this.fit(agentId);
  }

  fit(agentId: string) {
    const e = this.map.get(agentId);
    if (!e || !e.wrapper.isConnected) return;
    requestAnimationFrame(() => {
      try {
        e.fit.fit();
        if (e.term.cols !== e.lastCols || e.term.rows !== e.lastRows) {
          e.lastCols = e.term.cols;
          e.lastRows = e.term.rows;
          wsSend({ t: 'resize', agentId, cols: e.term.cols, rows: e.term.rows });
        }
      } catch {
        /* element not measurable yet */
      }
    });
  }

  fitAll() {
    for (const id of this.map.keys()) this.fit(id);
  }

  focus(agentId: string) {
    this.map.get(agentId)?.term.focus();
  }

  dispose(agentId: string) {
    const e = this.map.get(agentId);
    if (!e) return;
    e.term.dispose();
    e.wrapper.remove();
    this.map.delete(agentId);
  }
}

export const terminals = new TerminalManager();
