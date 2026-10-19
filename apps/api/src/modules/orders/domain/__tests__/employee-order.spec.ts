import { describe, expect, it } from 'vitest';
import { ascendingEmployeeIds, compareEmployeeId, employeeIdBatches } from '../employee-order.ts';

describe('compareEmployeeId', () => {
  it('orders lowercase ids and treats case variants as the same employee', () => {
    expect(compareEmployeeId('a', 'b')).toBeLessThan(0);
    expect(compareEmployeeId('b', 'a')).toBeGreaterThan(0);
    expect(compareEmployeeId('B', 'b')).toBe(0);
    expect(compareEmployeeId('A', 'b')).toBeLessThan(0);
  });
});

describe('ascendingEmployeeIds', () => {
  it('dedupes case variants and sorts the union ascending', () => {
    expect(ascendingEmployeeIds(['b', 'A'], ['a', 'c'], ['B'])).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty list when every source is empty', () => {
    expect(ascendingEmployeeIds([], [])).toEqual([]);
  });
});

describe('employeeIdBatches', () => {
  it('keeps order and lets the last batch be shorter', () => {
    expect(employeeIdBatches(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']]);
  });

  it('returns no batches for an empty list', () => {
    expect(employeeIdBatches([], 80)).toEqual([]);
  });

  it.each([
    [0, []],
    [1, [1]],
    [80, [80]],
    [81, [80, 1]],
    [161, [80, 80, 1]],
  ] as const)('keeps order for %i ids in chunks %j', (count, sizes) => {
    const ids = Array.from({ length: count }, (_, index) => index.toString(16).padStart(3, '0'));
    const batches = employeeIdBatches(ids, 80);
    expect(batches.map((batch) => batch.length)).toEqual([...sizes]);
    expect(batches.flat()).toEqual(ids);
  });
});
