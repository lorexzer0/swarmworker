import { useEffect, useRef } from 'react';
import { terminals } from '../terminals';

/**
 * Mounts an agent's live terminal into this DOM node. Because each agent owns a
 * single detached wrapper, whichever TerminalMount renders last "owns" the
 * terminal — so the grid tile, list dock, and expand overlay hand it off
 * cleanly. A ResizeObserver keeps the PTY fitted to the container.
 */
export function TerminalMount({
  agentId,
  focusOnMount,
}: {
  agentId: string;
  focusOnMount?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    terminals.mount(agentId, el);
    if (focusOnMount) terminals.focus(agentId);
    const ro = new ResizeObserver(() => terminals.fit(agentId));
    ro.observe(el);
    return () => ro.disconnect();
  }, [agentId, focusOnMount]);

  return <div className="term-host" ref={ref} onMouseDown={() => terminals.focus(agentId)} />;
}
