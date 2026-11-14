import { describe, expect, it } from 'vitest';

import { localName, percentText, timeLeftParts } from './proposal-display';

describe('proposal-display', () => {
  it.each([
    [2000, '20.00'],
    [50, '0.50'],
    [10000, '100.00'],
    [1, '0.01'],
  ])('percentText maps %i bps to "%s"', (bps, expected) => {
    expect(percentText(bps)).toBe(expected);
  });

  it('timeLeftParts rounds partial minutes up and clamps expired timestamps to zero', () => {
    const now = new Date('2026-11-04T10:00:00.000Z');
    const partialMinute = new Date('2026-11-04T10:01:01.000Z');
    expect(timeLeftParts(partialMinute, now)).toEqual({ hours: 0, minutes: 2 });

    const expired = new Date('2026-11-04T09:50:00.000Z');
    expect(timeLeftParts(expired, now)).toEqual({ hours: 0, minutes: 0 });
  });

  it('localName falls back to English when Arabic is null and uses English for en locale', () => {
    expect(localName('ar', null, 'Haircut')).toBe('Haircut');
    expect(localName('en', 'قص شعر', 'Haircut')).toBe('Haircut');
    expect(localName('ar', 'قص شعر', 'Haircut')).toBe('قص شعر');
  });
});
