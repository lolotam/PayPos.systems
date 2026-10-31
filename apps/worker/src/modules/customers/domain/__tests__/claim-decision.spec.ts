import { describe, expect, it } from 'vitest';

import { decideClaim, type ClaimDecisionInput, type StoredClaimSchedule } from '../claim-decision.ts';
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
  branchId = 'branch-1',
): ActiveLine {
  return {
    lineId,
    sessionId,
    branchId,
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
  branchId = 'branch-1',
): DaySession {
  return {
    sessionId,
    branchId,
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

function decide(overrides: Partial<ClaimDecisionInput> = {}) {
  return decideClaim({
    now: new Date('2026-10-05T13:30:00Z'),
    switchEnabled: true,
    optedOutAt: null,
    stored,
    sessions: [daySession],
    placeByBranch: places,
    ...overrides,
  });
}

describe('claim decision recheck order', () => {
  it('cancels the request when the customer opted out', () => {
    const optedOut = new Date('2026-10-05T13:00:00Z');
    expect(decide({ optedOutAt: optedOut })).toEqual({ kind: 'OPTED_OUT' });
  });

  it('wins the opt-out over the switch that is off', () => {
    const optedOut = new Date('2026-10-05T13:00:00Z');
    const decision = decide({ optedOutAt: optedOut, switchEnabled: false });
    expect(decision).toEqual({ kind: 'OPTED_OUT' });
  });

  it('cancels the request when the rating switch is off', () => {
    expect(decide({ switchEnabled: false })).toEqual({ kind: 'REQUESTS_OFF' });
  });
});

describe('claim decision deadline and due time', () => {
  it('cancels the request when its deadline passed', () => {
    const late = new Date('2026-10-05T19:30:01Z');
    expect(decide({ now: late })).toEqual({ kind: 'PAST_DEADLINE' });
  });

  it('wins the deadline over the day that has no active line', () => {
    const late = new Date('2026-10-05T19:30:01Z');
    expect(decide({ now: late, sessions: [] })).toEqual({ kind: 'PAST_DEADLINE' });
  });

  it('leaves the request alone before it is due', () => {
    const early = new Date('2026-10-05T13:09:00Z');
    expect(decide({ now: early })).toEqual({ kind: 'NOT_DUE' });
  });

  it('cancels the request when the day has no active line', () => {
    expect(decide({ sessions: [] })).toEqual({ kind: 'NO_ACTIVE_LINE' });
  });

  it('cancels the request when the schedule in use has a deadline already past', () => {
    const earlyPlace: BranchSchedule = {
      timeZone: 'Asia/Kuwait',
      openingHours: [{ weekday: 1, intervals: [{ opens: '09:00', closes: '16:00' }] }],
    };
    const early = session(
      'two',
      '2026-10-05T12:45:00Z',
      [line('line-two', 'two', '2026-10-05T12:45:00Z', ['employee-2'], 'branch-2')],
      'branch-2',
    );
    const withEarly = new Map([
      ['branch-1', place],
      ['branch-2', earlyPlace],
    ]);
    const decision = decide({
      now: new Date('2026-10-05T13:45:00Z'),
      sessions: [daySession, early],
      placeByBranch: withEarly,
    });
    expect(decision).toEqual({ kind: 'PAST_DEADLINE' });
  });
});

describe('claim decision when the day moved', () => {
  it('claims the request with the performers of its own day', () => {
    const lines = [
      line('line-one', 'one', visitedAt, ['employee-1']),
      line('line-two', 'one', visitedAt, ['employee-2', 'employee-1']),
    ];
    const visit = session('one', visitedAt, lines);
    const decision = decide({ sessions: [visit], stored: storedOf(visit) });
    expect(decision).toEqual({
      kind: 'CLAIM',
      performers: ['employee-1', 'employee-2'],
      schedule: storedOf(visit),
    });
  });

  it('reschedules the request when a newer session moved its due time', () => {
    const later = '2026-10-05T13:40:00Z';
    const newer = session('two', later, [line('line-two', 'two', later, ['employee-2'])]);
    const decision = decide({ now: new Date('2026-10-05T13:45:00Z'), sessions: [daySession, newer] });
    expect(decision.kind).toBe('RESCHEDULED');
    const moved = decision.kind === 'RESCHEDULED' ? decision.schedule : stored;
    expect(moved.dueAt.toISOString()).toBe('2026-10-05T14:40:00.000Z');
  });

  it('claims with the recomputed schedule when the moved due time already passed', () => {
    const earlier = '2026-10-05T11:00:00Z';
    const only = session('one', earlier, [line('line-one', 'one', earlier, ['employee-1'])]);
    const decision = decide({ now: new Date('2026-10-05T13:00:00Z'), sessions: [only] });
    expect(decision).toEqual({
      kind: 'CLAIM',
      performers: ['employee-1'],
      schedule: {
        branchId: 'branch-1',
        dueAt: new Date('2026-10-05T12:00:00Z'),
        sendDeadline: new Date('2026-10-05T19:30:00Z'),
      },
    });
  });
});
