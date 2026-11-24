import { expect, it } from 'vitest';
import { pendingStaffAccessCancellable, staffAccessCancelAllowed } from '../staff-access.ts';

const created = (iso: string) => new Date(iso);
const now = new Date('2026-11-24T12:00:00Z');

it('FR-F1-6 a PENDING record older than 24 hours is cancellable', () => {
  expect(
    pendingStaffAccessCancellable(
      { state: 'PENDING', createdAt: created('2026-11-23T11:00:00Z') },
      now,
    ),
  ).toBe(true);
});

it('FR-F1-6 a PENDING record younger than 24 hours is not cancellable yet', () => {
  expect(
    pendingStaffAccessCancellable(
      { state: 'PENDING', createdAt: created('2026-11-24T11:01:00Z') },
      now,
    ),
  ).toBe(false);
  // الحد بالظبط: 24 ساعة ناقص ثانية يرفض، و24 ساعة بالظبط يسمح.
  expect(
    pendingStaffAccessCancellable(
      { state: 'PENDING', createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000 + 1000) },
      now,
    ),
  ).toBe(false);
  expect(
    pendingStaffAccessCancellable(
      { state: 'PENDING', createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      now,
    ),
  ).toBe(true);
});

it('FR-F1-6 only a PENDING record is cancellable, whatever its age', () => {
  const old = created('2026-11-01T00:00:00Z');
  for (const state of ['ACTIVE', 'STOPPED', 'PHONE_CHANGING'] as const) {
    expect(pendingStaffAccessCancellable({ state, createdAt: old }, now)).toBe(false);
  }
});

it('P1-2 cancelling resumes after interruption; only original granter or owner may cancel', () => {
  expect(
    pendingStaffAccessCancellable({ state: 'CANCELLING', createdAt: new Date('2026-11-01') }, now),
  ).toBe(true);
  expect(staffAccessCancelAllowed({ grantedBy: 'original' }, 'original', false)).toBe(true);
  expect(staffAccessCancelAllowed({ grantedBy: 'original' }, 'other', true)).toBe(true);
  expect(staffAccessCancelAllowed({ grantedBy: 'original' }, 'other', false)).toBe(false);
});
