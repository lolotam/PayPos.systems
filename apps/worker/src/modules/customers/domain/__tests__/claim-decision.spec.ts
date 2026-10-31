import { describe, expect, it } from 'vitest';

import { decideClaim, type StoredClaimSchedule } from '../claim-decision.ts';
import { ratingSchedule } from '../rating-schedule.ts';
import type { ActiveLine, BranchSchedule, DaySession } from '../sessions-of-day.ts';

const place: BranchSchedule = {
  timeZone: 'Asia/Kuwait',
  openingHours: [{ weekday: 1, intervals: [{ opens: '09:00', closes: '22:00' }] }],
};

function line(
  lineId: string,
  sessionId: string,
  occurredAt: string,
  performers: readonly string[],
): ActiveLine {
  return {
    lineId,
    sessionId,
    branchId: 'branch-1',
    occurredAt: new Date(occurredAt),
    recordedAt: new Date(occurredAt),
    businessTimezone: 'Asia/Kuwait',
    performers: performers.map((employeeId) => ({ employeeId, shareBps: 10_000 })),
  };
}

function session(
  sessionId: string,
  occurredAt: string,
  lines: readonly ActiveLine[],
): DaySession {
  return {
    sessionId,
    branchId: 'branch-1',
    occurredAt: new Date(occurredAt),
    recordedAt: new Date(occurredAt),
    lines,
  };
}

function storedOf(sessionOfDay: DaySession): StoredClaimSchedule {
  const schedule = ratingSchedule(sessionOfDay, place.openingHours, place.timeZone);
  return { branchId: 'branch-1', dueAt: schedule.dueAt, sendDeadline: schedule.sendDeadline };
}

const visitedAt = '2026-10-05T12:10:00Z';
const daySession = session('one', visitedAt, [line('line-one', 'one', visitedAt, ['employee-1'])]);
const stored = storedOf(daySession);
const places = new Map([['branch-1', place]]);

describe('claim decision', () => {
  it.each([
    {
      title: 'cancels the request when the rating switch is off',
      switchEnabled: false,
      optedOutAt: null,
      stored,
      sessions: [daySession],
      now: new Date('2026-10-05T13:30:00Z'),
      expected: { kind: 'REQUESTS_OFF' },
    },
    {
      title: 'cancels the request when the customer opted out',
      switchEnabled: true,
      optedOutAt: new Date('2026-10-05T13:00:00Z'),
      stored,
      sessions: [daySession],
      now: new Date('2026-10-05T13:30:00Z'),
      expected: { kind: 'OPTED_OUT' },
    },
    {
      title: 'cancels the request when its deadline passed',
      switchEnabled: true,
      optedOutAt: null,
      stored,
      sessions: [daySession],
      now: new Date('2026-10-05T19:30:01Z'),
      expected: { kind: 'PAST_DEADLINE' },
    },
    {
      title: 'leaves the request alone before it is due',
      switchEnabled: true,
      optedOutAt: null,
      stored,
      sessions: [daySession],
      now: new Date('2026-10-05T13:09:00Z'),
      expected: { kind: 'NOT_DUE' },
    },
    {
      title: 'cancels the request when the day has no active line',
      switchEnabled: true,
      optedOutAt: null,
      stored,
      sessions: [],
      now: new Date('2026-10-05T13:30:00Z'),
      expected: { kind: 'NO_ACTIVE_LINE' },
    },
  ])('$title', ({ switchEnabled, optedOutAt, stored: storedRow, sessions, now, expected }) => {
    expect(
      decideClaim({
        now,
        switchEnabled,
        optedOutAt,
        stored: storedRow,
        sessions,
        placeByBranch: places,
      }),
    ).toEqual(expected);
  });

  it('claims the request with the performers of its own day', () => {
    const lines = [
      line('line-one', 'one', visitedAt, ['employee-1']),
      line('line-two', 'one', visitedAt, ['employee-2', 'employee-1']),
    ];
    const visit = session('one', visitedAt, lines);
    expect(
      decideClaim({
        now: new Date('2026-10-05T13:30:00Z'),
        switchEnabled: true,
        optedOutAt: null,
        stored: storedOf(visit),
        sessions: [visit],
        placeByBranch: places,
      }),
    ).toEqual({ kind: 'CLAIM', performers: ['employee-1', 'employee-2'] });
  });

  it('reschedules the request when a newer session moved its due time', () => {
    const newer = session('two', '2026-10-05T13:40:00Z', [
      line('line-two', 'two', '2026-10-05T13:40:00Z', ['employee-2']),
    ]);
    const decision = decideClaim({
      now: new Date('2026-10-05T13:45:00Z'),
      switchEnabled: true,
      optedOutAt: null,
      stored,
      sessions: [daySession, newer],
      placeByBranch: places,
    });
    expect(decision.kind).toBe('RESCHEDULED');
    expect(decision.kind === 'RESCHEDULED' ? decision.schedule.dueAt.toISOString() : '').toBe(
      '2026-10-05T14:40:00Z',
    );
  });
});
