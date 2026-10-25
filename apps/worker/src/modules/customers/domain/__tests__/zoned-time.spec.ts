import { describe, expect, it } from 'vitest';
import { clockMinutes, crossesMidnight } from '../opening-hours.ts';
import { addCivilDays, instantOf, isoWeekdayOf, localParts } from '../zoned-time.ts';

describe('localParts', () => {
  it('converts the same instant to different Kuwait and Dubai wall-clock days', () => {
    const at = new Date('2026-10-05T20:30:00.000Z');
    expect(localParts(at, 'Asia/Kuwait')).toEqual({
      date: '2026-10-05',
      minutes: 1410,
      isoWeekday: 1,
    });
    expect(localParts(at, 'Asia/Dubai')).toEqual({
      date: '2026-10-06',
      minutes: 30,
      isoWeekday: 2,
    });
  });
});

describe('instantOf', () => {
  it('converts Kuwait and Dubai wall clocks back to UTC', () => {
    expect(instantOf('2026-10-05', 1410, 'Asia/Kuwait').toISOString()).toBe(
      '2026-10-05T20:30:00.000Z',
    );
    expect(instantOf('2026-10-06', 10, 'Asia/Dubai').toISOString()).toBe(
      '2026-10-05T20:10:00.000Z',
    );
  });

  it('accepts minutes beyond midnight as the following civil day', () => {
    expect(instantOf('2026-10-05', 1500, 'Asia/Kuwait').toISOString()).toBe(
      '2026-10-05T22:00:00.000Z',
    );
    expect(instantOf('2026-10-05', 2879, 'Asia/Dubai').toISOString()).toBe(
      '2026-10-06T19:59:00.000Z',
    );
  });

  it('resolves London summer and winter offsets in both directions', () => {
    const summer = instantOf('2026-07-05', 540, 'Europe/London');
    const winter = instantOf('2026-01-05', 540, 'Europe/London');
    expect(summer.toISOString()).toBe('2026-07-05T08:00:00.000Z');
    expect(winter.toISOString()).toBe('2026-01-05T09:00:00.000Z');
    expect(localParts(summer, 'Europe/London').minutes).toBe(540);
    expect(localParts(winter, 'Europe/London').minutes).toBe(540);
  });
});

it('adds positive and negative civil days across month boundaries', () => {
  expect(addCivilDays('2026-10-31', 1)).toBe('2026-11-01');
  expect(addCivilDays('2026-11-01', -1)).toBe('2026-10-31');
});

it('uses ISO weekday numbering for civil dates', () => {
  expect(isoWeekdayOf('2026-10-05')).toBe(1);
  expect(isoWeekdayOf('2026-10-11')).toBe(7);
});

it('converts HH:MM to minutes and identifies only backward closes as overnight', () => {
  expect(clockMinutes('00:00')).toBe(0);
  expect(clockMinutes('23:59')).toBe(1439);
  expect(crossesMidnight({ opens: '18:00', closes: '02:00' })).toBe(true);
  expect(crossesMidnight({ opens: '10:00', closes: '22:00' })).toBe(false);
});
