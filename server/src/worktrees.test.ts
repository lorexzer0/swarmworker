import { describe, expect, it } from 'vitest';
import { sanitizeBranchSegment, toSnakeCase, generateBranch } from './worktrees.js';

describe('sanitizeBranchSegment', () => {
  it('keeps git-safe characters and collapses the rest into single dashes', () => {
    expect(sanitizeBranchSegment('feature/My Cool Thing!!')).toBe('feature-My-Cool-Thing');
  });

  it('keeps dots, underscores, and dashes', () => {
    expect(sanitizeBranchSegment('keep.dots_and-dashes')).toBe('keep.dots_and-dashes');
  });

  it('trims leading/trailing dashes and collapses runs', () => {
    expect(sanitizeBranchSegment('--leading--and--trailing--')).toBe('leading-and-trailing');
  });

  it('returns an empty string when nothing survives', () => {
    expect(sanitizeBranchSegment('@@@')).toBe('');
  });
});

describe('toSnakeCase', () => {
  it('lowercases and joins on non-alphanumerics', () => {
    expect(toSnakeCase('Fix the Bug!')).toBe('fix_the_bug');
    expect(toSnakeCase('  Hello   World  ')).toBe('hello_world');
    expect(toSnakeCase('ALLCAPS')).toBe('allcaps');
  });

  it('falls back to "session" when empty', () => {
    expect(toSnakeCase('')).toBe('session');
    expect(toSnakeCase('***')).toBe('session');
  });
});

describe('generateBranch', () => {
  it('produces swarm/<base>-<id>', () => {
    expect(generateBranch('main', 'abc123')).toBe('swarm/main-abc123');
  });

  it('sanitizes the base segment', () => {
    expect(generateBranch('feature/x y', 'id')).toBe('swarm/feature-x-y-id');
  });

  it('falls back to "work" when the base sanitizes to nothing', () => {
    expect(generateBranch('@@@', 'id')).toBe('swarm/work-id');
  });
});
