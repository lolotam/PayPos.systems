import { describe, expect, it } from 'vitest';
import { isLateEntry } from '../late-entry.ts';
import type { OpeningHoursValue } from '../opening-hours.ts';

const KUWAIT = 'Asia/Kuwait';
const DAY = '2026-10-05';

const mondayHours: OpeningHoursValue = [
  { weekday: 1, intervals: [{ opens: '09:00', closes: '22:00' }] },
];

describe('isLateEntry', () => {
  it('accepts recording 15 minutes after a 22:00 close', () => {
    expect(isLateEntry(new Date('2026-10-05T19:15:00Z'), DAY, KUWAIT, mondayHours)).toBe(false);
  });

  it('accepts recording exactly 30 minutes after a 22:00 close', () => {
    expect(isLateEntry(new Date('2026-10-05T19:30:00Z'), DAY, KUWAIT, mondayHours)).toBe(false);
  });

  it('rejects recording 31 minutes after a 22:00 close', () => {
    expect(isLateEntry(new Date('2026-10-05T19:31:00Z'), DAY, KUWAIT, mondayHours)).toBe(true);
  });

  it('accepts exactly 30 minutes and rejects 31 minutes after an overnight close', () => {
    const hours: OpeningHoursValue = [
      { weekday: 1, intervals: [{ opens: '18:00', closes: '02:00' }] },
    ];
    expect(isLateEntry(new Date('2026-10-05T23:30:00Z'), DAY, KUWAIT, hours)).toBe(false);
    expect(isLateEntry(new Date('2026-10-05T23:31:00Z'), DAY, KUWAIT, hours)).toBe(true);
  });

  it('uses next local midnight without hours for a 23:50 visit recorded after midnight', () => {
    expect(isLateEntry(new Date('2026-10-05T21:15:00Z'), DAY, KUWAIT, null)).toBe(false);
    expect(isLateEntry(new Date('2026-10-05T21:31:00Z'), DAY, KUWAIT, null)).toBe(true);
  });

  it('ends the day at the branch-local midnight for a missing weekday and for an empty list', () => {
    const missingWeekday: OpeningHoursValue = [
      { weekday: 2, intervals: [{ opens: '09:00', closes: '22:00' }] },
    ];
    const emptyList: OpeningHoursValue = [];
    expect(isLateEntry(new Date('2026-10-05T21:30:00Z'), DAY, KUWAIT, missingWeekday)).toBe(false);
    expect(isLateEntry(new Date('2026-10-05T21:31:00Z'), DAY, KUWAIT, missingWeekday)).toBe(true);
    expect(isLateEntry(new Date('2026-10-05T21:30:00Z'), DAY, KUWAIT, emptyList)).toBe(false);
    expect(isLateEntry(new Date('2026-10-05T21:31:00Z'), DAY, KUWAIT, emptyList)).toBe(true);
  });
});
