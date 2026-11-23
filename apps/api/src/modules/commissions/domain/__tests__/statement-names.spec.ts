import { describe, expect, it } from 'vitest';

import { completeNames, MISSING_NAME_PLACEHOLDER } from '../statement-names.ts';
import { isStatementPeriodEnded } from '../statement-period.ts';

describe('completing the names a statement refers to (D-21)', () => {
  it('returns a name for every requested id, with the placeholder for an id that has no row', () => {
    const found = new Map([['a', 'Sarah']]);
    const names = completeNames(['a', 'b', 'c'], found, MISSING_NAME_PLACEHOLDER);
    expect([...names.keys()]).toEqual(['a', 'b', 'c']);
    expect(names.get('a')).toBe('Sarah');
    expect(names.get('b')).toBe(MISSING_NAME_PLACEHOLDER);
    expect(names.get('c')).toBe(MISSING_NAME_PLACEHOLDER);
  });

  it('never returns null or undefined for a requested id, and never invents an id nobody asked for', () => {
    const names = completeNames(['a'], new Map([['a', 'x'], ['z', 'unrequested']]), '—');
    expect(names.has('z')).toBe(false);
    expect([...names.values()].every((name) => typeof name === 'string')).toBe(true);
  });

  it('completes a structured name with the structured placeholder', () => {
    const placeholder = { nameAr: null, nameEn: MISSING_NAME_PLACEHOLDER };
    const names = completeNames(['branch'], new Map(), placeholder);
    expect(names.get('branch')).toEqual({ nameAr: null, nameEn: MISSING_NAME_PLACEHOLDER });
  });

  it('answers an empty request with an empty map', () => {
    expect(completeNames([], new Map([['a', 'x']]), '—').size).toBe(0);
  });
});

describe('when a statement month has ended (FR-025)', () => {
  it.each([
    ['2026-11', '2026-11-01', false],
    ['2026-11', '2026-11-30', false],
    ['2026-11', '2026-12-01', true],
    ['2027-01', '2026-12-31', false],
    ['2026-12', '2027-01-01', true],
  ])('month %s on local day %s has ended: %s', (period, today, ended) => {
    expect(isStatementPeriodEnded(period, today)).toBe(ended);
  });
});
