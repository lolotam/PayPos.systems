import { expect, it } from 'vitest';

import { attendanceQrDay } from '../attendance-qr-day.ts';
import { attendanceQrSecretScope, attendanceQrWindow } from '../attendance-qr.ts';

const ordinal = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

it.each([
  ['2026-10-02T20:59:59.999Z', '2026-10-02', '2026-10-02T21:01:00Z'],
  ['2026-10-02T21:00:00.000Z', '2026-10-03', '2026-10-03T21:01:00Z'],
  ['2026-10-02T23:59:59.999Z', '2026-10-03', '2026-10-03T21:01:00Z'],
])('Kuwait local midnight at %s uses %s', (instant, date, expiry) => {
  expect(attendanceQrDay(Date.parse(instant), 'Asia/Kuwait')).toEqual({
    day: ordinal(date),
    retainUntil: Date.parse(expiry),
  });
});

it.each([
  ['2026-03-08T05:00:00Z', '2026-03-08', '2026-03-09T04:01:00Z'],
  ['2026-03-08T06:59:59.999Z', '2026-03-08', '2026-03-09T04:01:00Z'],
  ['2026-03-08T07:00:00Z', '2026-03-08', '2026-03-09T04:01:00Z'],
  ['2026-11-01T04:00:00Z', '2026-11-01', '2026-11-02T05:01:00Z'],
  ['2026-11-01T05:59:59.999Z', '2026-11-01', '2026-11-02T05:01:00Z'],
  ['2026-11-01T06:00:00Z', '2026-11-01', '2026-11-02T05:01:00Z'],
  ['2026-11-02T04:59:59.999Z', '2026-11-01', '2026-11-02T05:01:00Z'],
  ['2026-11-02T05:00:00Z', '2026-11-02', '2026-11-03T05:01:00Z'],
])('New York DST at %s retains until local midnight plus tolerance', (instant, date, expiry) => {
  expect(attendanceQrDay(Date.parse(instant), 'America/New_York')).toEqual({
    day: ordinal(date),
    retainUntil: Date.parse(expiry),
  });
});

it('uses branch override, then business timezone, then the Kuwait default', () => {
  const instant = Date.parse('2026-10-02T21:00:00Z');
  expect(attendanceQrDay(instant, 'Asia/Kuwait', 'America/New_York').day).toBe(
    ordinal('2026-10-03'),
  );
  expect(attendanceQrDay(instant, null, 'America/New_York').day).toBe(ordinal('2026-10-02'));
  expect(attendanceQrDay(instant, undefined, 'America/New_York')).toEqual(
    attendanceQrDay(instant, 'America/New_York'),
  );
  expect(attendanceQrDay(instant, null, null)).toEqual(attendanceQrDay(instant, 'Asia/Kuwait'));
  expect(attendanceQrDay(instant)).toEqual(attendanceQrDay(instant, 'Asia/Kuwait'));
});

it.each([
  ['Asia/Kuwait', '2026-10-02T21:00:00Z', '2026-10-02', '2026-10-03'],
  ['America/New_York', '2026-03-09T04:00:00Z', '2026-03-08', '2026-03-09'],
  ['America/New_York', '2026-11-02T05:00:00Z', '2026-11-01', '2026-11-02'],
])('window just before midnight in %s retains the old key', (zone, midnight, before, after) => {
  const boundary = Date.parse(midnight);
  const previous = attendanceQrSecretScope(
    'company',
    'branch',
    attendanceQrWindow(boundary) - 1,
    zone,
  );
  const current = attendanceQrSecretScope('company', 'branch', attendanceQrWindow(boundary), zone);
  expect(previous.day).toBe(ordinal(before));
  expect(previous.retainUntil).toBe(boundary + 60_000);
  expect(current.day).toBe(ordinal(after));
});

it.each([-1, NaN, Infinity, 0.1, Number.MAX_SAFE_INTEGER])(
  'rejects invalid instant %s',
  (instant) => {
    expect(() => attendanceQrDay(instant)).toThrow(RangeError);
  },
);

it.each(['', 'synthetic-invalid'])(
  'rejects invalid timezone %s rather than silently using UTC',
  (zone) => {
    expect(() => attendanceQrDay(0, zone)).toThrow(RangeError);
  },
);
