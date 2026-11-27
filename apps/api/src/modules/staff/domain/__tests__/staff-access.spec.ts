import { expect, it } from 'vitest';
import {
  pendingStaffAccessCancellable,
  planStaffWelcomePinNotice,
  staffAccessCancelAllowed,
} from '../staff-access.ts';

const started = (iso: string) => new Date(iso);
const now = new Date('2026-11-24T12:00:00Z');

it('FR-F1-6 a PENDING record older than 24 hours is cancellable', () => {
  expect(
    pendingStaffAccessCancellable(
      { state: 'PENDING', attemptStartedAt: started('2026-11-23T11:00:00Z') },
      now,
    ),
  ).toBe(true);
});

it('FR-F1-6 a PENDING record younger than 24 hours is not cancellable yet', () => {
  expect(
    pendingStaffAccessCancellable(
      { state: 'PENDING', attemptStartedAt: started('2026-11-24T11:01:00Z') },
      now,
    ),
  ).toBe(false);
  // الحد بالظبط: 24 ساعة ناقص ثانية يرفض، و24 ساعة بالظبط يسمح.
  expect(
    pendingStaffAccessCancellable(
      { state: 'PENDING', attemptStartedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000 + 1000) },
      now,
    ),
  ).toBe(false);
  expect(
    pendingStaffAccessCancellable(
      { state: 'PENDING', attemptStartedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      now,
    ),
  ).toBe(true);
});

it('FR-F1-6 only a PENDING record is cancellable, whatever its age', () => {
  const old = started('2026-11-01T00:00:00Z');
  for (const state of ['ACTIVE', 'STOPPED', 'PHONE_CHANGING'] as const) {
    expect(pendingStaffAccessCancellable({ state, attemptStartedAt: old }, now)).toBe(false);
  }
});

it('P1-2 cancelling resumes after interruption; only original granter or owner may cancel', () => {
  expect(
    pendingStaffAccessCancellable(
      { state: 'CANCELLING', attemptStartedAt: new Date('2026-11-01') },
      now,
    ),
  ).toBe(true);
  expect(staffAccessCancelAllowed({ grantedBy: 'original' }, 'original', false)).toBe(true);
  expect(staffAccessCancelAllowed({ grantedBy: 'original' }, 'other', true)).toBe(true);
  expect(staffAccessCancelAllowed({ grantedBy: 'original' }, 'other', false)).toBe(false);
});

it('plans welcome email recipients with masking only on manager and case-insensitive dedup', () => {
  const expiresAt = new Date('2026-11-28T12:00:00Z');
  const mask = (email: string) => `masked(${email})`;
  expect(
    planStaffWelcomePinNotice({
      expiresAt,
      managerEmail: 'mgr@example.test',
      recoveryEmail: 'staff@example.test',
      mask,
    }),
  ).toEqual({
    expiresAt,
    recipients: [
      {
        email: 'mgr@example.test',
        recipient: 'manager',
        targetMaskedEmail: 'masked(staff@example.test)',
      },
      { email: 'staff@example.test', recipient: 'employee', targetMaskedEmail: null },
    ],
  });
  expect(
    planStaffWelcomePinNotice({
      expiresAt,
      managerEmail: 'Mgr@Example.test',
      recoveryEmail: ' mgr@example.test ',
      mask,
    }).recipients,
  ).toEqual([
    {
      email: 'Mgr@Example.test',
      recipient: 'manager',
      targetMaskedEmail: 'masked( mgr@example.test )',
    },
  ]);
  expect(
    planStaffWelcomePinNotice({ expiresAt, managerEmail: 'mgr@e.test', recoveryEmail: null, mask })
      .recipients,
  ).toEqual([{ email: 'mgr@e.test', recipient: 'manager', targetMaskedEmail: null }]);
  expect(
    planStaffWelcomePinNotice({ expiresAt, managerEmail: null, recoveryEmail: 's@e.test', mask })
      .recipients,
  ).toEqual([{ email: 's@e.test', recipient: 'employee', targetMaskedEmail: null }]);
  expect(
    planStaffWelcomePinNotice({ expiresAt, managerEmail: null, recoveryEmail: null, mask })
      .recipients,
  ).toEqual([]);
});
