import { expect, it } from 'vitest';
import { sessionLocalTime, sessionOldestLocal, sessionUtc } from './session-local-time';

it('omits now and converts civil seconds using the business zone', () => {
  expect(sessionUtc('', 'Asia/Kuwait')).toEqual({ instant: undefined });
  expect(sessionUtc('2026-10-15T17:02:03', 'Asia/Kuwait')).toEqual({ instant: '2026-10-15T14:02:03.000Z' });
  expect(sessionLocalTime('2026-10-15T14:02:03.000Z', 'Asia/Kuwait')).toBe('2026-10-15T17:02:03');
  expect(sessionUtc('2026-10-15T17:02', 'Asia/Kuwait')).toEqual({ instant: '2026-10-15T14:02:00.000Z' });
});
it.each(['bad', '2026-02-29T12:00', '2026-04-31T12:00', '2026-10-15T24:00', '2026-10-15T12:60'])('rejects invalid civil input %s', (local) => {
  expect(sessionUtc(local, 'Asia/Kuwait')).toEqual({ error: 'invalidTime' });
});
it.each([
  ['America/New_York', '2026-03-08T02:30', 'nonexistentTime'],
  ['America/New_York', '2026-11-01T01:30', 'ambiguousTime'],
  ['Australia/Lord_Howe', '2026-10-04T02:15', 'nonexistentTime'],
  ['Australia/Lord_Howe', '2026-04-05T01:45', 'ambiguousTime'],
])('rejects %s wall time %s explicitly', (zone, local, error) => {
  expect(sessionUtc(local, zone)).toEqual({ error });
});
it.each([
  ['2026-10-15T08:00:00Z', '2026-09-01T00:00:00'],
  ['2026-01-15T08:00:00Z', '2025-12-01T00:00:00'],
  ['2024-03-31T08:00:00Z', '2024-02-01T00:00:00'],
  ['2026-09-30T21:00:00Z', '2026-09-01T00:00:00'],
])('uses calendar months at the business midnight boundary %s', (now, oldest) => {
  expect(sessionOldestLocal(now, 'Asia/Kuwait')).toBe(oldest);
  expect(sessionUtc(oldest, 'Asia/Kuwait').instant).toBe(new Date(Date.parse(`${oldest}Z`) - 3 * 3_600_000).toISOString());
});
