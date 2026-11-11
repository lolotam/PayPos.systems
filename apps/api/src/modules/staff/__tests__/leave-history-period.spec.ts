import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { encodeCursor } from '../../../shared/persistence/name-options-cursor.ts';
import { getEmployeeLeaveHistory } from '../queries/leave-history.query.ts';
import { createLeaveReadAccess } from '../persistence/leave-read-access.adapter.ts';
import {
  historyClear,
  historyLeave,
  historyRead,
  historyShift,
  historyQuery,
  historyNow,
  leaveContext,
  leaveFixture,
  leaveIds,
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

it('LH-11: last_taken ignores the period, pending and future approved leave', async () => {
  await historyLeave(f, '2026-02-01', { to: '2026-02-03' });
  await historyLeave(f, '2026-02-05', { type: 'SICK' });
  await historyLeave(f, '2026-02-10', { type: 'UNPAID' });
  await historyLeave(f, '2026-12-01');
  await historyLeave(f, '2026-10-01', { status: 'PENDING' });
  await historyShift(f, '2026-10-01');
  await historyShift(f, '2026-03-01');
  const page = await historyRead(f, { from: '2026-10-01', to: '2026-10-31' });
  expect(page.items).toEqual([]);
  expect(page.last_taken).toEqual({
    annual: { from: '2026-02-01', to: '2026-02-03' },
    sick: { from: '2026-02-05', to: '2026-02-05' },
    unpaid: { from: '2026-02-10', to: '2026-02-10' },
    unexcused_absence: '2026-03-01',
  });
});
it('last absence is MAX(working_date), independent of starts_at order at +14/-12', async () => {
  await historyShift(f, '2026-11-02', {
    timezone: 'Pacific/Kiritimati',
    start: '00:30',
    end: '01:30',
  });
  await historyShift(f, '2026-11-01', { branch: f.secondBranch, timezone: 'Etc/GMT+12' });
  const page = await historyRead(f, { from: '2026-11-04', to: '2026-11-07' });
  expect(page.last_taken?.unexcused_absence).toBe('2026-11-02');
});
it('period bounds use UTC midnights under non-UTC sessions at both +14/-12 edges and overnight to', async () => {
  for (const date of ['2026-10-01', '2026-10-03']) {
    await historyShift(f, date, { timezone: 'Pacific/Kiritimati', start: '00:30', end: '01:30' });
    await historyShift(f, date, {
      branch: f.secondBranch,
      timezone: 'Etc/GMT+12',
      start: '23:30',
      end: '23:45',
    });
  }
  await historyShift(f, '2026-10-03', {
    timezone: 'Pacific/Kiritimati',
    start: '22:00',
    end: '02:00',
    endsAt: '2026-10-03T12:00:00Z',
  });
  const q = { from: '2026-10-01', to: '2026-10-03' };
  const page = await historyRead(f, q);
  expect(page.items).toHaveLength(4);
  expect(
    page.items.find(
      (r) =>
        r.row_type === 'UNEXCUSED_ABSENCE' &&
        r.working_date === '2026-10-03' &&
        r.branch_id === f.branch,
    ),
  ).toMatchObject({
    shifts: [
      { start: '00:30', end: '01:30' },
      { start: '22:00', end: '02:00' },
    ],
  });
  expect(await historyRead(f, q, historyNow, 'Etc/GMT+12')).toEqual(page);
});
it('LH-03: type and status filters combine with AND, including ABSENT', async () => {
  await historyShift(f, '2026-10-01');
  const leave = await historyLeave(f, '2026-10-02', { type: 'SICK', status: 'REJECTED' });
  expect((await historyRead(f, { 'types[]': ['ANNUAL'], 'statuses[]': ['ABSENT'] })).items).toEqual(
    [],
  );
  expect(
    (await historyRead(f, { 'types[]': ['SICK'], 'statuses[]': ['REJECTED'] })).items.map(
      (r) => r.id,
    ),
  ).toEqual([leave]);
  expect((await historyRead(f, { 'statuses[]': ['ABSENT'] })).items.map((r) => r.row_type)).toEqual(
    ['UNEXCUSED_ABSENCE'],
  );
});
it('LH-12/22: rank and descending id cursor page without repeats or omissions', async () => {
  await historyShift(f, '2026-10-01');
  await historyLeave(f, '2026-10-01', { status: 'REJECTED' });
  await historyLeave(f, '2026-10-02');
  const expected = (await historyRead(f)).items;
  const actual = [];
  let cursor: string | null = null;
  do {
    const page = await historyRead(f, { limit: 1, ...(cursor ? { cursor } : {}) });
    actual.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor);
  expect(actual).toEqual(expected);
});
it.each([
  ['2026-11-07T10:00:00.001Z', false],
  ['2026-11-06T09:59:59.999Z', false],
  ['2026-11-07T10:00:00.000Z', true],
  ['2026-11-06T10:00:00.000Z', true],
])('LH-24: cursor time bound %s accepted=%s', async (as_of, accepted) => {
  const cursor = encodeCursor({ date: '2026-10-01', rank: 1, id: leaveIds.newId(), as_of });
  const result = await f.db.withTenant(f.company, (tx) =>
    getEmployeeLeaveHistory(
      tx,
      leaveContext(f),
      historyQuery({ cursor }),
      createLeaveReadAccess({ now: () => new Date(historyNow) }),
    ),
  );
  expect(result === 'VALIDATION_FAILED').toBe(!accepted);
});
it('LH-23: page two retains the boundary after local midnight', async () => {
  await historyLeave(f, '2026-10-03', { timezone: 'Asia/Kuwait' });
  await historyLeave(f, '2026-10-04', { timezone: 'Asia/Kuwait' });
  await historyLeave(f, '2026-10-02');
  await historyLeave(f, '2026-10-01');
  await historyShift(f, '2026-10-03', { start: '20:00', end: '21:00' });
  const first = await historyRead(f, { limit: 1 }, '2026-10-03T20:59:59.999Z');
  expect(first.next_cursor).not.toBeNull();
  const second = await historyRead(
    f,
    { limit: 1, cursor: first.next_cursor },
    '2026-10-03T21:00:00.001Z',
  );
  expect(second.as_of).toBe(first.as_of);
  expect(first.last_taken?.annual).toEqual({ from: '2026-10-03', to: '2026-10-03' });
  expect(second.last_taken).toEqual(first.last_taken);
  expect([...first.items, ...second.items].map((r) => r.row_type)).toEqual(['LEAVE', 'LEAVE']);
});
it('permissions and feature expiry use scope.now rather than cursor.as_of', async () => {
  await historyLeave(f, '2026-10-01');
  const shift = await historyShift(f, '2026-10-02');
  const cursor = encodeCursor({
    date: '2026-10-03',
    rank: 1,
    id: leaveIds.newId(),
    as_of: '2026-11-06T11:00:00.000Z',
  });
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,
    scope_type,scope_id,reason,granted_by,expires_at)
    VALUES(${f.company},${leaveIds.newId()},${f.memberId},'read:attendance:branch','DENY','BUSINESS',${f.business},
      'Synthetic expired deny',${f.userId},'2026-11-07T09:00:00Z')`;
  await f.h
    .owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by,expires_at)
    VALUES(${f.company},'staff',false,'Synthetic expired feature',${f.userId},'2026-11-07T09:00:00Z')`;
  try {
    expect((await historyRead(f, { cursor })).items.map((r) => r.id)).toContain(shift);
  } finally {
    await f.h
      .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND permission_code='read:attendance:branch'`;
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;
  }
});
