// WebSocket client: routes metadata to the store and PTY bytes to xterm.
import {
  applyServerState,
  removeAgent,
  setConnected,
  updateAgentTokens,
} from './store';
import { terminals } from './terminals';

let ws: WebSocket | null = null;
const outbox: unknown[] = [];

export function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    setConnected(true);
    for (const m of outbox) ws!.send(JSON.stringify(m));
    outbox.length = 0;
  };
  ws.onclose = () => {
    setConnected(false);
    ws = null;
    setTimeout(connect, 1000);
  };
  ws.onerror = () => ws?.close();

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    switch (m.t) {
      case 'state':
        applyServerState(m);
        break;
      case 'pty':
      case 'replay':
        terminals.write(m.agentId, m.data);
        break;
      case 'tokens':
        updateAgentTokens(m.agentId, m.usage);
        break;
      case 'removed':
        removeAgent(m.agentId);
        terminals.dispose(m.agentId);
        break;
    }
  };
}

export function wsSend(m: unknown) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  else outbox.push(m);
}
