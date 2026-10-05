import { describe, expect, it } from 'vitest';
import { decidePendingLeave, leaveDecisionReason, revokeApprovedLeave } from '../leave-decision.ts';
import { leaveSnapshot } from '../leave-policy.ts';
import { materializeLeave } from '../leave-period.ts';
import type { LeaveRecord, LeaveStatus } from '../leave-types.ts';

const now = new Date('2026-10-04T10:00:00.000Z');
const pending: LeaveRecord = {
  ...materializeLeave(
    {
      kind: 'FULL_DAY',
      from: '2027-01-01',
      to: '2027-01-02',
      type: 'SICK',
      note: 'Synthetic private note',
    },
    'Asia/Kuwait',
    now,
    false,
  ),
  id: 'leave',
  business_id: 'business',
  branch_id: 'branch',
  employee_id: 'employee',
  status: 'PENDING',
  requested_by: 'requester',
  requested_at: now.toISOString(),
  cancelled_by: null,
  cancelled_at: null,
  decided_by: null,
  decided_at: null,
  rejection_reason: null,
  decision_reason: null,
  revoked_by: null,
  revoked_at: null,
  revocation_reason: null,
  revision: 1,
};
const decision = (status: 'APPROVED' | 'REJECTED', reason?: string) => ({
  decision: status,
  expected_revision: 1,
  ...(reason === undefined ? {} : { reason }),
});
const approve = () =>
  decidePendingLeave(
    pending,
    'employee-user',
    'approver',
    decision('APPROVED', '  Synthetic approval  '),
    now,
    [],
  );
const states: LeaveStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

describe('decision reason boundaries', () => {
  it.each([1, 500])(
    'accepts and trims %i characters for required and optional reasons',
    (length) => {
      for (const required of [false, true])
        expect(leaveDecisionReason(`  ${'x'.repeat(length)}  `, required)).toHaveLength(length);
    },
  );
  it.each(['', '   ', 'x'.repeat(501)])(
    'refuses supplied invalid reasons for both actions: %s',
    (reason) => {
      for (const required of [false, true])
        expect(() => leaveDecisionReason(reason, required)).toThrow('LEAVE_REASON_REQUIRED');
    },
  );
  it('allows absent approval reason only', () => {
    expect(leaveDecisionReason(undefined, false)).toBeNull();
    expect(() => leaveDecisionReason(undefined, true)).toThrow('LEAVE_REASON_REQUIRED');
  });
});
it.each(states)('decides only PENDING, current %s', (status) => {
  for (const result of ['APPROVED', 'REJECTED'] as const) {
    const run = () =>
      decidePendingLeave(
        { ...pending, status },
        null,
        'approver',
        decision(result, 'Synthetic reason'),
        now,
        [],
      );
    if (status === 'PENDING')
      expect(run()).toMatchObject({
        status: result,
        revision: 2,
        decided_at: now.toISOString(),
        decision_reason: 'Synthetic reason',
        rejection_reason: result === 'REJECTED' ? 'Synthetic reason' : null,
      });
    else expect(run).toThrow('LEAVE_NOT_PENDING');
  }
});
it.each(['APPROVED', 'REJECTED'] as const)(
  'prevents own %s regardless of requester/membership',
  (result) => {
    for (const requested_by of ['employee-user', 'other-manager'])
      expect(() =>
        decidePendingLeave(
          { ...pending, requested_by },
          'employee-user',
          'employee-user',
          decision(result, 'Synthetic reason'),
          now,
          [],
        ),
      ).toThrow('LEAVE_SELF_DECISION_FORBIDDEN');
  },
);
it.each([0, 2, 2147483647])('refuses stale/exhausted revision %i', (revision) => {
  expect(() =>
    decidePendingLeave({ ...pending, revision }, null, 'approver', decision('APPROVED'), now, []),
  ).toThrow('LEAVE_REVISION_CONFLICT');
});
it('does not mutate source or reinterpret captured timezone/period', () => {
  const before = structuredClone(pending);
  expect(approve()).toMatchObject({
    starts_at: pending.starts_at,
    ends_at: pending.ends_at,
    timezone: 'Asia/Kuwait',
  });
  expect(pending).toEqual(before);
});
it.each(states)('overlap protects only other APPROVED periods, %s', (status) => {
  const other = { id: 'other', starts_at: pending.starts_at, ends_at: pending.ends_at, status };
  const run = () =>
    decidePendingLeave(pending, null, 'approver', decision('APPROVED'), now, [other]);
  if (status === 'APPROVED') expect(run).toThrow('LEAVE_APPROVED_OVERLAP');
  else expect(run().status).toBe('APPROVED');
  expect(
    decidePendingLeave(pending, null, 'approver', decision('REJECTED', 'Synthetic reason'), now, [
      other,
    ]).status,
  ).toBe('REJECTED');
});
it('excludes itself, adjacent and disjoint intervals', () => {
  for (const other of [
    { ...pending, status: 'APPROVED' as const },
    {
      id: 'adjacent-before',
      status: 'APPROVED' as const,
      starts_at: '2026-12-01T00:00:00.000Z',
      ends_at: pending.starts_at,
    },
    {
      id: 'adjacent-after',
      status: 'APPROVED' as const,
      starts_at: pending.ends_at,
      ends_at: '2027-02-01T00:00:00.000Z',
    },
  ])
    expect(
      decidePendingLeave(pending, null, 'approver', decision('APPROVED'), now, [other]).status,
    ).toBe('APPROVED');
});
it.each(states)('revokes only APPROVED, current %s', (status) => {
  const run = () =>
    revokeApprovedLeave(
      { ...approve(), status },
      null,
      'revoker',
      { expected_revision: 2, reason: '  Synthetic correction  ' },
      now,
    );
  if (status === 'APPROVED')
    expect(run()).toMatchObject({
      status: 'CANCELLED',
      revision: 3,
      revoked_by: 'revoker',
      revoked_at: now.toISOString(),
      revocation_reason: 'Synthetic correction',
      cancelled_by: null,
      decided_by: 'approver',
      decision_reason: 'Synthetic approval',
    });
  else expect(run).toThrow('LEAVE_NOT_APPROVED');
});
it.each(['Asia/Kuwait', 'America/New_York'])(
  'uses saved instants for both units in %s, including DST',
  (timezone) => {
    for (const terms of [
      { kind: 'FULL_DAY' as const, from: '2027-03-14', to: '2027-03-14', type: 'SICK' as const },
      {
        kind: 'PARTIAL' as const,
        date: '2027-03-14',
        start: '03:00',
        end: '04:00',
        type: 'SICK' as const,
      },
    ]) {
      const row = { ...approve(), ...materializeLeave(terms, timezone, now, false) };
      for (const offset of [-1, 0, 1]) {
        const run = () =>
          revokeApprovedLeave(
            row,
            null,
            'revoker',
            { expected_revision: 2, reason: 'Synthetic reason' },
            new Date(Date.parse(row.starts_at) + offset),
          );
        if (offset < 0) expect(run().status).toBe('CANCELLED');
        else expect(run).toThrow('LEAVE_ALREADY_STARTED');
      }
    }
  },
);
it('refuses self, stale revision and missing reason', () => {
  expect(() =>
    revokeApprovedLeave(
      approve(),
      'self',
      'self',
      { expected_revision: 2, reason: 'Synthetic' },
      now,
    ),
  ).toThrow('LEAVE_SELF_DECISION_FORBIDDEN');
  expect(() =>
    revokeApprovedLeave(
      approve(),
      null,
      'revoker',
      { expected_revision: 1, reason: 'Synthetic' },
      now,
    ),
  ).toThrow('LEAVE_REVISION_CONFLICT');
  expect(() =>
    revokeApprovedLeave(
      { ...approve(), revision: 2147483647 },
      null,
      'revoker',
      { expected_revision: 2147483647, reason: 'Synthetic' },
      now,
    ),
  ).toThrow('LEAVE_REVISION_CONFLICT');
  expect(() =>
    revokeApprovedLeave(approve(), null, 'revoker', { expected_revision: 2, reason: ' ' }, now),
  ).toThrow('LEAVE_REASON_REQUIRED');
});
it('excludes every free-form reason/note from audit and event snapshots', () => {
  const revoked = revokeApprovedLeave(
    approve(),
    null,
    'revoker',
    { expected_revision: 2, reason: 'Synthetic private reason' },
    now,
  );
  expect(leaveSnapshot(revoked)).not.toHaveProperty('note');
  for (const key of ['decision_reason', 'rejection_reason', 'revocation_reason'])
    expect(leaveSnapshot(revoked)).not.toHaveProperty(key);
});
