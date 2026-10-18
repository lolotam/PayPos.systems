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
});
