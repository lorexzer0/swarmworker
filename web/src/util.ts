import { useEffect, useState } from 'react';
import type { AgentStatus } from './types';

export function fmtTokens(n: number): string {
  if (!n) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

export function fmtAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export const STATUS_COLOR: Record<AgentStatus, string> = {
  starting: '#e6b450',
  running: '#7fd962',
  exited: '#6c7986',
  error: '#f07178',
};

export const STATUS_LABEL: Record<AgentStatus, string> = {
  starting: 'starting',
  running: 'live',
  exited: 'stopped',
  error: 'error',
};

/** Re-renders the calling component on an interval (for live age display). */
export function useNow(intervalMs = 1000): number {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return Date.now();
}
