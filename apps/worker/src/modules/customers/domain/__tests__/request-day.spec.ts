import { describe, expect, it } from 'vitest';
import type { OpeningHoursValue } from '../opening-hours.ts';
import { dayClose, dayEnd, requestDayOf } from '../request-day.ts';

const KUWAIT = 'Asia/Kuwait';

const overnight: OpeningHoursValue = [
  { weekday: 1, intervals: [{ opens: '18:00', closes: '02:00' }] },
];

const splitDay: OpeningHoursValue = [
  {
    weekday: 1,
    intervals: [
      { opens: '10:00', closes: '13:00' },
      { opens: '16:00', closes: '22:00' },
    ],
  },
];

describe('requestDayOf', () => {
  it('uses the branch-local calendar date by default', () => {
    expect(requestDayOf(new Date('2026-10-05T09:00:00Z'), KUWAIT, splitDay)).toBe('2026-10-05');
  });

  it('keeps the earlier-instant Dubai visit on a different day from the Kuwait visit', () => {
    const hours: OpeningHoursValue = [
      { weekday: 1, intervals: [{ opens: '09:00', closes: '22:00' }] },
      { weekday: 2, intervals: [{ opens: '09:00', closes: '22:00' }] },
    ];
    const kuwaitVisit = new Date('2026-10-05T20:30:00Z');
    const dubaiVisitTwentyMinutesEarlier = new Date('2026-10-05T20:10:00Z');
    expect(requestDayOf(kuwaitVisit, KUWAIT, hours)).toBe('2026-10-05');
    expect(requestDayOf(dubaiVisitTwentyMinutesEarlier, 'Asia/Dubai', hours)).toBe('2026-10-06');
  });

  it('keeps a 23:00 visit on its own overnight start day', () => {
    expect(requestDayOf(new Date('2026-10-05T20:00:00Z'), KUWAIT, overnight)).toBe('2026-10-05');
  });

  it('assigns a strictly-before-close overnight tail visit to the previous day', () => {
    expect(requestDayOf(new Date('2026-10-05T21:30:00Z'), KUWAIT, overnight)).toBe('2026-10-05');
  });

  it('assigns a visit exactly at the overnight close to its own calendar date', () => {
    expect(requestDayOf(new Date('2026-10-05T23:00:00Z'), KUWAIT, overnight)).toBe('2026-10-06');
  });

  it('uses the local date within either interval of a split day', () => {
    expect(requestDayOf(new Date('2026-10-05T08:00:00Z'), KUWAIT, splitDay)).toBe('2026-10-05');
    expect(requestDayOf(new Date('2026-10-05T17:00:00Z'), KUWAIT, splitDay)).toBe('2026-10-05');
  });

  it('uses the local calendar date for null and empty hours', () => {
    const at = new Date('2026-10-05T20:30:00Z');
    expect(requestDayOf(at, KUWAIT, null)).toBe('2026-10-05');
    expect(requestDayOf(at, KUWAIT, [])).toBe('2026-10-05');
  });
});

describe('dayClose and dayEnd', () => {
  it('uses the last close of a split day', () => {
    expect(dayClose('2026-10-05', KUWAIT, splitDay)?.toISOString()).toBe(
      '2026-10-05T19:00:00.000Z',
    );
  });

  it('moves an overnight close to the civil day after its start day', () => {
    expect(dayClose('2026-10-05', KUWAIT, overnight)?.toISOString()).toBe(
      '2026-10-05T23:00:00.000Z',
    );
  });

  it('returns null for null hours, empty hours, and a closed weekday', () => {
    expect(dayClose('2026-10-05', KUWAIT, null)).toBeNull();
    expect(dayClose('2026-10-05', KUWAIT, [])).toBeNull();
    expect(dayClose('2026-10-06', KUWAIT, splitDay)).toBeNull();
  });

  it('ends a day without a close at the next branch-local midnight', () => {
    expect(dayEnd('2026-10-05', KUWAIT, null).toISOString()).toBe('2026-10-05T21:00:00.000Z');
    expect(dayEnd('2026-10-06', KUWAIT, splitDay).toISOString()).toBe('2026-10-06T21:00:00.000Z');
  });

  it('uses the overnight close rather than midnight as the day end', () => {
    expect(dayEnd('2026-10-05', KUWAIT, overnight).toISOString()).toBe('2026-10-05T23:00:00.000Z');
  });
});
