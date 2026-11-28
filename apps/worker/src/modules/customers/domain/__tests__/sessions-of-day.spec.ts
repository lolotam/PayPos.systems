import { expect, it } from 'vitest';
import type { ActiveLine, BranchSchedule } from '../sessions-of-day.ts';
import {
  dayWindow,
  sessionsOfDay,
  unassignedSessionIdsOfDay,
  withAssignedRequestDays,
} from '../sessions-of-day.ts';

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

it('keeps a session of a branch whose hours miss that weekday', () => {
  const placeByBranch = new Map<string, BranchSchedule>([
    [
      'branch-1',
      {
        timeZone: 'Asia/Kuwait',
        openingHours: [{ weekday: 1, intervals: [{ opens: '09:00', closes: '22:00' }] }],
      },
    ],
    [
      'branch-2',
      {
        timeZone: 'Asia/Kuwait',
        openingHours: [{ weekday: 2, intervals: [{ opens: '09:00', closes: '22:00' }] }],
      },
    ],
  ]);
  const lines = [
    line('open', 'open-line', '2026-10-05T10:00:00Z', 'branch-1'),
    line('missing', 'missing-line', '2026-10-05T11:00:00Z', 'branch-2'),
  ];
  const result = sessionsOfDay(lines, placeByBranch, '2026-10-05');
  expect(result.map((session) => session.sessionId)).toEqual(['open', 'missing']);
});

it('keeps the sessions of a branch without opening hours', () => {
  const lines = [line('session', 'line', '2026-10-05T10:00:00Z')];
  const result = sessionsOfDay(
    lines,
    places({ openingHours: null, timeZone: 'Asia/Kuwait' }),
    '2026-10-05',
  );
  expect(result.map((session) => session.sessionId)).toEqual(['session']);
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

it('PP-286 T-3 (#452): uses persisted requestDay even after overnight opening hours are removed', () => {
  const dayWithoutOvernight: BranchSchedule = {
    timeZone: 'Asia/Kuwait',
    openingHours: [
      { weekday: 1, intervals: [{ opens: '18:00', closes: '23:59' }] },
      { weekday: 2, intervals: [{ opens: '10:00', closes: '22:00' }] },
    ],
  };
  const persistedLine: ActiveLine = {
    ...line('overnight-visit', 'line-1', '2026-10-05T21:15:00Z'),
    requestDay: '2026-10-05',
  };
  expect(sessionsOfDay([persistedLine], places(dayWithoutOvernight), '2026-10-05')).toMatchObject([
    { sessionId: 'overnight-visit', requestDay: '2026-10-05' },
  ]);
  expect(sessionsOfDay([persistedLine], places(dayWithoutOvernight), '2026-10-06')).toEqual([]);
});

it('unassignedSessionIdsOfDay collects same-day unassigned sessions and extraSessionId in sorted order', () => {
  const schedule: BranchSchedule = { timeZone: 'Asia/Kuwait', openingHours: null };
  const lines: ActiveLine[] = [
    line('session-c', 'line-c', '2026-10-05T10:00:00Z'),
    { ...line('session-a', 'line-a', '2026-10-05T09:00:00Z'), requestDay: '2026-10-05' },
    line('session-other', 'line-o', '2026-10-06T10:00:00Z'),
  ];
  expect(unassignedSessionIdsOfDay(lines, places(schedule), '2026-10-05', 'session-b')).toEqual([
    'session-b',
    'session-c',
  ]);
  expect(unassignedSessionIdsOfDay(lines, places(schedule), '2026-10-05', 'session-a')).toEqual([
    'session-c',
  ]);
});

it('withAssignedRequestDays populates requestDay only on previously unassigned sessions', () => {
  const lines: ActiveLine[] = [
    line('session-b', 'line-b', '2026-10-05T10:00:00Z'),
    { ...line('session-a', 'line-a', '2026-10-05T09:00:00Z'), requestDay: '2026-10-04' },
  ];
  const updated = withAssignedRequestDays(
    lines,
    new Map([
      ['session-b', '2026-10-05'],
      ['session-a', '2026-10-05'],
    ]),
  );
  expect(updated[0]?.requestDay).toBe('2026-10-05');
  expect(updated[1]?.requestDay).toBe('2026-10-04');
});

it('PP-286 T-3: keeps an anchored 00:45 overnight visit in sessionsOfDay when hours are cleared and recovers unassigned overnight sessions cleanly', () => {
  const clearedSchedule: BranchSchedule = { timeZone: 'Asia/Kuwait', openingHours: null };
  const anchored0045: ActiveLine = {
    ...line('overnight-0045', 'line-0045', '2026-10-05T21:45:00Z'),
    requestDay: '2026-10-05',
  };
  expect(sessionsOfDay([anchored0045], places(clearedSchedule), '2026-10-05')).toHaveLength(1);

  const legacyUnassigned = line('legacy-0030', 'line-legacy', '2026-10-05T21:30:00Z');
  const postEveningSentNew = line('new-0015', 'line-new', '2026-10-05T21:15:00Z');
  const legacyCoverage = {
    request: {
      businessDate: '2026-10-05',
      branchId: 'branch-1',
      dueAt: new Date('2026-10-05T22:30:00Z'),
      sendDeadline: new Date('2026-10-05T23:30:00Z'),
    },
    requestBranchTimeZone: 'Asia/Kuwait',
  };
  expect(
    unassignedSessionIdsOfDay(
      [legacyUnassigned],
      places(clearedSchedule),
      '2026-10-05',
      undefined,
      legacyCoverage,
    ),
  ).toEqual(['legacy-0030']);
  expect(
    unassignedSessionIdsOfDay(
      [postEveningSentNew],
      places(clearedSchedule),
      '2026-10-05',
      undefined,
      {
        request: {
          businessDate: '2026-10-05',
          branchId: 'branch-1',
          dueAt: new Date('2026-10-05T18:00:00Z'),
          sendDeadline: new Date('2026-10-05T23:30:00Z'),
        },
        requestBranchTimeZone: 'Asia/Kuwait',
      },
    ),
  ).toEqual([]);
});

it('excludes unstamped previous-day overnight visits on the next day and isolates branch-scoped recording cutoffs', () => {
  const clearedSchedule: BranchSchedule = { timeZone: 'Asia/Kuwait', openingHours: null };
  const legacyPrev = line('legacy-0030', 'line-legacy', '2026-10-05T21:30:00Z');
  const nextMorning = line('new-0100', 'line-new', '2026-10-05T22:00:00Z');
  const prevCoverage = {
    previousDayRequest: {
      businessDate: '2026-10-05',
      branchId: 'branch-1',
      dueAt: new Date('2026-10-05T22:30:00Z'),
      sendDeadline: new Date('2026-10-05T23:30:00Z'),
    },
    previousRequestBranchTimeZone: 'Asia/Kuwait',
  };
  expect(
    unassignedSessionIdsOfDay(
      [legacyPrev, nextMorning],
      places(clearedSchedule),
      '2026-10-06',
      undefined,
      prevCoverage,
    ),
  ).toEqual(['new-0100']);
  expect(
    sessionsOfDay([legacyPrev, nextMorning], places(clearedSchedule), '2026-10-06', null, prevCoverage).map(
      (s) => s.sessionId,
    ),
  ).toEqual(['new-0100']);

  const anchored0045Branch1: ActiveLine = {
    ...line('anchored-0045', 'line-1', '2026-10-05T21:45:00Z', 'branch-1', '2026-10-05T22:50:00Z'),
    requestDay: '2026-10-05',
  };
  const lateOtherBranch2: ActiveLine = {
    ...line('late-branch2', 'line-2', '2026-10-05T21:45:00Z', 'branch-2', '2026-10-05T22:45:00Z'),
    requestDay: '2026-10-05',
  };
  expect(
    sessionsOfDay([anchored0045Branch1], places(clearedSchedule), '2026-10-05', {
      branchId: 'branch-1',
      sendDeadline: null,
    }).map((s) => s.sessionId),
  ).toEqual(['anchored-0045']);
  expect(
    sessionsOfDay([lateOtherBranch2], places(clearedSchedule), '2026-10-05', {
      branchId: 'branch-1',
      sendDeadline: new Date('2026-10-05T23:30:00Z'),
    }),
  ).toEqual([]);
});

it('preserves anchored overnight visits when opening hours are cleared to [] or weekday is omitted', () => {
  const anchored0045: ActiveLine = {
    ...line('anchored-0045', 'line-1', '2026-10-05T21:45:00Z', 'branch-1', '2026-10-05T22:50:00Z'),
    requestDay: '2026-10-05',
  };
  const emptyHours: BranchSchedule = { timeZone: 'Asia/Kuwait', openingHours: [] };
  const tuesdayOnly: BranchSchedule = {
    timeZone: 'Asia/Kuwait',
    openingHours: [{ weekday: 2, intervals: [{ opens: '09:00', closes: '22:00' }] }],
  };
  const cutoff = { branchId: 'branch-1', sendDeadline: null };
  expect(sessionsOfDay([anchored0045], places(emptyHours), '2026-10-05', cutoff).map((s) => s.sessionId)).toEqual(['anchored-0045']);
  expect(sessionsOfDay([anchored0045], places(tuesdayOnly), '2026-10-05', cutoff).map((s) => s.sessionId)).toEqual(['anchored-0045']);
});
