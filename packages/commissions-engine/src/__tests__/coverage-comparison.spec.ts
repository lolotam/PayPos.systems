import { describe, expect, it } from 'vitest';

import {
  compareCoverage,
  coverageKey,
  findUnmarkedEventIds,
  type CoverageRow,
} from '../coverage-comparison.ts';

const row = (key: string, revision: number): CoverageRow => ({ key, revision });
const covered = { checked: 1, missing: [], stale: [] };

describe('compareCoverage', () => {
  it('covers a source row whose projection revision equals it', () => {
    expect(compareCoverage([row('a', 3)], [row('a', 3)])).toEqual(covered);
  });

  it('covers a source row whose projection revision is ahead of it', () => {
    expect(compareCoverage([row('a', 3)], [row('a', 9)])).toEqual(covered);
  });

  it('marks a source row stale when the projection revision is lower', () => {
    expect(compareCoverage([row('a', 3)], [row('a', 1)])).toEqual({
      checked: 1,
      missing: [],
      stale: ['a'],
    });
  });

  it('marks a source row missing when the projection holds no row for it', () => {
    expect(compareCoverage([row('a', 3)], [])).toEqual({
      checked: 1,
      missing: ['a'],
      stale: [],
    });
  });

  it('ignores projection keys the source does not hold', () => {
    expect(compareCoverage([], [row('extra', 1)])).toEqual({ checked: 0, missing: [], stale: [] });
  });

  it('uses the highest revision when the source repeats a key', () => {
    expect(compareCoverage([row('a', 1), row('a', 5)], [row('a', 5)])).toEqual(covered);
  });

  it('uses the highest revision when the projection repeats a key', () => {
    expect(compareCoverage([row('a', 5)], [row('a', 1), row('a', 9)])).toEqual(covered);
  });

  it('lists the missing keys in ascending order, each key once', () => {
    expect(compareCoverage([row('b', 1), row('a', 1), row('b', 2)], [])).toEqual({
      checked: 2,
      missing: ['a', 'b'],
      stale: [],
    });
  });

  it('lists the stale keys in ascending order, each key once', () => {
    const source = [row('b', 4), row('a', 4), row('b', 4)];
    expect(compareCoverage(source, [row('b', 1), row('a', 2)])).toEqual({
      checked: 2,
      missing: [],
      stale: ['a', 'b'],
    });
  });

  it('counts the distinct source keys in checked', () => {
    expect(compareCoverage([row('a', 1), row('a', 2), row('b', 1)], [])).toEqual({
      checked: 2,
      missing: ['a', 'b'],
      stale: [],
    });
  });

  it('returns a zero count and empty lists for an empty source', () => {
    expect(compareCoverage([], [row('a', 1)])).toEqual({ checked: 0, missing: [], stale: [] });
  });
});

describe('findUnmarkedEventIds', () => {
  it('keeps the original order of the unmarked ids', () => {
    expect(findUnmarkedEventIds(['c', 'a', 'b'], new Set(['a']))).toEqual(['c', 'b']);
  });

  it('removes a repeated unmarked id', () => {
    expect(findUnmarkedEventIds(['c', 'c', 'b'], new Set<string>())).toEqual(['c', 'b']);
  });

  it('returns an empty list when every id is marked', () => {
    expect(findUnmarkedEventIds(['a', 'b'], new Set(['a', 'b']))).toEqual([]);
  });
});

describe('coverageKey', () => {
  it('joins the parts with a pipe', () => {
    expect(coverageKey('emp-1', '2026-01-31')).toBe('emp-1|2026-01-31');
  });

  it('keeps the case of every part', () => {
    expect(coverageKey('Emp-1', 'AbC')).toBe('Emp-1|AbC');
  });

  it('rejects an empty part with a RangeError', () => {
    const attempt = (): string => coverageKey('emp-1', '');
    expect(attempt).toThrow(RangeError);
    expect(attempt).toThrow('COVERAGE_KEY_PART_INVALID');
  });

  it('rejects a part that carries the pipe with a RangeError', () => {
    const attempt = (): string => coverageKey('emp|1', '2026-01-31');
    expect(attempt).toThrow(RangeError);
    expect(attempt).toThrow('COVERAGE_KEY_PART_INVALID');
  });
});
