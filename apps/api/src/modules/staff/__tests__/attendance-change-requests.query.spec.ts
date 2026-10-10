import {
  attendanceChangeFixture,
  changeActor,
  changeInput,
  type ChangeFixture,
} from './attendance-change.fixture.ts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { attendanceChangeRequestPage, type AttendanceChangeListQuery } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { asRole } from './attendance-exception.fixture.ts';
import { seedSession } from './attendance-correction.fixture.ts';
import { createAttendanceChangeReadAccess } from '../persistence/attendance-change-context.adapter.ts';
import {
  attendanceChangePageStatement,
  listAttendanceChangeRequests,
} from '../queries/attendance-change-requests.query.ts';

let f: ChangeFixture;
beforeAll(async () => {
  f = await attendanceChangeFixture();
  for (let i = 0; i < 3; i++) await f.fileChange.execute(changeActor(f), changeInput(f));
  const session_id = await seedSession(f, { employeeId: f.employee.id, branchId: f.secondBranch });
  await f.fileChange.execute(changeActor(f), {
    ...changeInput(f),
    kind: 'VOID_SESSION',
    session_revision: 0,
    session_id,
  });
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const context = (userId = f.owner) => ({ companyId: f.company, businessId: f.business, userId });
const page = (query: AttendanceChangeListQuery, userId = f.owner) =>
  f.db.withTenant(f.company, (tx) =>
    listAttendanceChangeRequests(
      tx,
      context(userId),
      query,
      createAttendanceChangeReadAccess(f.clock),
    ),
  );

it('projects the contract and paginates tied timestamps in descending id order', async () => {
  const first = attendanceChangeRequestPage.parse(await page({ limit: 2 }));
  expect(first.items).toHaveLength(2);
  expect(first.items.every((r) => r.can_decide && !r.can_cancel)).toBe(true);
  expect(first.items[0]?.employee).toMatchObject({
    id: f.employee.id,
    name_en: expect.any(String),
  });
  const second = attendanceChangeRequestPage.parse(
    await page({ limit: 2, cursor: first.next_cursor ?? '' }),
  );
  const ids = [...first.items, ...second.items].map((r) => r.id);
  expect(new Set(ids).size).toBe(4);
  expect(ids).toEqual([...ids].sort().reverse());
  expect(second.next_cursor).toBeNull();
  expect(await page({ limit: 2, cursor: 'malformed' })).toBe('VALIDATION_FAILED');
});
it('scopes branch managers and projects requester cancellation independently from owner decision', async () => {
  await asRole(f, 'branch_manager');
  const result = attendanceChangeRequestPage.parse(await page({ limit: 50 }, f.approverId));
  expect(result.items).toHaveLength(4);
  expect(result.items.every((r) => !r.can_decide && r.can_cancel)).toBe(true);
  const own = attendanceChangeRequestPage.parse(
    await page({ limit: 50, branch_id: f.secondBranch }, f.approverId),
  );
  expect(own.items).toHaveLength(1);
  expect(own.items[0]).toMatchObject({ branch_id: f.secondBranch, can_cancel: true });
  const owner = attendanceChangeRequestPage.parse(
    await page({
      limit: 50,
      branch_id: f.secondBranch,
      kind: 'VOID_SESSION',
      employee_id: f.employee.id,
      status: 'PENDING',
    }),
  );
  expect(owner.items).toHaveLength(1);
  expect(owner.items[0]?.requested).toEqual({
    working_date: '2026-10-04',
    timezone: 'Asia/Kuwait',
    clock_in: '2026-10-04T05:00:00.000Z',
    clock_out: '2026-10-04T08:00:00.000Z',
  });
  expect(result.items.every((row) => row.requested === null)).toBe(true);
  await asRole(f, 'business_manager');
});
it('the HTTP list uses the same access policy and contract', async () => {
  const response = await f.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${f.business}/attendance-change-requests?status=PENDING&limit=2`,
    headers: { cookie: f.approverCookie, 'x-company-id': f.company },
  });
  expect(response.statusCode).toBe(200);
  expect(attendanceChangeRequestPage.parse(response.json()).items).toHaveLength(2);
});
it('EXPLAIN ANALYZE uses inbox and branch indexes for the owner inbox filters', async () => {
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const access = {
      owner: true,
      canDecide: true,
      decideBranches: [f.branch, f.secondBranch],
      branches: [f.branch, f.secondBranch],
    };
    for (const [query, index] of [
      [{ status: 'PENDING', limit: 50 }, 'attendance_change_requests_inbox_idx'],
      [
        { status: 'PENDING', branch_id: f.branch, limit: 50 },
        'attendance_change_requests_branch_idx',
      ],
    ] as const) {
      const plan = await tx.execute(
        sql`EXPLAIN (ANALYZE,FORMAT JSON) ${attendanceChangePageStatement(context(), query, access)}`,
      );
      expect(JSON.stringify(plan)).toContain(index);
    }
  });
});
