import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  historyClear,
  historyLeave,
  historyRead,
  historySession,
  historyShift,
  leaveFixture,
  type LeaveFixture,
} from './leave-history.fixture.ts';
let f: LeaveFixture;
beforeAll(async () => {
  f = await leaveFixture();
});
beforeEach(async () => {
  await historyClear(f);
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('LH-04/09/22: one absence contains all split-day ranges and a stable canonical id', async () => {
  const first = await historyShift(f, '2026-11-06', { start: '09:00', end: '12:00' });
  await historyShift(f, '2026-11-06', { start: '16:00', end: '20:00' });
  const between = await historyRead(f, {}, '2026-11-06T13:00:00.000Z');
  expect(between.items).toMatchObject([
    {
      id: first,
      row_type: 'UNEXCUSED_ABSENCE',
      status: 'ABSENT',
      shifts: [
        { start: '09:00', end: '12:00' },
        { start: '16:00', end: '20:00' },
      ],
    },
  ]);
  expect((await historyRead(f)).items).toEqual(between.items);
  expect(between.items[0]?.employee_number).toBeTypeOf('number');
});
it.each(['APPROVED', 'PENDING'])(
  'LH-05/17: %s leave, partial included, suppresses absence',
  async (status) => {
    await historyShift(f, '2026-10-01');
    await historyLeave(f, '2026-10-01', { status, kind: 'PARTIAL' });
    expect((await historyRead(f)).items.filter((r) => r.row_type === 'UNEXCUSED_ABSENCE')).toEqual(
      [],
    );
  },
);
it.each(['REJECTED', 'CANCELLED'])(
  'LH-05: %s request remains beside the absence',
  async (status) => {
    await historyShift(f, '2026-10-01');
    await historyLeave(f, '2026-10-01', { status });
    expect((await historyRead(f)).items.map((r) => r.row_type)).toEqual([
      'LEAVE',
      'UNEXCUSED_ABSENCE',
    ]);
  },
);
it.each(['OPEN', 'CLOSED', 'MISSED_OUT'])(
  'LH-06/07/TD-1 D-a/D-d: any non-voided %s session covers the business day',
  async (status) => {
    await historyShift(f, '2026-10-01');
    await historySession(f, '2026-10-01', { status, branch: f.secondBranch });
    expect((await historyRead(f)).items).toEqual([]);
  },
);
it('LH-08: an unended day never creates an absence', async () => {
  await historyShift(f, '2026-11-07', { start: '16:00', end: '20:00' });
  expect((await historyRead(f)).items).toEqual([]);
});
it('LH-10/TD-1 D-e: dates before hire and after contract end do not create absence', async () => {
  await historyShift(f, '2025-12-31');
  await historyShift(f, '2026-11-02');
  await f.h
    .owner`UPDATE employees SET contract_end='2026-11-01' WHERE company_id=${f.company} AND id=${f.employee.id}`;
  try {
    expect((await historyRead(f)).items).toEqual([]);
  } finally {
    await f.h
      .owner`UPDATE employees SET contract_end=NULL WHERE company_id=${f.company} AND id=${f.employee.id}`;
  }
});
it('LH-16/BR-007: late approved leave replaces derived absence immediately', async () => {
  await historyShift(f, '2026-10-01');
  expect((await historyRead(f)).items[0]?.row_type).toBe('UNEXCUSED_ABSENCE');
  await historyLeave(f, '2026-10-01', { type: 'SICK' });
  expect((await historyRead(f)).items.map((r) => r.row_type)).toEqual(['LEAVE']);
});
it('LH-13/25/26: hidden cover expands to every own shift, with per-fact visibility', async () => {
  await historyShift(f, '2026-10-01', { start: '09:00', end: '12:00' });
  await historyShift(f, '2026-10-01', { start: '16:00', end: '20:00' });
  await historySession(f, '2026-10-01', { branch: f.secondBranch });
  await f.h.owner`UPDATE memberships SET scope_type='BRANCH',scope_id=${f.branch}
    WHERE company_id=${f.company} AND id=${f.memberId}`;
  try {
    const page = await historyRead(f, {}, '2026-10-01T13:00:00.000Z');
    expect(page.items).toHaveLength(2);
    expect(page.items.every((r) => r.row_type === 'COVERED_ELSEWHERE')).toBe(true);
    expect(page.last_taken?.unexcused_absence).toBeNull();
    expect((await historyRead(f, { 'statuses[]': ['ABSENT'] })).items).toEqual([]);
    await historyLeave(f, '2026-10-01');
    expect((await historyRead(f)).items.map((r) => r.row_type)).toEqual(['LEAVE']);
  } finally {
    await f.h.owner`UPDATE memberships SET scope_type='BUSINESS',scope_id=${f.business}
      WHERE company_id=${f.company} AND id=${f.memberId}`;
  }
});
