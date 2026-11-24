import { describe, expect, it } from 'vitest';

import { periodsFromThrough } from '../period-range.ts';

describe('periodsFromThrough', () => {
  it('lists the months from the source through the current month, ascending, crossing a year', () => {
    expect(periodsFromThrough('2026-11', '2027-02')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });

  it('returns one month when both ends are the same and none when the source is later', () => {
    expect(periodsFromThrough('2026-10', '2026-10')).toEqual(['2026-10']);
    expect(periodsFromThrough('2026-11', '2026-10')).toEqual([]);
  });

  it('rejects a malformed month instead of looping', () => {
    expect(() => periodsFromThrough('2026-13', '2026-12')).toThrow(RangeError);
    expect(() => periodsFromThrough('2026-01', '26-12')).toThrow(RangeError);
  });
});
