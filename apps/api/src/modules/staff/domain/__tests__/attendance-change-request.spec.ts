import { expect, it } from 'vitest';
import {
  attendanceChangeReason,
  planChangeRequest,
  planChangeCancel,
  planChangeDecision,
  attendanceChangeRecipientGroups,
  attendanceChangeNoticeText,
} from '../attendance-change-request.ts';
const now = new Date('2026-10-10T08:00:00Z');
const context = { userId: 'manager', owner: false, canRequest: true, employeeUserId: null, now };
const pending = () => planChangeRequest({ reason: ' why ' }, context);
it.each(['', ' ', 'x'.repeat(501)])('rejects an invalid reason', (reason) => {
  expect(() => attendanceChangeReason(reason)).toThrow('VALIDATION_FAILED');
});
it.each([1, 500])('accepts %i characters after trimming', (length) => {
  expect(attendanceChangeReason(` ${'x'.repeat(length)} `)).toHaveLength(length);
});
it('checks authority before self and permits only the owner self path', () => {
  expect(() =>
    planChangeRequest(
      { reason: 'why' },
      { ...context, canRequest: false, employeeUserId: 'manager' },
    ),
  ).toThrow('NOT_FOUND');
  expect(() =>
    planChangeRequest({ reason: 'why' }, { ...context, employeeUserId: 'manager' }),
  ).toThrow('ATTENDANCE_CHANGE_SELF_FORBIDDEN');
  expect(
    planChangeRequest({ reason: 'why' }, { ...context, owner: true, employeeUserId: 'manager' }),
  ).toMatchObject({
    status: 'APPROVED',
    requested_by: 'manager',
    decided_by: 'manager',
    revision: 1,
  });
  expect(pending()).toMatchObject({ status: 'PENDING', reason: 'why', revision: 0 });
});
it('only the requester can withdraw and only owners decide', () => {
  expect(() => planChangeCancel(pending(), { ...context, userId: 'other', revision: 7 })).toThrow(
    'NOT_FOUND',
  );
  expect(() =>
    planChangeDecision(pending(), { decision: 'APPROVED', revision: 7 }, context),
  ).toThrow('NOT_FOUND');
  expect(planChangeCancel(pending(), { ...context, revision: 0 })).toMatchObject({
    status: 'CANCELLED',
    cancelled_by: 'manager',
    revision: 1,
  });
});
it.each(['APPROVED', 'REJECTED', 'CANCELLED'] as const)(
  'refuses every transition from %s before revision',
  (status) => {
    const row = { ...pending(), status };
    expect(() => planChangeCancel(row, { ...context, revision: 7 })).toThrow(
      'ATTENDANCE_CHANGE_NOT_PENDING',
    );
    for (const decision of ['APPROVED', 'REJECTED'] as const) {
      expect(() =>
        planChangeDecision(
          row,
          { decision, revision: 7, reason: 'why' },
          { ...context, owner: true },
        ),
      ).toThrow('ATTENDANCE_CHANGE_NOT_PENDING');
    }
  },
);
it('rejects stale and exhausted revisions on all transitions', () => {
  for (const row of [pending(), { ...pending(), revision: 2147483647 }]) {
    expect(() => planChangeCancel(row, { ...context, revision: 7 })).toThrow(
      'ATTENDANCE_CHANGE_REVISION_CONFLICT',
    );
    for (const decision of ['APPROVED', 'REJECTED'] as const)
      expect(() =>
        planChangeDecision(
          row,
          { decision, revision: 7, reason: 'why' },
          { ...context, owner: true },
        ),
      ).toThrow('ATTENDANCE_CHANGE_REVISION_CONFLICT');
  }
});
it('requires a rejection reason and allows an optional approval reason', () => {
  const owner = { ...context, owner: true, userId: 'owner' };
  expect(() => planChangeDecision(pending(), { decision: 'REJECTED', revision: 0 }, owner)).toThrow(
    'VALIDATION_FAILED',
  );
  for (const reason of ['', ' ', 'x'.repeat(501)])
    expect(() =>
      planChangeDecision(pending(), { decision: 'APPROVED', revision: 0, reason }, owner),
    ).toThrow('VALIDATION_FAILED');
  for (const decision of ['APPROVED', 'REJECTED'] as const)
    expect(
      planChangeDecision(pending(), { decision, revision: 0, reason: ' yes ' }, owner),
    ).toMatchObject({ status: decision, decided_by: 'owner', decision_reason: 'yes', revision: 1 });
  expect(
    planChangeDecision(pending(), { decision: 'APPROVED', revision: 0 }, owner).decision_reason,
  ).toBeNull();
});

it('groups all distinct recipients into at most one hundred per event', () => {
  const users = Array.from({ length: 201 }, (_, i) => `user-${i}`);
  const groups = attendanceChangeRecipientGroups([...users, ...users]);
  expect(groups.map((g) => g.length)).toEqual([100, 100, 1]);
  expect(groups.flat()).toEqual([...users].sort());
  expect(attendanceChangeRecipientGroups([])).toEqual([]);
});
it('uses safe display fallbacks and preserves a decision notice when its reason is unsafe', () => {
  const fallback = { ar: 'موظف', en: 'Employee' };
  for (const unsafe of [
    'https://example.invalid',
    'test.example',
    '+96512345678',
    'token',
    'x'.repeat(256),
  ]) {
    expect(
      attendanceChangeNoticeText({ name_ar: unsafe, name_en: unsafe }, fallback, null),
    ).toEqual({ employee_name_ar: fallback.ar, employee_name_en: fallback.en, reason: '-' });
  }
  for (const reason of [
    null,
    '',
    'x'.repeat(256),
    'https://example.invalid',
    '+96512345678',
    'token',
    '1234',
  ]) {
    expect(
      attendanceChangeNoticeText({ name_ar: null, name_en: 'Laila' }, fallback, reason),
    ).toEqual({ employee_name_ar: 'Laila', employee_name_en: 'Laila', reason: '-' });
  }
  expect(
    attendanceChangeNoticeText({ name_ar: ' ليلى ', name_en: 'Laila' }, fallback, 'x'.repeat(255)),
  ).toEqual({ employee_name_ar: 'ليلى', employee_name_en: 'Laila', reason: 'x'.repeat(255) });
});
it('refuses revision overflow even with a matching client revision', () => {
  const row = { ...pending(), revision: 2147483647 };
  expect(() => planChangeCancel(row, { ...context, revision: row.revision })).toThrow(
    'ATTENDANCE_CHANGE_REVISION_CONFLICT',
  );
  expect(() =>
    planChangeDecision(
      row,
      { decision: 'APPROVED', revision: row.revision },
      { ...context, owner: true },
    ),
  ).toThrow('ATTENDANCE_CHANGE_REVISION_CONFLICT');
});
