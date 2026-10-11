import { expect, it } from 'vitest';
import { attendanceUtc, attendanceLocalTime } from './attendance-local-time';
it.each([
  ['Asia/Kuwait', '2026-10-11T00:30', '2026-10-10T21:30:00.000Z'],
  ['Asia/Kuwait', '2026-10-11T23:30', '2026-10-11T20:30:00.000Z'],
  ['America/New_York', '2026-07-12T00:30', '2026-07-12T04:30:00.000Z'],
  ['America/New_York', '2026-01-12T23:30', '2026-01-13T04:30:00.000Z'],
])('converts %s branch input %s independently of browser timezone', (zone, local, expected) => {
  expect(attendanceUtc(local, zone)).toBe(expected);
  expect(attendanceLocalTime(expected, zone)).toBe(`${local}:00`);
});
it.each(['2026-03-08T02:30', '2026-11-01T01:30'])('rejects a DST gap or fold %s', (value) => {
  expect(attendanceUtc(value, 'America/New_York')).toBe('');
});
it('preserves seconds and rejects invalid civil dates without normalizing them', () => {
  expect(attendanceUtc('2026-10-11T00:30:42', 'Asia/Kuwait')).toBe('2026-10-10T21:30:42.000Z');
  expect(attendanceUtc('2026-02-30T00:30', 'Asia/Kuwait')).toBe('');
  expect(attendanceUtc('', 'Asia/Kuwait')).toBeUndefined();
});
