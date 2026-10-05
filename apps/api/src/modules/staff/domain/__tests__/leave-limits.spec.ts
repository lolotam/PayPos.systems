import { describe, expect, it } from 'vitest';
import { materializeLeave } from '../leave-period.ts';
import type { LeaveTerms } from '../leave-types.ts';

const now = new Date('2026-01-01T00:00:00Z');
const zones = ['Asia/Kuwait', 'America/New_York'];
const boundaries = [
  { from: '2026-01-01', to: '2026-03-30', days: 89 },
  { from: '2026-01-01', to: '2026-03-31', days: 90 },
  { from: '2026-01-01', to: '2026-04-01', days: 91 },
  { from: '2026-09-01', to: '2026-11-28', days: 89 },
  { from: '2026-09-01', to: '2026-11-29', days: 90 },
  { from: '2026-09-01', to: '2026-11-30', days: 91 },
  { from: '2028-01-01', to: '2028-03-29', days: 89 },
  { from: '2028-01-01', to: '2028-03-30', days: 90 },
  { from: '2028-01-01', to: '2028-03-31', days: 91 },
];
const partial: LeaveTerms = {
  kind: 'PARTIAL',
  type: 'ANNUAL',
  date: '2026-10-04',
  start: '09:00',
  end: '11:00',
};

describe.each(zones)('settled leave limits in %s', (zone) => {
  it.each(boundaries)(
    'counts $days inclusive civil days from $from to $to',
    ({ from, to, days }) => {
      const input: LeaveTerms = { kind: 'FULL_DAY', type: 'SICK', from, to };
      if (days === 91) {
        expect(() => materializeLeave(input, zone, now, false)).toThrow('LEAVE_SPAN_TOO_LONG');
        return;
      }
      const result = materializeLeave(input, zone, now, false);
      expect([result.from, result.to]).toEqual([from, to]);
      const dstHours = zone === 'Asia/Kuwait' ? 0 : from.endsWith('09-01') ? 1 : -1;
      expect((Date.parse(result.ends_at) - Date.parse(result.starts_at)) / 3_600_000).toBe(
        days * 24 + dstHours,
      );
    },
  );
  describe.each(['start', 'end'] as const)('%s minute granularity', (endpoint) => {
    it.each(Array.from({ length: 60 }, (_, minute) => minute))(
      'checks local minute %i',
      (minute) => {
        const input = {
          ...partial,
          [endpoint]: `${endpoint === 'start' ? '09' : '10'}:${String(minute).padStart(2, '0')}`,
        };
        if (minute % 15 === 0)
          expect(materializeLeave(input, zone, now, false)[endpoint]).toBe(input[endpoint]);
        else
          expect(() => materializeLeave(input, zone, now, false)).toThrow(
            'LEAVE_TIME_STEP_INVALID',
          );
      },
    );
  });
  it('accepts midnight and the last quarter-hour of the same date', () => {
    expect(
      materializeLeave({ ...partial, start: '00:00', end: '23:45' }, zone, now, false).end,
    ).toBe('23:45');
    expect(() =>
      materializeLeave({ ...partial, start: '00:00', end: '23:59' }, zone, now, false),
    ).toThrow('LEAVE_TIME_STEP_INVALID');
  });
});

it.each([
  { date: '2026-03-08', start: '01:00', end: '03:15', minutes: 75 },
  { date: '2026-11-01', start: '00:00', end: '02:15', minutes: 195 },
])('accepts local quarter-hours across DST on $date', ({ date, start, end, minutes }) => {
  const result = materializeLeave({ ...partial, date, start, end }, 'America/New_York', now, false);
  expect((Date.parse(result.ends_at) - Date.parse(result.starts_at)) / 60_000).toBe(minutes);
});
it.each(['2026-03-08', '2026-11-01'])('checks granularity before DST ambiguity on %s', (date) => {
  const start = date.endsWith('03-08') ? '02:07' : '01:07';
  expect(() =>
    materializeLeave({ ...partial, date, start, end: '03:30' }, 'America/New_York', now, false),
  ).toThrow('LEAVE_TIME_STEP_INVALID');
});
