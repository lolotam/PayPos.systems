import { expect, it } from 'vitest';
import type { OpeningHoursValue } from '../opening-hours.ts';
import { RATING_DELAY_MS, ratingSchedule, SEND_GRACE_MS } from '../rating-schedule.ts';

const KUWAIT = 'Asia/Kuwait';

const mondayHours: OpeningHoursValue = [
  { weekday: 1, intervals: [{ opens: '09:00', closes: '22:00' }] },
];

function expectSchedule(
  occurredAt: string,
  hours: OpeningHoursValue | null,
  timeZone: string,
  dueAt: string,
  sendDeadline: string | null,
) {
  const result = ratingSchedule({ occurredAt: new Date(occurredAt) }, hours, timeZone);
  expect(result.dueAt.toISOString()).toBe(dueAt);
  expect(result.sendDeadline?.toISOString() ?? null).toBe(sendDeadline);
}

it('RT-01 schedules one hour after a 15:10 visit with a deadline 30 minutes after close', () => {
  expectSchedule(
    '2026-10-05T12:10:00Z',
    mondayHours,
    KUWAIT,
    '2026-10-05T13:10:00.000Z',
    '2026-10-05T19:30:00.000Z',
  );
});

it('RT-02 caps a 21:30 visit at the 22:00 close', () => {
  expectSchedule(
    '2026-10-05T18:30:00Z',
    mondayHours,
    KUWAIT,
    '2026-10-05T19:00:00.000Z',
    '2026-10-05T19:30:00.000Z',
  );
});

it('RT-06 makes a visit after the close due at the close, already before the visit', () => {
  expectSchedule(
    '2026-10-05T19:15:00Z',
    mondayHours,
    KUWAIT,
    '2026-10-05T19:00:00.000Z',
    '2026-10-05T19:30:00.000Z',
  );
});

it('uses the last close of a split day', () => {
  const hours: OpeningHoursValue = [
    {
      weekday: 1,
      intervals: [
        { opens: '10:00', closes: '13:00' },
        { opens: '16:00', closes: '22:00' },
      ],
    },
  ];
  expectSchedule(
    '2026-10-05T12:10:00Z',
    hours,
    KUWAIT,
    '2026-10-05T13:10:00.000Z',
    '2026-10-05T19:30:00.000Z',
  );
});

it('uses the 02:00 close of an overnight interval start day', () => {
  const hours: OpeningHoursValue = [
    { weekday: 1, intervals: [{ opens: '18:00', closes: '02:00' }] },
  ];
  expectSchedule(
    '2026-10-05T20:00:00Z',
    hours,
    KUWAIT,
    '2026-10-05T21:00:00.000Z',
    '2026-10-05T23:30:00.000Z',
  );
});

it('uses visit plus one hour and no deadline with null or empty hours', () => {
  for (const hours of [null, []] as const) {
    expectSchedule('2026-10-05T12:10:00Z', hours, KUWAIT, '2026-10-05T13:10:00.000Z', null);
  }
});

it('has no close time on a closed weekday, so ratingSchedule gives no deadline', () => {
  expectSchedule('2026-10-06T12:00:00Z', mondayHours, KUWAIT, '2026-10-06T13:00:00.000Z', null);
});

it('uses Dubai closing time rather than assuming UTC+3', () => {
  expectSchedule(
    '2026-10-05T11:10:00Z',
    mondayHours,
    'Asia/Dubai',
    '2026-10-05T12:10:00.000Z',
    '2026-10-05T18:30:00.000Z',
  );
});

it('exports the one-hour delay and thirty-minute grace in milliseconds', () => {
  expect(RATING_DELAY_MS).toBe(3_600_000);
  expect(SEND_GRACE_MS).toBe(1_800_000);
});
