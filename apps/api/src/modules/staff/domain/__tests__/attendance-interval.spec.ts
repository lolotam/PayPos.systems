import { expect, it } from 'vitest';
import { attendanceIntervalRefused } from '../attendance-interval.ts';

const now = new Date('2026-10-10T20:00:00Z');
const start = new Date('2026-10-10T04:00:00Z');
const neighbour = {
  id: 'other',
  clock_in: '2026-10-10T05:00:00Z',
  clock_out: '2026-10-10T06:00:00Z',
};
it.each([0, -1, 16 * 3600000 + 1])('refuses invalid duration %s', (duration) => {
  expect(attendanceIntervalRefused(start, new Date(+start + duration), now, [], null)).toBe(true);
});
it('allows exactly sixteen hours and refuses either future endpoint', () => {
  expect(attendanceIntervalRefused(start, now, now, [], null)).toBe(false);
  expect(attendanceIntervalRefused(start, new Date(+now + 1), now, [], null)).toBe(true);
  expect(attendanceIntervalRefused(new Date(+now + 1), new Date(+now + 2), now, [], null)).toBe(
    true,
  );
});
it('allows touching ends, excludes itself, and refuses closed and open overlap', () => {
  expect(
    attendanceIntervalRefused(start, new Date(neighbour.clock_in), now, [neighbour], null),
  ).toBe(false);
  expect(
    attendanceIntervalRefused(new Date(neighbour.clock_out), now, now, [neighbour], null),
  ).toBe(false);
  expect(attendanceIntervalRefused(start, now, now, [neighbour], null)).toBe(true);
  expect(attendanceIntervalRefused(start, now, now, [neighbour], 'other')).toBe(false);
  expect(
    attendanceIntervalRefused(
      new Date('2026-10-10T19:00:00Z'),
      now,
      now,
      [{ ...neighbour, clock_out: null }],
      null,
    ),
  ).toBe(true);
});
