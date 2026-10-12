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
import { actorEmployee } from './attendance-actions-read.fixture.ts';
import { leaveIds } from './leave.fixture.ts';

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
  expect(first.can_decide_any).toBe(true);
  expect(attendanceChangeRequestPage.parse(await page({ limit: 1, status: 'REJECTED' }))).toEqual({
    can_decide_any: true,
    can_request: false,
    items: [],
    next_cursor: null,
  });
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
  expect(
    [...first.items, ...second.items]
      .filter((row) => row.kind === 'ADD_SESSION')
      .every((row) => row.session_state === null),
  ).toBe(true);
  expect(await page({ limit: 2, cursor: 'malformed' })).toBe('VALIDATION_FAILED');
});
it('scopes branch managers and projects requester cancellation independently from owner decision', async () => {
  await asRole(f, 'branch_manager');
  const result = attendanceChangeRequestPage.parse(await page({ limit: 50 }, f.approverId));
  expect(result.can_decide_any).toBe(false);
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
  // الإلغاء يعرض أوقات الجلسة، والإضافة اليدوية تعرض الأوقات المطلوبة المحفوظة في الطلب.
  expect(result.items.every((row) => row.requested !== null)).toBe(true);
  expect(result.items.filter((row) => row.kind === 'ADD_SESSION')[0]?.requested).toMatchObject({
    clock_in: changeInput(f).clock_in,
    clock_out: changeInput(f).clock_out,
  });
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
it('decide-only access remains visible in an empty requests page while board capabilities return 404', async () => {
  await asRole(f, 'accountant');
  const overrides = [
    ['decide:attendance-change:company', 'ALLOW'],
    ['read:attendance:branch', 'DENY'],
  ] as const;
  const ids = overrides.map(() => leaveIds.newId());
  try {
    for (const [index, [permission, effect]] of overrides.entries())
      await f.h
        .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
        VALUES(${f.company},${ids[index] as string},${f.approverMember},${permission},${effect},'COMPANY',${f.company},'Synthetic inbox access',${f.owner})`;
    const headers = { cookie: f.approverCookie, 'x-company-id': f.company };
    const board = await f.h.app.inject({
      method: 'GET',
      url: `/v1/businesses/${f.business}/branches/${f.branch}/attendance-capabilities`,
      headers,
    });
    expect(board.statusCode).toBe(404);
    const response = await f.h.app.inject({
      method: 'GET',
      url: `/v1/businesses/${f.business}/attendance-change-requests?status=REJECTED&limit=1`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(attendanceChangeRequestPage.parse(response.json())).toEqual({
      can_decide_any: true,
      can_request: false,
      items: [],
      next_cursor: null,
    });
  } finally {
    for (const id of ids)
      await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${id}`;
    await asRole(f, 'business_manager');
  }
});
it.each([false, true])(
  'company ALLOW with DENY on every active branch reports inbox access only for owner=%s',
  async (owner) => {
    await asRole(f, owner ? 'owner' : 'accountant');
    const ids: string[] = [];
    try {
      const branches = await f.h
        .owner`SELECT id FROM branches WHERE company_id=${f.company} AND business_id=${f.business} AND is_active`;
      const grants = [
        { scope: 'COMPANY', scopeId: f.company, effect: 'ALLOW' },
        ...branches.map((branch) => ({
          scope: 'BRANCH',
          scopeId: branch.id as string,
          effect: 'DENY',
        })),
      ];
      for (const grant of grants) {
        const id = leaveIds.newId();
        ids.push(id);
        await f.h
          .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
        VALUES(${f.company},${id},${f.approverMember},'decide:attendance-change:company',${grant.effect},${grant.scope},${grant.scopeId},'Synthetic denied branches',${f.owner})`;
      }
      const access = await f.db.withTenant(f.company, (tx) =>
        createAttendanceChangeReadAccess(f.clock).check(tx, context(f.approverId)),
      );
      expect(access?.decideBranches).toHaveLength(owner ? branches.length : 0);
      for (const status of ['PENDING', 'REJECTED'] as const) {
        const result = attendanceChangeRequestPage.parse(
          await page({ limit: 50, status }, f.approverId),
        );
        expect(result.can_decide_any).toBe(owner);
        expect(result.items.every((row) => row.can_decide === owner)).toBe(true);
      }
    } finally {
      for (const id of ids)
        await f.h
          .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${id}`;
      await asRole(f, 'business_manager');
    }
  },
);
it('permission on an inactive branch alone does not enable the inbox; an active allowed branch does', async () => {
  await asRole(f, 'accountant');
  const ids = [leaveIds.newId(), leaveIds.newId()];
  try {
    await f.h
      .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
      VALUES(${f.company},${ids[0] as string},${f.approverMember},'decide:attendance-change:company','ALLOW','COMPANY',${f.company},'Synthetic active scope',${f.owner}),
        (${f.company},${ids[1] as string},${f.approverMember},'decide:attendance-change:company','DENY','BRANCH',${f.branch},'Synthetic active scope',${f.owner})`;
    await f.h
      .owner`UPDATE branches SET is_active=false WHERE company_id=${f.company} AND id=${f.secondBranch}`;
    expect(
      attendanceChangeRequestPage.parse(await page({ limit: 50 }, f.approverId)).can_decide_any,
    ).toBe(false);
    await f.h
      .owner`UPDATE branches SET is_active=true WHERE company_id=${f.company} AND id=${f.secondBranch}`;
    expect(
      attendanceChangeRequestPage.parse(await page({ limit: 50 }, f.approverId)).can_decide_any,
    ).toBe(true);
  } finally {
    await f.h
      .owner`UPDATE branches SET is_active=true WHERE company_id=${f.company} AND id=${f.secondBranch}`;
    for (const id of ids)
      await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${id}`;
    await asRole(f, 'business_manager');
  }
});
it('list actor names resolve across businesses, and missing employee names stay null beside their ids', async () => {
  const initial = attendanceChangeRequestPage.parse(await page({ limit: 50 }));
  expect(
    initial.items.every((row) => row.requested_by_name === null && row.decided_by_name === null),
  ).toBe(true);
  const actor = await actorEmployee({
    ...f,
    scope: {
      companyId: f.company,
      businessId: f.business,
      branchId: f.branch,
      timezone: 'Asia/Kuwait',
    },
    boardClock: f.clock,
  });
  const named = attendanceChangeRequestPage.parse(await page({ limit: 50 }));
  expect(
    named.items.every(
      (row) => row.requested_by === f.approverId && row.requested_by_name?.en === actor.name.en,
    ),
  ).toBe(true);
  const target = initial.items.find((row) => row.kind === 'VOID_SESSION');
  await f.h
    .owner`UPDATE attendance_change_requests SET status='APPROVED',decided_by=${f.userId},decided_at='2026-10-04T10:00:00Z'
    WHERE company_id=${f.company} AND id=${target?.id as string}`;
  const decided = attendanceChangeRequestPage.parse(await page({ limit: 50, status: 'APPROVED' }));
  expect(decided.items[0]?.decided_by_name).toEqual({
    ar: f.employee.name_ar,
    en: f.employee.name_en,
  });
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
