import { describe, expect, it, vi } from 'vitest';
import { addScheduleDays, scheduleInstant, scheduleToday } from '../schedule-calendar.ts';
import type { WeeklyShiftInput } from '../schedule-types.ts';
import { materializeSchedule } from '../schedules.ts';

const WALL_CLOCK: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
};
const PROBE_HOURS = [-36, -24, -12, 0, 12, 24, 36];

function freshParts(at: number, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', { ...WALL_CLOCK, timeZone: timezone });
  const parts = formatter.formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}
function freshInstant(date: string, time: string, timezone: string): string {
  const wall = `${date}T${time}:00`;
  const nominal = Date.parse(`${wall}Z`);
  const matches = new Set<number>();
  for (const hours of PROBE_HOURS) {
    const sample = nominal + hours * 3_600_000;
    const offset = Date.parse(`${freshParts(sample, timezone)}Z`) - sample;
    const candidate = nominal - offset;
    if (freshParts(candidate, timezone) === wall) matches.add(candidate);
  }
  if (matches.size !== 1) throw new Error('SCHEDULE_LOCAL_TIME_INVALID');
  const [unique] = matches;
  if (unique === undefined) throw new Error('SCHEDULE_LOCAL_TIME_INVALID');
  return new Date(unique).toISOString();
}
function freshToday(now: Date, timezone: string): string {
  return freshParts(now.getTime(), timezone).slice(0, 10);
}

const resolved = [
  ['Asia/Kuwait', '2026-10-03', '00:00', '2026-10-02T21:00:00.000Z'],
  ['Asia/Kuwait', '2026-10-03', '23:59', '2026-10-03T20:59:00.000Z'],
  ['Asia/Kuwait', '2026-12-31', '23:30', '2026-12-31T20:30:00.000Z'],
  ['Asia/Kuwait', '2027-01-01', '00:00', '2026-12-31T21:00:00.000Z'],
  ['Europe/London', '2026-03-28', '12:00', '2026-03-28T12:00:00.000Z'],
  ['Europe/London', '2026-03-29', '00:30', '2026-03-29T00:30:00.000Z'],
  ['Europe/London', '2026-03-29', '02:30', '2026-03-29T01:30:00.000Z'],
  ['Europe/London', '2026-03-29', '03:00', '2026-03-29T02:00:00.000Z'],
  ['Europe/London', '2026-10-24', '12:00', '2026-10-24T11:00:00.000Z'],
  ['Europe/London', '2026-10-25', '00:30', '2026-10-24T23:30:00.000Z'],
  ['Europe/London', '2026-10-25', '02:30', '2026-10-25T02:30:00.000Z'],
  ['Europe/London', '2026-01-31', '23:00', '2026-01-31T23:00:00.000Z'],
  ['Europe/London', '2026-12-31', '23:30', '2026-12-31T23:30:00.000Z'],
  ['Europe/London', '2027-01-01', '00:00', '2027-01-01T00:00:00.000Z'],
  ['Europe/London', '2024-02-29', '12:00', '2024-02-29T12:00:00.000Z'],
] as const;
const refused = [
  ['Europe/London', '2026-03-29', '01:30'],
  ['Europe/London', '2026-10-25', '01:30'],
] as const;
const today = [
  ['2026-10-02T20:59:00.000Z', 'Asia/Kuwait', '2026-10-02'],
  ['2026-10-02T21:00:00.000Z', 'Asia/Kuwait', '2026-10-03'],
  ['2026-03-29T00:30:00.000Z', 'Europe/London', '2026-03-29'],
  ['2026-10-25T00:30:00.000Z', 'Europe/London', '2026-10-25'],
] as const;

describe('cached zone formatting matches a fresh formatter', () => {
  it.each(resolved)(
    'keeps %s %s %s byte-identical across a repeated call',
    (zone, date, time, instant) => {
      const reference = freshInstant(date, time, zone);
      expect(reference).toBe(instant);
      expect(scheduleInstant(date, time, zone)).toBe(reference);
      expect(scheduleInstant(date, time, zone)).toBe(reference);
    },
  );
  it.each(refused)('refuses the %s DST gap or fold at %s %s', (zone, date, time) => {
    expect(() => freshInstant(date, time, zone)).toThrow('SCHEDULE_LOCAL_TIME_INVALID');
    expect(() => scheduleInstant(date, time, zone)).toThrow('SCHEDULE_LOCAL_TIME_INVALID');
    expect(() => scheduleInstant(date, time, zone)).toThrow('SCHEDULE_LOCAL_TIME_INVALID');
  });
  it.each(today)('keeps the civil date of %s in %s on %s', (iso, zone, day) => {
    const now = new Date(iso);
    const reference = freshToday(now, zone);
    expect(reference).toBe(day);
    expect(scheduleToday(now, zone)).toBe(reference);
    expect(scheduleToday(now, zone)).toBe(reference);
  });
  it('still refuses an unknown timezone after the formatter cache', () => {
    expect(() => scheduleInstant('2026-10-03', '09:00', 'invalid')).toThrow(
      'SCHEDULE_LOCAL_TIME_INVALID',
    );
    expect(() => scheduleInstant('2026-10-03', '09:00', 'invalid')).toThrow(
      'SCHEDULE_LOCAL_TIME_INVALID',
    );
  });
});

const WORST_CASE_SHIFTS: WeeklyShiftInput[] = [0, 1, 2, 3, 4, 5, 6].flatMap((day) => [
  { day, start: '00:00', end: '04:00', break_start: '01:00', break_end: '02:00' },
  { day, start: '06:00', end: '10:00', break_start: '07:00', break_end: '08:00' },
  { day, start: '12:00', end: '16:00', break_start: '13:00', break_end: '14:00' },
  { day, start: '18:00', end: '22:00', break_start: '19:00', break_end: '20:00' },
]);

function materializeTenWeeks(zone: string): number {
  let count = 0;
  for (let week = 0; week < 10; week += 1) {
    count += materializeSchedule(
      addScheduleDays('2028-01-01', week * 7),
      WORST_CASE_SHIFTS,
      zone,
      4,
    ).length;
  }
  return count;
}

function constructionsForZone(calls: readonly unknown[][], zone: string): number {
  return calls.filter((args) => {
    const options = args[1];
    return (
      typeof options === 'object' &&
      options !== null &&
      'timeZone' in options &&
      options.timeZone === zone
    );
  }).length;
}

it('constructs at most one DateTimeFormat per zone for 28 shifts across 10 weeks', () => {
  const zone = 'Asia/Riyadh';
  const spy = vi.spyOn(Intl, 'DateTimeFormat');
  try {
    expect(materializeTenWeeks(zone)).toBe(280);
    expect(constructionsForZone(spy.mock.calls, zone)).toBeLessThanOrEqual(1);
    spy.mockClear();
    expect(materializeTenWeeks(zone)).toBe(280);
    expect(constructionsForZone(spy.mock.calls, zone)).toBe(0);
  } finally {
    spy.mockRestore();
  }
});
