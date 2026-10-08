import { expect, it } from 'vitest';
import {
  AttendanceCorrectionError,
  planAttendanceCorrection,
  type AttendanceCorrectionContext,
  type AttendanceCorrectionNeighbour,
  type AttendanceCorrectionRequest,
  type AttendanceCorrectionSession,
} from '../attendance-correction.ts';

const session = (over: Partial<AttendanceCorrectionSession> = {}): AttendanceCorrectionSession => ({
  id: 'session',
  employee_id: 'employee',
  branch_id: 'branch',
  working_date: '2026-10-08',
  timezone: 'Asia/Kuwait',
  clock_in: '2026-10-08T05:00:00.000Z',
  clock_out: '2026-10-08T13:00:00.000Z',
  status: 'CLOSED',
  closed_by: 'EMPLOYEE',
  late_minutes: 40,
  revision: 3,
  scheduled_start: '2026-10-08T05:00:00.000Z',
  ...over,
});
const context = (over: Partial<AttendanceCorrectionContext> = {}): AttendanceCorrectionContext => ({
  now: new Date('2026-10-08T18:00:00.000Z'),
  neighbours: [],
  actorIsEmployee: false,
  actorIsOwner: false,
  ...over,
});
const request = (over: Partial<AttendanceCorrectionRequest> = {}): AttendanceCorrectionRequest => ({
  revision: 3,
  reason: '  fix the scan  ',
  ...over,
});
const plan = (
  row = session(),
  change: Partial<AttendanceCorrectionRequest> = {},
  ctx = context(),
) => planAttendanceCorrection(row, request({ revision: row.revision, ...change }), ctx);
const codeOf = (run: () => void) => {
  try {
    run();
  } catch (error) {
    return error instanceof AttendanceCorrectionError ? error.code : 'OTHER';
  }
  return 'ACCEPTED';
};

it('corrects each field on a closed or missed-out session and keeps that status', () => {
  const closedOut = plan(session(), { clock_out: '2026-10-08T12:00:00.000Z' });
  expect(closedOut).toMatchObject({
    status: 'CLOSED',
    closed_by: 'EMPLOYEE',
    late_minutes: 40,
    revision: 4,
  });
  expect(closedOut.corrections.map((row) => row.field)).toEqual(['CLOCK_OUT']);
  const missed = plan(session({ status: 'MISSED_OUT', closed_by: 'MISSED_OUT' }), {
    clock_in: '2026-10-08T05:20:00.000Z',
    clock_out: '2026-10-08T12:00:00.000Z',
  });
  expect(missed.status).toBe('MISSED_OUT');
  expect(missed.closed_by).toBe('MISSED_OUT');
  expect(missed.corrections.map((row) => row.field)).toEqual(['CLOCK_IN', 'CLOCK_OUT']);
  expect(missed.corrections.every((row) => row.reason === 'fix the scan')).toBe(true);
});

it('refuses an open session after the self rule and before the revision', () => {
  const open = session({ status: 'OPEN', clock_out: null, closed_by: null, revision: 1 });
  const owner = context({ actorIsEmployee: true, actorIsOwner: true });
  expect(
    codeOf(() => plan(open, { revision: 0, clock_out: '2026-10-08T08:00:00.000Z' }, owner)),
  ).toBe('ATTENDANCE_SESSION_OPEN');
  expect(
    codeOf(() => plan(open, { revision: 1, clock_in: '2026-10-08T04:00:00.000Z' }, owner)),
  ).toBe('ATTENDANCE_SESSION_OPEN');
  expect(
    codeOf(() =>
      plan(open, { clock_out: '2026-10-08T08:00:00.000Z' }, context({ actorIsEmployee: true })),
    ),
  ).toBe('ATTENDANCE_CORRECTION_SELF_FORBIDDEN');
});

it('accepts the 16-hour limit and now, and refuses one millisecond past either', () => {
  const row = session({
    clock_in: '2026-10-08T00:00:00.000Z',
    clock_out: '2026-10-08T08:00:00.000Z',
  });
  const atLimit = plan(
    row,
    { clock_out: '2026-10-08T16:00:00.000Z' },
    context({ now: new Date('2026-10-08T16:00:00.000Z') }),
  );
  expect(atLimit.clock_out).toBe('2026-10-08T16:00:00.000Z');
  const later = context({ now: new Date('2026-10-08T17:00:00.000Z') });
  expect(codeOf(() => plan(row, { clock_out: '2026-10-08T16:00:00.001Z' }, later))).toBe(
    'ATTENDANCE_CORRECTION_INVALID_TIMES',
  );
  expect(codeOf(() => plan(session(), { clock_out: '2026-10-08T18:00:00.001Z' }))).toBe(
    'ATTENDANCE_CORRECTION_INVALID_TIMES',
  );
  expect(plan(session(), { clock_out: '2026-10-08T18:00:00.000Z' }).clock_out).toBe(
    '2026-10-08T18:00:00.000Z',
  );
});

it('refuses an overlap, including an open neighbour, and allows touching ends', () => {
  const next: AttendanceCorrectionNeighbour = {
    id: 'next',
    status: 'CLOSED',
    clock_in: '2026-10-08T14:00:00.000Z',
    clock_out: '2026-10-08T15:00:00.000Z',
  };
  const open: AttendanceCorrectionNeighbour = {
    id: 'open',
    status: 'OPEN',
    clock_in: '2026-10-08T14:00:00.000Z',
    clock_out: null,
  };
  expect(
    plan(
      session(),
      { clock_out: '2026-10-08T14:00:00.000Z' },
      context({ neighbours: [next, open] }),
    ).clock_out,
  ).toBe('2026-10-08T14:00:00.000Z');
  expect(
    codeOf(() =>
      plan(session(), { clock_out: '2026-10-08T14:00:00.001Z' }, context({ neighbours: [next] })),
    ),
  ).toBe('ATTENDANCE_CORRECTION_INVALID_TIMES');
  expect(
    codeOf(() =>
      plan(session(), { clock_out: '2026-10-08T14:00:00.001Z' }, context({ neighbours: [open] })),
    ),
  ).toBe('ATTENDANCE_CORRECTION_INVALID_TIMES');
  const self: AttendanceCorrectionNeighbour = {
    ...next,
    id: 'session',
    clock_in: '2026-10-08T05:30:00.000Z',
  };
  expect(
    plan(session(), { clock_out: '2026-10-08T12:00:00.000Z' }, context({ neighbours: [self] }))
      .revision,
  ).toBe(4);
});

it('refuses a clock-in that crosses Kuwait midnight and allows the clock-out to', () => {
  const row = session({
    clock_in: '2026-10-08T18:00:00.000Z',
    clock_out: '2026-10-08T20:00:00.000Z',
  });
  const overnight = context({ now: new Date('2026-10-09T06:00:00.000Z') });
  expect(
    codeOf(() =>
      plan(
        row,
        { clock_in: '2026-10-08T21:00:00.000Z', clock_out: '2026-10-08T22:00:00.000Z' },
        overnight,
      ),
    ),
  ).toBe('ATTENDANCE_CORRECTION_WORKING_DATE');
  expect(plan(row, { clock_out: '2026-10-08T22:00:00.000Z' }, overnight).working_date).toBe(
    '2026-10-08',
  );
  expect(codeOf(() => plan(row, { clock_out: '2026-10-08T18:00:00.000Z' }, overnight))).toBe(
    'ATTENDANCE_CORRECTION_INVALID_TIMES',
  );
});

it('recomputes lateness from the stored shift and leaves it on a clock-out-only change', () => {
  const onTime = plan(session({ clock_in: '2026-10-08T05:40:00.000Z' }), {
    clock_in: '2026-10-08T05:10:00.000Z',
  });
  expect(onTime.late_minutes).toBe(0);
  const late = plan(session({ clock_in: '2026-10-08T05:40:00.000Z' }), {
    clock_in: '2026-10-08T05:11:00.000Z',
  });
  expect(late.late_minutes).toBe(11);
  expect(
    plan(session({ scheduled_start: null, clock_in: '2026-10-08T05:40:00.000Z' }), {
      clock_in: '2026-10-08T05:20:00.000Z',
    }).late_minutes,
  ).toBe(0);
  expect(plan(session(), { clock_out: '2026-10-08T12:00:00.000Z' }).late_minutes).toBe(40);
});

it('allows the owner to correct their own session and refuses every other employee', () => {
  const change = { clock_out: '2026-10-08T12:00:00.000Z' };
  expect(
    plan(session(), change, context({ actorIsEmployee: true, actorIsOwner: true })).revision,
  ).toBe(4);
  expect(codeOf(() => plan(session(), change, context({ actorIsEmployee: true })))).toBe(
    'ATTENDANCE_CORRECTION_SELF_FORBIDDEN',
  );
  expect(plan(session(), change, context({ actorIsOwner: true })).revision).toBe(4);
  expect(
    codeOf(() =>
      plan(
        session(),
        { clock_out: '2026-10-08T04:00:00.000Z' },
        context({ actorIsEmployee: true }),
      ),
    ),
  ).toBe('ATTENDANCE_CORRECTION_SELF_FORBIDDEN');
});

it('refuses a blank reason, a no-op, and a stale or saturated revision', () => {
  expect(codeOf(() => plan(session(), { reason: '   ' }))).toBe('VALIDATION_FAILED');
  expect(codeOf(() => plan(session(), { reason: 'x'.repeat(501) }))).toBe('VALIDATION_FAILED');
  expect(codeOf(() => plan(session(), { clock_in: undefined, clock_out: undefined }))).toBe(
    'VALIDATION_FAILED',
  );
  expect(codeOf(() => plan(session(), { clock_in: '2026-10-08T05:00:00Z' }))).toBe(
    'VALIDATION_FAILED',
  );
  expect(
    plan(session(), { reason: 'x'.repeat(500), clock_out: '2026-10-08T12:00:00.000Z' })
      .corrections[0]?.reason,
  ).toBe('x'.repeat(500));
  expect(
    codeOf(() => plan(session(), { revision: 2, clock_out: '2026-10-08T04:00:00.000Z' })),
  ).toBe('ATTENDANCE_SESSION_REVISION_CONFLICT');
  expect(
    codeOf(() =>
      plan(session({ revision: 2147483647 }), { clock_out: '2026-10-08T12:00:00.000Z' }),
    ),
  ).toBe('ATTENDANCE_SESSION_REVISION_CONFLICT');
});

it.each(['OPEN', 'CLOSED', 'MISSED_OUT'] as const)(
  'covers every field combination for %s',
  (status) => {
    const row = session({
      status,
      clock_out: status === 'OPEN' ? null : '2026-10-08T13:00:00Z',
      closed_by: status === 'OPEN' ? null : status === 'MISSED_OUT' ? 'MISSED_OUT' : 'EMPLOYEE',
    });
    for (const change of [
      { clock_in: '2026-10-08T05:05:00Z' },
      { clock_out: '2026-10-08T12:00:00Z' },
      { clock_in: '2026-10-08T05:05:00Z', clock_out: '2026-10-08T12:00:00Z' },
    ]) {
      if (status === 'OPEN')
        expect(codeOf(() => plan(row, change))).toBe('ATTENDANCE_SESSION_OPEN');
      else
        expect(plan(row, change)).toMatchObject({ status, closed_by: row.closed_by, revision: 4 });
    }
  },
);

it('keeps self, state and revision priority over no-op and invalid times', () => {
  const unchanged = { clock_out: '2026-10-08T13:00:00Z' };
  expect(codeOf(() => plan(session(), unchanged, context({ actorIsEmployee: true })))).toBe(
    'ATTENDANCE_CORRECTION_SELF_FORBIDDEN',
  );
  expect(codeOf(() => plan(session(), { ...unchanged, revision: 2 }))).toBe(
    'ATTENDANCE_SESSION_REVISION_CONFLICT',
  );
  const open = session({ status: 'OPEN', clock_out: null, closed_by: null });
  expect(codeOf(() => plan(open, { clock_in: open.clock_in }))).toBe('ATTENDANCE_SESSION_OPEN');
});

it('accepts touching a previous session and refuses extending into it', () => {
  const previous: AttendanceCorrectionNeighbour = {
    id: 'previous',
    status: 'CLOSED',
    clock_in: '2026-10-08T03:00:00Z',
    clock_out: '2026-10-08T04:00:00Z',
  };
  const ctx = context({ neighbours: [previous] });
  expect(plan(session(), { clock_in: '2026-10-08T04:00:00Z' }, ctx).revision).toBe(4);
  expect(codeOf(() => plan(session(), { clock_in: '2026-10-08T03:59:59.999Z' }, ctx))).toBe(
    'ATTENDANCE_CORRECTION_INVALID_TIMES',
  );
});

it('records only changed fields and accepts a one-character reason', () => {
  expect(
    plan(session(), {
      clock_in: '2026-10-08T05:00:00Z',
      clock_out: '2026-10-08T12:00:00Z',
      reason: ' x ',
    }).corrections,
  ).toEqual([
    {
      field: 'CLOCK_OUT',
      before: '2026-10-08T13:00:00.000Z',
      after: '2026-10-08T12:00:00.000Z',
      reason: 'x',
    },
  ]);
  expect(codeOf(() => plan(session(), { clock_in: 'not-an-instant' }))).toBe('VALIDATION_FAILED');
});
