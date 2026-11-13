import { describe, expect, it } from 'vitest';

import {
  addComparison,
  addUnmarkedPage,
  appendCapped,
  emptyCappedList,
  emptyCoverageTotals,
  emptyUnmarkedTotals,
  type CappedList,
} from '../coverage-accumulation.ts';

describe('appendCapped', () => {
  it('starts from an empty list with no total and no truncation', () => {
    expect(emptyCappedList<string>()).toEqual({ total: 0, items: [], truncated: false });
  });

  it.each([
    { limit: 3, additions: ['a'], expected: ['a'], truncated: false },
    { limit: 3, additions: ['a', 'b', 'c'], expected: ['a', 'b', 'c'], truncated: false },
    { limit: 3, additions: ['a', 'b', 'c', 'd'], expected: ['a', 'b', 'c'], truncated: true },
  ])(
    'appends the additions to a list of $limit and truncates=$truncated',
    ({ limit, additions, expected, truncated }) => {
      const list = appendCapped(emptyCappedList<string>(), additions, limit);
      expect(list.total).toBe(additions.length);
      expect(list.items).toEqual(expected);
      expect(list.truncated).toBe(truncated);
    },
  );

  it('keeps a truncated list truncated after a later empty addition', () => {
    const truncated = appendCapped(emptyCappedList<string>(), ['a', 'b', 'c'], 2);
    expect(truncated.truncated).toBe(true);
    expect(appendCapped(truncated, [], 2).truncated).toBe(true);
  });

  it('does not mutate the list or the additions it receives', () => {
    const list: CappedList<string> = Object.freeze({
      total: 1,
      items: Object.freeze(['a']),
      truncated: false,
    });
    const additions = Object.freeze(['b']);

    const result = appendCapped(list, additions, 5);

    expect(result.items).toEqual(['a', 'b']);
    expect(list).toEqual({ total: 1, items: ['a'], truncated: false });
    expect(additions).toEqual(['b']);
  });
});

describe('addComparison', () => {
  it('starts from empty totals', () => {
    expect(emptyCoverageTotals()).toEqual({
      checked: 0,
      missing: { total: 0, items: [], truncated: false },
      stale: { total: 0, items: [], truncated: false },
    });
  });

  it('sums the checked count and both lists across two comparisons', () => {
    const first = addComparison(
      emptyCoverageTotals(),
      { checked: 2, missing: ['a'], stale: ['b'] },
      10,
    );
    const second = addComparison(
      first,
      { checked: 3, missing: ['c'], stale: ['d'] },
      10,
    );

    expect(second.checked).toBe(5);
    expect(second.missing.total).toBe(2);
    expect(second.missing.items).toEqual(['a', 'c']);
    expect(second.stale.total).toBe(2);
    expect(second.stale.items).toEqual(['b', 'd']);
  });
});

describe('addUnmarkedPage', () => {
  it('starts from empty unmarked totals', () => {
    expect(emptyUnmarkedTotals<string>()).toEqual({
      checked: 0,
      unmarked: { total: 0, items: [], truncated: false },
    });
  });

  it('sums the checked count and the unmarked total and caps the items', () => {
    const first = addUnmarkedPage(emptyUnmarkedTotals<string>(), 3, ['a', 'b'], 3);
    const second = addUnmarkedPage(first, 2, ['c', 'd'], 3);

    expect(second.checked).toBe(5);
    expect(second.unmarked.total).toBe(4);
    expect(second.unmarked.items).toEqual(['a', 'b', 'c']);
    expect(second.unmarked.truncated).toBe(true);
  });
});
