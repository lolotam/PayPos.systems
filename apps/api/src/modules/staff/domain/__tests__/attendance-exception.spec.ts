import { describe, expect, it } from 'vitest';
import {
  assertAttendanceExceptionDecider,
  attendanceExceptionAudit,
  attendanceExceptionReason,
  reopenAttendanceException,
  resolveAttendanceException,
  type AttendanceExceptionRecord,
} from '../attendance-exception.ts';

const now = new Date('2026-10-08T12:00:00.000Z');
const actor = 'actor';
const other = 'employee-user';
const row = (over: Partial<AttendanceExceptionRecord> = {}): AttendanceExceptionRecord => ({
  id: 'ex',
  session_id: 'session',
  employee_id: 'employee',
  branch_id: 'branch',
  kind: 'OUT_OF_RANGE',
  status: 'OPEN',
  resolution: null,
  resolved_by: null,
  resolved_at: null,
  reason: null,
  raised_at: '2026-10-08T08:00:00.000Z',
  revision: 0,
  ...over,
});
const decision = (revision = 0, reason = '  errand  ') => ({ revision, reason });
const closed = (over: Partial<AttendanceExceptionRecord> = {}) =>
  row({
    status: 'RESOLVED',
    resolution: 'ACKNOWLEDGED',
    resolved_by: 'mgr',
    resolved_at: now.toISOString(),
    reason: 'done',
    ...over,
  });

describe('attendance exception transitions', () => {
  it.each([
    ['OPEN', 'NONE', 'resolve', 'ok'],
    ['OPEN', 'OUT_OF_RANGE', 'resolve', 'ok'],
    ['OPEN', 'SUSPECTED_MISSED_OUT', 'resolve', 'ATTENDANCE_EXCEPTION_NOT_MANUAL'],
    ['RESOLVED', 'NONE', 'resolve', 'ATTENDANCE_EXCEPTION_REVISION_CONFLICT'],
    ['RESOLVED', 'OUT_OF_RANGE', 'resolve', 'ATTENDANCE_EXCEPTION_REVISION_CONFLICT'],
    ['RESOLVED', 'SUSPECTED_MISSED_OUT', 'resolve', 'ATTENDANCE_EXCEPTION_NOT_MANUAL'],
    ['OPEN', 'NONE', 'reopen', 'ATTENDANCE_EXCEPTION_REVISION_CONFLICT'],
    ['OPEN', 'OUT_OF_RANGE', 'reopen', 'ATTENDANCE_EXCEPTION_REVISION_CONFLICT'],
    ['OPEN', 'SUSPECTED_MISSED_OUT', 'reopen', 'ATTENDANCE_EXCEPTION_NOT_MANUAL'],
    ['RESOLVED', 'NONE', 'reopen', 'ok'],
    ['RESOLVED', 'OUT_OF_RANGE', 'reopen', 'ok'],
    ['RESOLVED', 'SUSPECTED_MISSED_OUT', 'reopen', 'ATTENDANCE_EXCEPTION_NOT_MANUAL'],
  ] as const)('%s %s %s → %s', (status, kind, action, expected) => {
    const before = status === 'RESOLVED' ? closed({ kind }) : row({ kind });
    const apply = action === 'resolve' ? resolveAttendanceException : reopenAttendanceException;
    const run = () => apply(before, other, actor, decision(), now);
    if (expected === 'ok')
      expect(run().record.status).toBe(action === 'resolve' ? 'RESOLVED' : 'OPEN');
    else expect(run).toThrow(expected);
  });
});

describe('attendance exception writes', () => {
  it('acknowledges an open warning, trims the reason and leaves the movement identity', () => {
    const before = row();
    const change = resolveAttendanceException(before, null, actor, decision(), now);
    expect(change.decisionReason).toBe('errand');
    expect(change.record).toEqual({
      ...before,
      status: 'RESOLVED',
      resolution: 'ACKNOWLEDGED',
      resolved_by: actor,
      resolved_at: now.toISOString(),
      reason: 'errand',
      revision: 1,
    });
  });

  it('reopens a card-scan closure, clears the row and keeps the new reason for audit only', () => {
    const before = closed({ kind: 'NONE', resolution: 'CARD_SCAN', reason: null, revision: 3 });
    const change = reopenAttendanceException(
      before,
      null,
      actor,
      decision(3, ' closed by mistake '),
      now,
    );
    expect(change.record).toMatchObject({
      status: 'OPEN',
      resolution: null,
      resolved_by: null,
      resolved_at: null,
      reason: null,
      revision: 4,
    });
    const audit = attendanceExceptionAudit(before, change.record, change.decisionReason);
    expect(audit.before).toEqual({
      status: 'RESOLVED',
      resolution: 'CARD_SCAN',
      resolved_by: 'mgr',
      resolved_at: now.toISOString(),
      reason: null,
      revision: 3,
    });
    expect(audit.after.decision_reason).toBe('closed by mistake');
    expect(audit.after.reason).toBeNull();
  });
});

describe('attendance exception refusals', () => {
  it('refuses self before kind, and a suspected row before a stale revision', () => {
    expect(() =>
      resolveAttendanceException(row({ kind: 'SUSPECTED_MISSED_OUT' }), actor, actor, decision(), now),
    ).toThrow('ATTENDANCE_EXCEPTION_SELF_FORBIDDEN');
    expect(() => assertAttendanceExceptionDecider(null, actor)).not.toThrow();
    expect(() =>
      resolveAttendanceException(row({ kind: 'SUSPECTED_MISSED_OUT', revision: 4 }), other, actor, decision(), now),
    ).toThrow('ATTENDANCE_EXCEPTION_NOT_MANUAL');
  });

  it('maps a stale revision, the wrong state and integer overflow to one conflict', () => {
    expect(() => resolveAttendanceException(row(), other, actor, decision(1), now)).toThrow(
      'ATTENDANCE_EXCEPTION_REVISION_CONFLICT',
    );
    expect(() => resolveAttendanceException(closed(), other, actor, decision(), now)).toThrow(
      'ATTENDANCE_EXCEPTION_REVISION_CONFLICT',
    );
    expect(() => reopenAttendanceException(row(), other, actor, decision(), now)).toThrow(
      'ATTENDANCE_EXCEPTION_REVISION_CONFLICT',
    );
    expect(() =>
      resolveAttendanceException(row({ revision: 2147483647 }), other, actor, decision(2147483647), now),
    ).toThrow('ATTENDANCE_EXCEPTION_REVISION_CONFLICT');
  });

  it('accepts one and 500 characters and refuses empty, spaces and 501', () => {
    expect(attendanceExceptionReason('a')).toBe('a');
    expect(attendanceExceptionReason(`  ${'x'.repeat(500)}  `)).toHaveLength(500);
    for (const reason of ['', '   ', 'x'.repeat(501)])
      expect(() => attendanceExceptionReason(reason)).toThrow('VALIDATION_FAILED');
  });
});
