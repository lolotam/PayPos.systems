import { afterAll, beforeAll, expect, it } from 'vitest';
import { leavePage } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import {
  decisionActor,
  leaveDecisionFixture,
  type LeaveDecisionFixture,
} from './leave-decision.fixture.ts';
import { leaveActor, leaveContext, leaveTerms } from './leave.fixture.ts';
import {
  employeeLeaveHistory,
  pendingLeaveInbox,
  leavePageSql,
} from '../queries/leave-requests.query.ts';
let f: LeaveDecisionFixture;
let ids: string[];
beforeAll(async () => {
  f = await leaveDecisionFixture();
  ids = [];
  for (const [from, to, branchId] of [
    ['2027-07-01', '2027-07-03', f.branch],
    ['2027-07-05', '2027-07-05', f.branch],
    ['2027-07-07', '2027-07-07', f.secondBranch],
  ] as const)
    ids.push((await f.request.execute({ ...leaveActor(f), branchId }, leaveTerms(from, to))).id);
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const manager = () => ({
  companyId: f.company,
  businessId: f.business,
  userId: f.approverId,
  own: false,
});
it('filters saved local date intersection and branch before cursor, including inclusive boundaries', async () => {
  const read = (query: {
    limit: number;
    from?: string;
    to?: string;
    branch_id?: string;
    cursor?: string;
  }) => f.db.withTenant(f.company, (tx) => pendingLeaveInbox(tx, manager(), query, f.access));
  const first = leavePage.parse(await read({ limit: 1, from: '2027-07-02', to: '2027-07-07' }));
  expect(first.items[0]).toMatchObject({
    id: ids[0],
    can_decide: true,
    can_revoke: false,
    employee_name_en: 'Synthetic employee',
  });
  expect(first.next_cursor).toBe(ids[0]);
  const second = leavePage.parse(
    await read({
      limit: 1,
      from: '2027-07-02',
      to: '2027-07-07',
      cursor: first.next_cursor as string,
      branch_id: f.branch,
    }),
  );
  expect(second.items.map((r) => r.id)).toEqual([ids[1]]);
  expect(second.next_cursor).toBeNull();
  expect(
    leavePage
      .parse(await read({ limit: 20, from: '2027-07-03', to: '2027-07-03' }))
      .items.map((r) => r.id),
  ).toEqual([ids[0]]);
  expect(
    leavePage.parse(await read({ limit: 20, from: '2027-07-04', to: '2027-07-04' })).items,
  ).toEqual([]);
  expect(
    leavePage.parse(await read({ limit: 20, branch_id: f.secondBranch })).items.map((r) => r.id),
  ).toEqual([ids[2]]);
});
it('history exposes reasons and captured decision, own flags never expose manager authority', async () => {
  const leaveId = ids[0] as string;
  await f.decide.execute(decisionActor(f, leaveId), {
    decision: 'APPROVED',
    expected_revision: 1,
    reason: 'Synthetic approval',
  });
  const history = leavePage.parse(
    await f.db.withTenant(f.company, (tx) =>
      employeeLeaveHistory(
        tx,
        { ...leaveContext(f), userId: f.approverId },
        { limit: 20 },
        f.access,
      ),
    ),
  );
  expect(history.items[0]).toMatchObject({
    status: 'APPROVED',
    decided_by: f.approverId,
    decided_at: f.clock.now().toISOString(),
    decision_reason: 'Synthetic approval',
    can_decide: false,
    can_revoke: true,
  });
  const own = leavePage.parse(
    await f.db.withTenant(f.company, (tx) =>
      employeeLeaveHistory(
        tx,
        { ...leaveContext(f), own: true, branchId: f.branch },
        { limit: 20 },
        f.access,
      ),
    ),
  );
  for (const item of own.items)
    expect(item).toMatchObject({ can_decide: false, can_revoke: false });
  const inbox = leavePage.parse(
    await f.db.withTenant(f.company, (tx) =>
      pendingLeaveInbox(tx, manager(), { limit: 20 }, f.access),
    ),
  );
  expect(inbox.items.map((r) => r.id)).toEqual(ids.slice(1));
});
it('EXPLAIN ANALYZE uses the composite branch/date index and tenant-bound employee lookup', async () => {
  await f.h
    .owner`INSERT INTO leave_requests(company_id,id,business_id,branch_id,employee_id,kind,"from","to",timezone,starts_at,ends_at,type,requested_by,requested_at)
    SELECT ${f.company},gen_random_uuid(),${f.business},${f.branch},${f.employee.id},'FULL_DAY',date '2028-01-01'+n,date '2028-01-01'+n,'Asia/Kuwait',
    (date '2028-01-01'+n)::timestamp AT TIME ZONE 'Asia/Kuwait',(date '2028-01-02'+n)::timestamp AT TIME ZONE 'Asia/Kuwait','ANNUAL',${f.userId},'2026-10-04T10:00Z' FROM generate_series(0,999) n`;
  await f.h.owner`ANALYZE leave_requests`;
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const scope = await f.access.check(tx, manager());
    if (!scope) throw new Error('Missing scope');
    return tx.execute(
      sql`EXPLAIN(ANALYZE,FORMAT JSON) ${leavePageSql(manager(), { limit: 20, branch_id: f.branch, from: '2028-01-01', to: '2028-01-01' }, scope, true)}`,
    );
  });
  const json = JSON.stringify(plan);
  expect(json).toContain('leave_requests_company_business_branch_dates_idx');
  expect(json).toMatch(/employees_pkey|employees_company/);
});
