import { expect, it } from 'vitest';
import {
  planAttendanceRestore,
  planAttendanceVoid,
  type AttendanceVoidSession,
} from '../attendance-void.ts';

const session = (patch: Partial<AttendanceVoidSession> = {}): AttendanceVoidSession => ({
  id: 'session',
  status: 'CLOSED',
  clock_in: '2026-10-04T05:00:00.000Z',
  clock_out: '2026-10-04T13:00:00.000Z',
  revision: 3,
  voided_at: null,
  ...patch,
});
const context = {
  now: new Date('2026-10-10T12:00:00.000Z'),
  approverId: 'approver',
  requestId: 'request',
};
const request = { session_revision: 3 };

it.each(['CLOSED', 'MISSED_OUT'] as const)('voids %s without changing session facts', (status) => {
  const row = session({ status });
  const before = { ...row };
  expect(planAttendanceVoid(row, request, context)).toEqual({
    voided_at: context.now.toISOString(),
    voided_by: 'approver',
    void_request_id: 'request',
    revision: 4,
  });
  expect(row).toEqual(before);
});

it('accepts a manual closed session regardless of its source or age', () => {
  const manual = {
    ...session(),
    source: 'MANUAL',
    clock_in: '2020-01-01T05:00:00Z',
    clock_out: '2020-01-01T13:00:00Z',
  };
  expect(planAttendanceVoid(manual, request, context).revision).toBe(4);
});

it('refuses voided before open, then open before stale revision', () => {
  expect(() =>
    planAttendanceVoid(
      session({ status: 'OPEN', voided_at: context.now.toISOString() }),
      request,
      context,
    ),
  ).toThrow('ATTENDANCE_SESSION_VOIDED');
  expect(() =>
    planAttendanceVoid(session({ status: 'OPEN', clock_out: null, revision: 4 }), request, context),
  ).toThrow('ATTENDANCE_SESSION_OPEN');
});

it.each([4, 2147483647])('refuses stale or saturated revision %s for both planners', (revision) => {
  const seen = { session_revision: revision === 2147483647 ? revision : 3 };
  expect(() => planAttendanceVoid(session({ revision }), seen, context)).toThrow(
    'ATTENDANCE_SESSION_REVISION_CONFLICT',
  );
  expect(() =>
    planAttendanceRestore(session({ revision, voided_at: context.now.toISOString() }), seen, {
      neighbours: [],
    }),
  ).toThrow('ATTENDANCE_SESSION_REVISION_CONFLICT');
});

it('refuses a restore of a non-voided session before revision checks', () => {
  expect(() =>
    planAttendanceRestore(session({ revision: 4 }), request, { neighbours: [] }),
  ).toThrow('ATTENDANCE_SESSION_NOT_VOIDED');
});

it('clears only the three marks and advances revision on restore', () => {
  expect(
    planAttendanceRestore(session({ voided_at: context.now.toISOString() }), request, {
      neighbours: [],
    }),
  ).toEqual({ voided_at: null, voided_by: null, void_request_id: null, revision: 4 });
});

it.each(['CLOSED', 'MISSED_OUT', 'OPEN'] as const)('refuses restore overlapping %s', (status) => {
  const neighbour = {
    id: 'other',
    status,
    clock_in: '2026-10-04T12:00:00Z',
    clock_out: status === 'OPEN' ? null : '2026-10-04T14:00:00Z',
  };
  expect(() =>
    planAttendanceRestore(session({ voided_at: context.now.toISOString() }), request, {
      neighbours: [neighbour],
    }),
  ).toThrow('ATTENDANCE_RESTORE_OVERLAP');
});

it('permits touching ends on both sides and excludes the session itself', () => {
  const row = session({ voided_at: context.now.toISOString() });
  const neighbours = [
    { ...row, id: 'previous', clock_in: '2026-10-04T04:00:00Z', clock_out: row.clock_in },
    { ...row, id: 'next', clock_in: '2026-10-04T13:00:00Z', clock_out: '2026-10-04T15:00:00Z' },
    row,
  ];
  expect(planAttendanceRestore(row, request, { neighbours }).revision).toBe(4);
});
