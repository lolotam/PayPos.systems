import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { encodeCursor } from '../../../shared/persistence/name-options-cursor.ts';
import {
  expectPage,
  historyClear,
  historyEmployee,
  historyLeave,
  historyNow,
  historyRead,
  historyReport,
  historyShift,
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

it('LH-14: unfiltered report lists multiple employees ordered date DESC, rank, id DESC and pages without repeats', async () => {
  const otherEmployee = await historyEmployee(f, 'Synthetic other employee');
  const e1Leave = await historyLeave(f, '2026-10-02', { employee: f.employee.id });
  const e2Absence = await historyShift(f, '2026-10-02', { employee: otherEmployee });
  const e2Leave = await historyLeave(f, '2026-10-01', { employee: otherEmployee });
  const e1Absence = await historyShift(f, '2026-10-01', { employee: f.employee.id });

  const page = expectPage(await historyReport(f, { from: '2026-10-01', to: '2026-10-02' }));

  const expectedIds = [e1Leave, e2Absence, e2Leave, e1Absence];
  expect(page.items.map((r) => r.id)).toEqual(expectedIds);

  const paginated: typeof page.items = [];
  let cursor: string | null = null;
  do {
    const next: typeof page = expectPage(
      await historyReport(f, {
        from: '2026-10-01',
        to: '2026-10-02',
        limit: 1,
        ...(cursor ? { cursor } : {}),
      }),
    );
    paginated.push(...next.items);
    cursor = next.next_cursor;
  } while (cursor);

  expect(paginated.map((r) => r.id)).toEqual(expectedIds);
});

it('LH-14b: report lists old pending and ending today requests while the tab excludes them', async () => {
  const pending = await historyLeave(f, '2026-10-01', { status: 'PENDING' });
  const endingToday = await historyLeave(f, '2026-11-05', {
    to: '2026-11-07',
    status: 'APPROVED',
  });

  const report = expectPage(
    await historyReport(f, {
      employee_id: f.employee.id,
      from: '2026-10-01',
      to: '2026-11-07',
    }),
  );
  const reportIds = report.items.map((r) => r.id);
  expect(reportIds).toContain(pending);
  expect(reportIds).toContain(endingToday);

  const tab = await historyRead(f, { from: '2026-10-01', to: '2026-11-07' });
  const tabIds = tab.items.map((r) => r.id);
  expect(tabIds).not.toContain(pending);
  expect(tabIds).not.toContain(endingToday);
});

it('last_taken is null without employee_id and matches tab when employee_id is specified', async () => {
  await historyLeave(f, '2026-09-01', { to: '2026-09-05', type: 'ANNUAL' });
  await historyLeave(f, '2026-09-10', { to: '2026-09-12', type: 'SICK' });
  await historyShift(f, '2026-09-15');

  const unfiltered = expectPage(await historyReport(f, { from: '2026-09-01', to: '2026-09-30' }));
  expect(unfiltered.last_taken).toBeNull();

  const filtered = expectPage(
    await historyReport(f, { employee_id: f.employee.id, from: '2026-09-01', to: '2026-09-30' }),
  );
  const tab = await historyRead(f, { from: '2026-09-01', to: '2026-09-30' });
  expect(filtered.items).toEqual(tab.items);
  expect(filtered.last_taken).toEqual(tab.last_taken);
  expect(filtered.last_taken?.annual).toEqual({ from: '2026-09-01', to: '2026-09-05' });
  expect(filtered.last_taken?.sick).toEqual({ from: '2026-09-10', to: '2026-09-12' });
  expect(filtered.last_taken?.unexcused_absence).toBe('2026-09-15');
});

it('employee_id, types, statuses, and branch_id filter results and out-of-scope branch answers null', async () => {
  const otherEmployee = await historyEmployee(f, 'Synthetic other employee');
  const e1Leave = await historyLeave(f, '2026-10-01', {
    employee: f.employee.id,
    type: 'ANNUAL',
  });
  const e2Leave = await historyLeave(f, '2026-10-02', { employee: otherEmployee, type: 'SICK' });
  const shift = await historyShift(f, '2026-10-03', { employee: f.employee.id });

  const onlyE1 = expectPage(await historyReport(f, { employee_id: f.employee.id }));
  expect(onlyE1.items.map((r) => r.id)).toEqual([shift, e1Leave]);

  const onlyAnnual = expectPage(await historyReport(f, { 'types[]': ['ANNUAL'] }));
  expect(onlyAnnual.items.map((r) => r.id)).toEqual([e1Leave]);

  const onlyAbsent = expectPage(await historyReport(f, { 'statuses[]': ['ABSENT'] }));
  expect(onlyAbsent.items.map((r) => r.id)).toEqual([shift]);

  const byBranch = expectPage(await historyReport(f, { branch_id: f.branch }));
  expect(byBranch.items.map((r) => r.id)).toEqual([shift, e2Leave, e1Leave]);

  const outOfScope = await historyReport(f, { branch_id: f.foreignBranch });
  expect(outOfScope).toBeNull();
});

it('request_branch_ids and absence_branch_ids match the employee tab metadata', async () => {
  await historyLeave(f, '2026-10-01', { branch: f.secondBranch });
  await historyShift(f, '2026-10-02');
  const report = expectPage(await historyReport(f));
  const tab = await historyRead(f);
  expect(report.request_branch_ids.length).toBeGreaterThan(0);
  expect(report.request_branch_ids).toEqual(tab.request_branch_ids);
  expect(report.absence_branch_ids).toEqual(tab.absence_branch_ids);
});

it.each([
  ['now', 0, true],
  ['now - 24h', -86_400_000, true],
  ['now + 1ms', 1, false],
  ['now - 24h - 1ms', -86_400_001, false],
])('cursor as_of edge %s accepted=%s', async (_, offsetMs, accepted) => {
  const as_of = new Date(Date.parse(historyNow) + offsetMs).toISOString();
  const cursor = encodeCursor({
    date: '2026-10-01',
    rank: 1,
    id: leaveIds.newId(),
    as_of,
  });
  const result = await historyReport(f, { cursor });
  expect(result === 'VALIDATION_FAILED').toBe(!accepted);
});
