// One live xterm Terminal per agent, kept in a detached wrapper div so it can
// be moved between the grid tile, the list dock, and the expand overlay without
// losing scrollback. The PTY size follows wherever the terminal is mounted.
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { wsSend } from './ws';

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
