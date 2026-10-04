import { expect, it } from 'vitest';
import { decideLeaveInput, revokeLeaveInput, leaveInboxQuery } from '../staff/leave-decision.js';
it.each([1, 500])('accepts trimmed decision and revocation reasons of %i characters', (length) => {
  for (const decision of ['APPROVED', 'REJECTED'])
    expect(
      decideLeaveInput.parse({ decision, expected_revision: 1, reason: ` ${'x'.repeat(length)} ` })
        .reason,
    ).toHaveLength(length);
  expect(
    revokeLeaveInput.parse({ expected_revision: 2, reason: ` ${'x'.repeat(length)} ` }).reason,
  ).toHaveLength(length);
});
it.each([undefined, '', ' ', 'x'.repeat(501)])(
  'validates optional approval vs required rejection/revocation: %s',
  (reason) => {
    expect(
      decideLeaveInput.safeParse({ decision: 'APPROVED', expected_revision: 1, reason }).success,
    ).toBe(reason === undefined);
    expect(
      decideLeaveInput.safeParse({ decision: 'REJECTED', expected_revision: 1, reason }).success,
    ).toBe(false);
    expect(revokeLeaveInput.safeParse({ expected_revision: 1, reason }).success).toBe(false);
  },
);
it.each(['decided_by', 'decided_at', 'employee_id', 'branch_id', 'status'])(
  'rejects client identity/status field %s',
  (key) => {
    expect(
      decideLeaveInput.safeParse({ decision: 'APPROVED', expected_revision: 1, [key]: 'synthetic' })
        .success,
    ).toBe(false);
  },
);
it.each([0, -1, 1.5, 2147483647])('requires a usable positive revision %i', (expected_revision) => {
  expect(decideLeaveInput.safeParse({ decision: 'APPROVED', expected_revision }).success).toBe(
    false,
  );
  expect(revokeLeaveInput.safeParse({ expected_revision, reason: 'Synthetic' }).success).toBe(
    false,
  );
});
it('validates optional inbox filters and civil range boundaries', () => {
  expect(leaveInboxQuery.parse({ from: '2027-01-01', to: '2027-01-01' }).limit).toBe(20);
  expect(leaveInboxQuery.safeParse({ from: '2027-02-01', to: '2027-01-01' }).success).toBe(false);
  expect(leaveInboxQuery.safeParse({ from: '2027-02-30' }).success).toBe(false);
  expect(leaveInboxQuery.safeParse({ branch_id: 'unknown' }).success).toBe(false);
});
