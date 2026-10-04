import { leavePage } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  employeeLeaveHistory,
  pendingLeaveInbox,
  leavePageSql,
} from '../queries/leave-requests.query.ts';
import {
  leaveActor,
  leaveContext,
  leaveFixture,
  leaveIds,
  leaveTerms,
  type LeaveFixture,
} from './leave.fixture.ts';
let f: LeaveFixture;
let firstId: string;
let secondId: string;
beforeAll(async () => {
  f = await leaveFixture();
  firstId = (await f.request.execute(leaveActor(f), leaveTerms())).id;
  secondId = (
    await f.request.execute(
      { ...leaveActor(f), branchId: f.secondBranch },
      { kind: 'PARTIAL', date: '2027-01-02', start: '09:15', end: '10:30', type: 'UNPAID' },
    )
  ).id;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
it('projects contract-safe history, stable cursors and pending inbox', async () => {
  const first = leavePage.parse(
    await f.db.withTenant(f.company, (tx) =>
      employeeLeaveHistory(tx, leaveContext(f), { limit: 1 }, f.access),
    ),
  );
  expect(first.items).toHaveLength(1);
  expect(first.items[0]).toMatchObject({ id: firstId, can_cancel: true });
  expect(first.next_cursor).toBe(firstId);
  expect(first.request_branch_ids.sort()).toEqual([f.branch, f.secondBranch].sort());
  const second = leavePage.parse(
    await f.db.withTenant(f.company, (tx) =>
      employeeLeaveHistory(tx, leaveContext(f), { limit: 1, cursor: firstId }, f.access),
    ),
  );
  expect(second.items[0]).toMatchObject({
    id: secondId,
    kind: 'PARTIAL',
    start: '09:15',
    starts_at: '2027-01-02T06:15:00.000Z',
  });
  expect(second.next_cursor).toBeNull();
  await f.cancel.execute({ ...leaveActor(f), leaveId: firstId }, { expected_revision: 1 });
  const { employeeId: _employee, ...context } = leaveContext(f);
  void _employee;
  const inbox = leavePage.parse(
    await f.db.withTenant(f.company, (tx) =>
      pendingLeaveInbox(tx, context, { limit: 20 }, f.access),
    ),
  );
  expect(inbox.items.map((r) => r.id)).toEqual([secondId]);
});
it('filters branch scope before pagination and returns uniform hidden employee results', async () => {
  await f.h
    .owner`UPDATE memberships SET scope_type='BRANCH',scope_id=${f.branch} WHERE company_id=${f.company} AND id=${f.memberId}`;
  const read = await f.db.withTenant(f.company, (tx) =>
    employeeLeaveHistory(tx, leaveContext(f), { limit: 20 }, f.access),
  );
  expect(leavePage.parse(read).items.map((r) => r.id)).toEqual([firstId]);
  for (const employeeId of [leaveIds.newId(), f.otherCompany])
    expect(
      await f.db.withTenant(f.company, (tx) =>
        employeeLeaveHistory(tx, { ...leaveContext(f), employeeId }, { limit: 20 }, f.access),
      ),
    ).toBeNull();
  expect(
    await f.db.withTenant(f.otherCompany, (tx) =>
      employeeLeaveHistory(
        tx,
        { ...leaveContext(f), companyId: f.otherCompany },
        { limit: 20 },
        f.access,
      ),
    ),
  ).toBeNull();
});
it('EXPLAIN ANALYZE proves indexed history, pending inbox and instant overlap lookup', async () => {
  const plans = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const c = leaveContext(f),
      scope = { branches: [f.branch], cancelBranches: [f.branch] };
    return Promise.all([
      tx.execute(
        sql`EXPLAIN (ANALYZE,FORMAT JSON) ${leavePageSql(c, { limit: 20 }, scope, false)}`,
      ),
      tx.execute(
        sql`EXPLAIN (ANALYZE,FORMAT JSON) ${leavePageSql({ companyId: c.companyId, userId: c.userId, businessId: c.businessId, own: false }, { limit: 20 }, scope, true)}`,
      ),
      tx.execute(
        sql`EXPLAIN (ANALYZE,FORMAT JSON) SELECT id FROM leave_requests WHERE company_id=${f.company} AND employee_id=${f.employee.id} AND status IN ('PENDING','APPROVED') AND starts_at<'2027-02-01'::timestamptz AND ends_at>'2027-01-01'::timestamptz`,
      ),
    ]);
  });
  for (const plan of plans)
    expect(JSON.stringify(plan)).toMatch(
      /leave_requests_(company_(employee|inbox|business)|no_overlap|pkey)/,
    );
});
it('keeps pending history and cancellation in scope after branch deactivation, but refuses new requests', async () => {
  const made = await f.request.execute(leaveActor(f), leaveTerms('2027-05-01'));
  await f.h
    .owner`UPDATE branches SET is_active=false WHERE company_id=${f.company} AND id=${f.branch}`;
  const history = leavePage.parse(
    await f.db.withTenant(f.company, (tx) =>
      employeeLeaveHistory(tx, leaveContext(f), { limit: 20 }, f.access),
    ),
  );
  expect(history.items.find((r) => r.id === made.id)?.can_cancel).toBe(true);
  expect(history.request_branch_ids).not.toContain(f.branch);
  const { employeeId: _employee, ...context } = leaveContext(f);
  void _employee;
  const inbox = leavePage.parse(
    await f.db.withTenant(f.company, (tx) =>
      pendingLeaveInbox(tx, context, { limit: 20 }, f.access),
    ),
  );
  expect(inbox.items.map((r) => r.id)).toEqual([made.id]);
  expect(
    await f.cancel.execute({ ...leaveActor(f), leaveId: made.id }, { expected_revision: 1 }),
  ).toMatchObject({ status: 'CANCELLED' });
  await expect(f.request.execute(leaveActor(f), leaveTerms('2027-05-02'))).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
});
