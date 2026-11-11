import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { leavePage } from '@pospay/contracts';
import { employeeLeaveHistory } from '../queries/leave-requests.query.ts';
import { getEmployeeLeaveHistory } from '../queries/leave-history.query.ts';
import { createLeaveReadAccess } from '../persistence/leave-read-access.adapter.ts';
import {
  historyClear,
  historyLeave,
  historyRead,
  historyShift,
  historyNow,
  historyQuery,
  leaveContext,
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
const access = () => createLeaveReadAccess({ now: () => new Date(historyNow) });

it('LH-01/02/21: disjoint open/history union, period overlap and filters for all types and statuses', async () => {
  const seeded = await seedUnionRequests();
  const open = leavePage.parse(
    await f.db.withTenant(f.company, (tx) =>
      employeeLeaveHistory(
        tx,
        leaveContext(f),
        { open: 'true', as_of: historyNow, limit: 100 },
        access(),
      ),
    ),
  );
  const openIds = open.items.map((r) => r.id);
  // لا تتغير الحالات بين القراءتين؛ نافذة TD-2 مستبعدة عمداً من برهان الاتحاد.
  expect(openIds.sort()).toEqual(
    seeded
      .filter((r) => r.status === 'PENDING' || r.date >= '2026-11-07')
      .map((r) => r.id)
      .sort(),
  );
  for (const filters of [
    {},
    { 'types[]': ['SICK'] },
    { 'statuses[]': ['REJECTED'] },
    { 'types[]': ['SICK'], 'statuses[]': ['REJECTED'] },
  ]) {
    const q = historyQuery({ from: '2026-10-01', to: '2026-10-31', limit: 100, ...filters });
    const page = await historyRead(f, q);
    const expected = seeded.filter(
      (r) =>
        !openIds.includes(r.id) &&
        r.date >= q.from &&
        r.date <= q.to &&
        (q['types[]'].length === 0 || q['types[]'].includes(r.type as 'SICK')) &&
        (q['statuses[]'].length === 0 || q['statuses[]'].includes(r.status as 'REJECTED')),
    );
    expect(page.items.map((r) => r.id).sort()).toEqual(expected.map((r) => r.id).sort());
    expect(page.items.some((r) => openIds.includes(r.id))).toBe(false);
    const repeated = leavePage.parse(
      await f.db.withTenant(f.company, (tx) =>
        employeeLeaveHistory(
          tx,
          leaveContext(f),
          { open: 'true', as_of: historyNow, limit: 100 },
          access(),
        ),
      ),
    );
    expect(repeated).toEqual(open);
  }
  const all = await historyRead(f, { from: '2026-01-01', to: '2026-12-31', limit: 100 });
  expect([...openIds, ...all.items.map((r) => r.id)].sort()).toEqual(
    seeded.map((r) => r.id).sort(),
  );
  const overlap = await historyLeave(f, '2025-12-28', { to: '2026-01-03' });
  expect(
    (await historyRead(f, { from: '2026-01-01', to: '2026-01-01' })).items.map((r) => r.id),
  ).toContain(overlap);
});
it('LH-19: replacing a past shift changes derived absence without stored history', async () => {
  const id = await historyShift(f, '2026-10-01');
  expect((await historyRead(f)).items.map((r) => r.id)).toEqual([id]);
  await f.h.owner`DELETE FROM staff_schedule_shifts WHERE company_id=${f.company} AND id=${id}`;
  expect((await historyRead(f)).items).toEqual([]);
});
it('LH-20: concurrent approval returns consistent page/last_taken from exactly one statement', async () => {
  const id = await historyLeave(f, '2026-10-01', { status: 'REJECTED' });
  await historyShift(f, '2026-10-01');
  const scope = await f.db.withTenant(f.company, (tx) => access().check(tx, leaveContext(f)));
  let statements = 0;
  const read = f.db.withTenant(f.company, (tx) =>
    getEmployeeLeaveHistory(
      new Proxy(tx, {
        get(target, key, receiver) {
          if (key !== 'execute') return Reflect.get(target, key, receiver);
          return (...args: Parameters<typeof tx.execute>) => {
            statements++;
            return target.execute(...args);
          };
        },
      }),
      leaveContext(f),
      historyQuery(),
      { check: async () => scope },
    ),
  );
  const approve = f.h.owner`UPDATE leave_requests SET status='APPROVED',rejection_reason=NULL
    WHERE company_id=${f.company} AND id=${id}`;
  const [page] = await Promise.all([read, approve]);
  expect(statements).toBe(1);
  if (!page || typeof page === 'string') throw new Error('Expected history snapshot');
  const absent = page.items.some((r) => r.row_type === 'UNEXCUSED_ABSENCE');
  expect(page.last_taken?.annual).toEqual(absent ? null : { from: '2026-10-01', to: '2026-10-01' });
});

it('LH-27: the eligibility re-check rides the same statement that returns the page and last_taken', async () => {
  const id = await historyLeave(f, '2026-10-01');
  const scope = await f.db.withTenant(f.company, (tx) => access().check(tx, leaveContext(f)));
  expect(scope?.eligibilityDays.map((day) => day.branchId).sort()).toEqual(
    [f.branch, f.secondBranch].sort(),
  );
  let statements = 0;
  const result = await f.db.withTenant(f.company, (tx) =>
    getEmployeeLeaveHistory(
      new Proxy(tx, {
        get(target, key, receiver) {
          if (key !== 'execute') return Reflect.get(target, key, receiver);
          return (...args: Parameters<typeof tx.execute>) => {
            statements++;
            return target.execute(...args);
          };
        },
      }),
      leaveContext(f),
      historyQuery(),
      { check: async () => scope },
    ),
  );
  const page = result === null || typeof result === 'string' ? null : result;
  expect(statements).toBe(1);
  expect(page?.items.map((r) => r.id)).toEqual([id]);
  expect(page?.last_taken?.annual).toEqual({ from: '2026-10-01', to: '2026-10-01' });
});

async function seedUnionRequests() {
  const seeded: { id: string; type: string; status: string; date: string }[] = [];
  for (const type of ['ANNUAL', 'SICK', 'UNPAID', 'OTHER'])
    for (const status of ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'])
      for (const month of ['02', '10', '12']) {
        const n =
          ['ANNUAL', 'SICK', 'UNPAID', 'OTHER'].indexOf(type) * 4 +
          ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].indexOf(status) +
          1;
        const date = `2026-${month}-${String(n).padStart(2, '0')}`;
        seeded.push({ id: await historyLeave(f, date, { type, status }), type, status, date });
      }
  return seeded;
}
