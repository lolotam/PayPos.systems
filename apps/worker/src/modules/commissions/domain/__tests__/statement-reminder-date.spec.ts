import { describe, expect, it } from 'vitest';

import {
  businessLocalMoment,
  previousPeriod,
  reminderDate,
  reminderDayFor,
  REMINDER_START_MINUTES,
} from '../statement-reminder-date.ts';

describe('businessLocalMoment', () => {
  it('reads the local date and minutes of the business timezone', () => {
    const moment = businessLocalMoment(new Date('2026-11-03T06:00:00Z'), 'Asia/Kuwait');
    expect(moment).toEqual({ year: 2026, month: 11, day: 3, minutes: 540 });
  });

  it('reads the day across the UTC boundary of the business timezone', () => {
    const moment = businessLocalMoment(new Date('2026-11-04T21:30:00Z'), 'Asia/Kuwait');
    expect(moment.day).toBe(5);
    expect(moment.minutes).toBe(30);
  });

  it('reads a timezone behind UTC on the previous local day', () => {
    const moment = businessLocalMoment(new Date('2026-11-03T02:00:00Z'), 'America/New_York');
    expect(moment.day).toBe(2);
    expect(moment.month).toBe(11);
  });
});

describe('reminderDayFor', () => {
  it('acts on the third and the fifth after nine in the morning', () => {
    expect(reminderDayFor({ year: 2026, month: 11, day: 3, minutes: 540 })).toBe(3);
    expect(reminderDayFor({ year: 2026, month: 11, day: 5, minutes: 540 })).toBe(5);
  });

  it('waits for nine in the morning', () => {
    expect(reminderDayFor({ year: 2026, month: 11, day: 3, minutes: 539 })).toBeNull();
  });

  it('ignores the other days of the month', () => {
    expect(reminderDayFor({ year: 2026, month: 11, day: 4, minutes: 600 })).toBeNull();
    expect(reminderDayFor({ year: 2026, month: 11, day: 6, minutes: 600 })).toBeNull();
  });

  it('starts at nine in the morning', () => {
    expect(REMINDER_START_MINUTES).toBe(540);
  });
});

describe('previousPeriod', () => {
  it('targets the month before', () => {
    expect(previousPeriod(2026, 11)).toBe('2026-10');
  });

  it('crosses the year boundary', () => {
    expect(previousPeriod(2026, 1)).toBe('2025-12');
  });
});

describe('reminderDate', () => {
  it('formats the local date without any timezone shift', () => {
    expect(reminderDate({ year: 2026, month: 11, day: 3, minutes: 540 })).toBe('2026-11-03');
  });
});
