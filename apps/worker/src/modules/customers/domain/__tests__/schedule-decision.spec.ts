import { expect, it } from 'vitest';
import { decideRequest } from '../schedule-decision.ts';
import type { BranchSchedule, DaySession } from '../sessions-of-day.ts';

function session(sessionId: string, branchId: string, occurredAt: string): DaySession {
  return {
    sessionId,
    branchId,
    occurredAt: new Date(occurredAt),
    recordedAt: new Date(occurredAt),
    lines: [],
  };
}

function hours(closes: string): BranchSchedule {
  return {
    timeZone: 'Asia/Kuwait',
    openingHours: [{ weekday: 1, intervals: [{ opens: '09:00', closes }] }],
  };
}

it('returns NO_ACTIVE_LINE for an empty day', () => {
  expect(decideRequest([], new Map(), new Date('2026-10-05T12:00:00Z'))).toEqual({
    kind: 'NO_ACTIVE_LINE',
  });
});

it('schedules one session from its branch closing time', () => {
  const sessions = [session('one', 'branch-1', '2026-10-05T12:10:00Z')];
  const places = new Map([['branch-1', hours('22:00')]]);
  expect(decideRequest(sessions, places, new Date('2026-10-05T12:30:00Z'))).toEqual({
    kind: 'SCHEDULED',
    branchId: 'branch-1',
    dueAt: new Date('2026-10-05T13:10:00Z'),
    sendDeadline: new Date('2026-10-05T19:30:00Z'),
  });
});

it('RT-01 moves the schedule to the later session branch and its earlier close', () => {
  const sessions = [
    session('first', 'branch-1', '2026-10-05T12:10:00Z'),
    session('second', 'branch-2', '2026-10-05T14:00:00Z'),
  ];
  const places = new Map([
    ['branch-1', hours('22:00')],
    ['branch-2', hours('18:00')],
  ]);
  expect(decideRequest(sessions, places, new Date('2026-10-05T14:30:00Z'))).toEqual({
    kind: 'SCHEDULED',
    branchId: 'branch-2',
    dueAt: new Date('2026-10-05T15:00:00Z'),
    sendDeadline: new Date('2026-10-05T15:30:00Z'),
  });
});

it('returns PAST_DEADLINE only when now is strictly after the deadline', () => {
  const sessions = [session('one', 'branch-1', '2026-10-05T12:10:00Z')];
  const places = new Map([['branch-1', hours('22:00')]]);
  expect(decideRequest(sessions, places, new Date('2026-10-05T19:30:01Z'))).toEqual({
    kind: 'PAST_DEADLINE',
  });
});

it('keeps a deadline exactly equal to now open', () => {
  const sessions = [session('one', 'branch-1', '2026-10-05T12:10:00Z')];
  const places = new Map([['branch-1', hours('22:00')]]);
  const decision = decideRequest(sessions, places, new Date('2026-10-05T19:30:00Z'));
  expect(decision.kind).toBe('SCHEDULED');
});

it('never expires a branch without opening hours', () => {
  const sessions = [session('one', 'branch-1', '2026-10-05T12:10:00Z')];
  const places = new Map([['branch-1', { openingHours: null, timeZone: 'Asia/Kuwait' }]]);
  const decision = decideRequest(sessions, places, new Date('2030-01-01T00:00:00Z'));
  expect(decision).toEqual({
    kind: 'SCHEDULED',
    branchId: 'branch-1',
    dueAt: new Date('2026-10-05T13:10:00Z'),
    sendDeadline: null,
  });
});

it('throws when the latest session branch has no schedule', () => {
  const sessions = [session('one', 'missing', '2026-10-05T12:10:00Z')];
  expect(() => decideRequest(sessions, new Map(), new Date('2026-10-05T12:30:00Z'))).toThrowError(
    new RangeError('BRANCH_SCHEDULE_MISSING'),
  );
});
