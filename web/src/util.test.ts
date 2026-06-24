import { afterEach, describe, expect, it, vi } from 'vitest';
import { fmtTokens, fmtAge, fmtAgo, STATUS_COLOR, STATUS_LABEL } from './util';

describe('fmtTokens', () => {
  it('formats zero, small, thousands, and millions', () => {
    expect(fmtTokens(0)).toBe('0');
    expect(fmtTokens(42)).toBe('42');
    expect(fmtTokens(999)).toBe('999');
    expect(fmtTokens(1_500)).toBe('1.5k');
    expect(fmtTokens(2_500_000)).toBe('2.50M');
  });
});

describe('fmtAge', () => {
  it('formats seconds, minutes, hours, and days', () => {
    expect(fmtAge(5_000)).toBe('5s');
    expect(fmtAge(90_000)).toBe('1m 30s');
    expect(fmtAge(3_661_000)).toBe('1h 1m');
    expect(fmtAge(90_000_000)).toBe('1d 1h');
  });

  it('clamps negative durations to 0s', () => {
    expect(fmtAge(-100)).toBe('0s');
  });
});

describe('fmtAgo', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders relative time from an absolute timestamp', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100_000);
    expect(fmtAgo(95_000)).toBe('5s ago');
  });
});

describe('status maps', () => {
  it('have a colour and a label for every status', () => {
    for (const status of ['starting', 'running', 'exited', 'error'] as const) {
      expect(STATUS_COLOR[status]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(typeof STATUS_LABEL[status]).toBe('string');
      expect(STATUS_LABEL[status].length).toBeGreaterThan(0);
    }
  });
});
