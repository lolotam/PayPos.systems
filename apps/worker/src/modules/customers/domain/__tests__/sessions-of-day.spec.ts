import { expect, it } from 'vitest';
import type { ActiveLine, BranchSchedule } from '../sessions-of-day.ts';
import { dayWindow, sessionsOfDay } from '../sessions-of-day.ts';

function line(
  sessionId: string,
  lineId: string,
  occurredAt: string,
  branchId = 'branch-1',
  recordedAt = occurredAt,
): ActiveLine {
  return {
    lineId,
    sessionId,
    branchId,
    occurredAt: new Date(occurredAt),
    recordedAt: new Date(recordedAt),
    businessTimezone: 'UTC',
    performers: [{ employeeId: 'employee-1', shareBps: 10_000 }],
  };
}

function places(schedule: BranchSchedule): ReadonlyMap<string, BranchSchedule> {
  return new Map([
    ['branch-1', schedule],
    ['branch-2', schedule],
  ]);
}

it('groups lines into sessions, sorts them, and leaves the latest session last', () => {
  const lines = [
    line('session-2', 'line-2a', '2026-10-05T12:00:00Z'),
    line('session-1', 'line-1', '2026-10-05T10:00:00Z'),
    line('session-2', 'line-2b', '2026-10-05T08:00:00Z'),
  ];
  const result = sessionsOfDay(
    lines,
    places({ openingHours: null, timeZone: 'Asia/Kuwait' }),
    '2026-10-05',
  );
  expect(result.map((session) => session.sessionId)).toEqual(['session-1', 'session-2']);
  expect(result.at(-1)?.lines.map((entry) => entry.lineId)).toEqual(['line-2a', 'line-2b']);
  expect(result.at(-1)?.occurredAt.toISOString()).toBe('2026-10-05T12:00:00.000Z');
  expect(result.at(-1)?.recordedAt.toISOString()).toBe('2026-10-05T12:00:00.000Z');
});

it('uses sessionId to order sessions with the same occurredAt', () => {
  const lines = [
    line('session-b', 'line-b', '2026-10-05T10:00:00Z'),
    line('session-a', 'line-a', '2026-10-05T10:00:00Z'),
  ];
  const result = sessionsOfDay(
    lines,
    places({ openingHours: null, timeZone: 'Asia/Kuwait' }),
    '2026-10-05',
  );
  expect(result.map((session) => session.sessionId)).toEqual(['session-a', 'session-b']);
});

it('drops a late-entry session', () => {
  const schedule: BranchSchedule = {
    timeZone: 'Asia/Kuwait',
    openingHours: [{ weekday: 1, intervals: [{ opens: '09:00', closes: '22:00' }] }],
  };
  const lines = [
    line('late', 'late-line', '2026-10-05T18:00:00Z', 'branch-1', '2026-10-05T19:31:00Z'),
  ];
  expect(sessionsOfDay(lines, places(schedule), '2026-10-05')).toEqual([]);
});

it('drops a session whose overnight request day differs', () => {
  const schedule: BranchSchedule = {
    timeZone: 'Asia/Kuwait',
    openingHours: [{ weekday: 1, intervals: [{ opens: '18:00', closes: '02:00' }] }],
  };
  const lines = [line('tail', 'tail-line', '2026-10-05T21:30:00Z')];
  expect(sessionsOfDay(lines, places(schedule), '2026-10-06')).toEqual([]);
});

it('separates the two-branch midnight case using each branch timezone', () => {
  const lines = [
    line('kuwait', 'kuwait-line', '2026-10-05T20:30:00Z', 'branch-1'),
    line('dubai', 'dubai-line', '2026-10-05T20:10:00Z', 'branch-2'),
  ];
  const placeByBranch = new Map<string, BranchSchedule>([
    ['branch-1', { openingHours: null, timeZone: 'Asia/Kuwait' }],
    ['branch-2', { openingHours: null, timeZone: 'Asia/Dubai' }],
  ]);
  const onKuwaitDay = sessionsOfDay(lines, placeByBranch, '2026-10-05');
  const onDubaiDay = sessionsOfDay(lines, placeByBranch, '2026-10-06');
  expect(onKuwaitDay.map((session) => session.sessionId)).toEqual(['kuwait']);
  expect(onDubaiDay.map((session) => session.sessionId)).toEqual(['dubai']);
});

it('throws the stable error when a branch schedule is missing', () => {
  const lines = [line('session', 'line', '2026-10-05T10:00:00Z')];
  expect(() => sessionsOfDay(lines, new Map(), '2026-10-05')).toThrowError(
    new RangeError('BRANCH_SCHEDULE_MISSING'),
  );
});

it('dayWindow covers UTC+14 through the overnight tail at UTC-12', () => {
  const window = dayWindow('2026-10-05');
  expect(window.from.toISOString()).toBe('2026-10-04T10:00:00.000Z');
  expect(window.to.toISOString()).toBe('2026-10-07T12:00:00.000Z');
});
