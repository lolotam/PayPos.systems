import { expect, it } from 'vitest';
import { inAppRecipient } from '../in-app-notifications.js';
import {
  attendanceChangeRequestInput,
  cancelAttendanceChangeInput,
  decideAttendanceChangeInput,
} from './attendance-change-request.js';

const employee_id = '01900000-0000-7000-8000-000000000001';
const manual = {
  branch_id: employee_id,
  clock_in: '2026-10-08T07:00:00.000Z',
  clock_out: '2026-10-08T16:00:00.000Z',
};
it.each(['ADD_SESSION', 'VOID_SESSION'])('accepts the %s envelope and trims its reason', (kind) => {
  expect(
    attendanceChangeRequestInput.parse({
      kind,
      employee_id,
      reason: ' why ',
      ...(kind === 'ADD_SESSION' ? manual : {}),
    }).reason,
  ).toBe('why');
});
it('requires manual times and branch and refuses scan/session fields', () => {
  const input = { kind: 'ADD_SESSION', employee_id, reason: 'why', ...manual };
  for (const field of ['branch_id', 'clock_in', 'clock_out'] as const) {
    const { [field]: omitted, ...rest } = input;
    expect(omitted).toBeDefined();
    expect(attendanceChangeRequestInput.safeParse(rest).success).toBe(false);
  }
  for (const extra of [
    { session_id: employee_id },
    { session_revision: 0 },
    { breaks: [] },
    { clock_in: '2026-10-08' },
  ])
    expect(attendanceChangeRequestInput.safeParse({ ...input, ...extra }).success).toBe(false);
});

it('accepts both in-app templates and rejects unsafe reason text or unknown decision/kind values', () => {
  const param = (name: string, value: string) => ({ name, type: 'text', value });
  const requested = {
    channel: 'IN_APP',
    user_id: employee_id,
    locale: 'ar',
    template_key: 'attendance_change_requested',
    template_revision: 1,
    safe_parameters: [
      param('employee_name_ar', 'ليلى'),
      param('employee_name_en', 'Laila'),
      param('change', 'ADD_SESSION'),
    ],
  };
  expect(inAppRecipient.safeParse(requested).success).toBe(true);
  const decided = {
    ...requested,
    template_key: 'attendance_change_decided',
    safe_parameters: [
      ...requested.safe_parameters,
      param('decision', 'APPROVED'),
      param('reason', '-'),
    ],
  };
  expect(inAppRecipient.safeParse(decided).success).toBe(true);
  for (const [index, value] of [
    [2, 'EDIT_SESSION'],
    [3, 'CANCELLED'],
    [4, 'token'],
    [4, 'x'.repeat(256)],
  ] as const) {
    const safe_parameters = decided.safe_parameters.map((p, i) =>
      i === index ? { ...p, value } : p,
    );
    expect(inAppRecipient.safeParse({ ...decided, safe_parameters }).success).toBe(false);
  }
});
it.each(['', '   ', 'x'.repeat(501)])('refuses invalid request and decision reasons', (reason) => {
  expect(
    attendanceChangeRequestInput.safeParse({ kind: 'ADD_SESSION', employee_id, ...manual, reason })
      .success,
  ).toBe(false);
  expect(
    decideAttendanceChangeInput.safeParse({ decision: 'REJECTED', revision: 0, reason }).success,
  ).toBe(false);
});
it('requires a rejection reason, allows reasonless approval and validates revisions', () => {
  expect(decideAttendanceChangeInput.safeParse({ decision: 'REJECTED', revision: 0 }).success).toBe(
    false,
  );
  expect(decideAttendanceChangeInput.safeParse({ decision: 'APPROVED', revision: 0 }).success).toBe(
    true,
  );
  for (const revision of [-1, 0.5, 2147483648])
    expect(cancelAttendanceChangeInput.safeParse({ revision }).success).toBe(false);
});
