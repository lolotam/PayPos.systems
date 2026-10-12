import { afterAll, beforeAll, expect, it } from 'vitest';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import {
  attendanceExceptionsListQuery,
  attendanceExceptionPage,
  attendanceCorrectionHistory,
} from '@pospay/contracts';
import {
  attendanceActionsReadFixture,
  type ActionsReadFixture,
} from './attendance-actions-read.fixture.ts';
import { asRole, decision, exceptionActor, openException } from './attendance-exception.fixture.ts';
import { leaveIds } from './leave.fixture.ts';
import { REQUEST_AUTHORIZER } from '../../../shared/request-authorizer.ts';
import type { AttendanceExceptionReadAccess } from '../queries/attendance-exceptions.query.ts';
import { AttendanceExceptionsReadController } from '../http/attendance-exceptions-read.controller.ts';
import { attendanceBoardContext } from '../persistence/attendance-board-context.adapter.ts';

let f: ActionsReadFixture;
beforeAll(async () => {
  f = await attendanceActionsReadFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const send = (resource: string, branch = f.branch, business = f.business, query = '') =>
  f.h.send('GET', `/v1/businesses/${business}/branches/${branch}/${resource}${query}`, {
    cookie: f.approverCookie,
    company: f.company,
  });
const resources = () => [
  'attendance-exceptions',
  `attendance-sessions/${f.hidden.sessionId}/corrections`,
];

it('branch manager reads its branch and receives identical NOT_FOUND for other, foreign and missing branches', async () => {
  await asRole(f, 'branch_manager');
  for (const resource of resources()) {
    expect((await send(resource)).status).toBe(200);
    const denied = await send(resource, f.secondBranch);
    expect(denied.status).toBe(404);
    expect(denied.body.code).toBe('NOT_FOUND');
    for (const branch of [f.foreignBranch, leaveIds.newId()])
      expect((await send(resource, branch)).body).toEqual(denied.body);
  }
});
it('owner can read other branches while session history still requires the persisted branch', async () => {
  await asRole(f, 'owner');
  expect((await send('attendance-exceptions', f.secondBranch)).status).toBe(200);
  expect(
    (await send(`attendance-sessions/${f.otherBranchSession}/corrections`, f.secondBranch)).body,
  ).toEqual({ items: [] });
  for (const session of [f.otherBranchSession, f.foreign.session, leaveIds.newId()]) {
    const result = await send(`attendance-sessions/${session}/corrections`);
    expect(result.status).toBe(404);
    expect(result.body.code).toBe('NOT_FOUND');
  }
  expect((await send('attendance-exceptions', f.foreignBranch, f.foreign.businessId)).status).toBe(
    404,
  );
});
it('personal DENY defeats the general manager default on both routes', async () => {
  await asRole(f, 'general_manager');
  const override = leaveIds.newId();
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${override},${f.approverMember},'read:attendance:branch','DENY','BRANCH',${f.branch},'synthetic',${f.userId})`;
  try {
    for (const resource of resources()) expect((await send(resource)).status).toBe(404);
  } finally {
    await f.h
      .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${override}`;
  }
});
it('business/branch consistency and upper-case ids follow the board pattern', async () => {
  await asRole(f, 'owner');
  for (const resource of resources()) {
    const canonical = await send(resource);
    const upper = await send(
      resource.replace(f.hidden.sessionId, f.hidden.sessionId.toUpperCase()),
      f.branch.toUpperCase(),
      f.business.toUpperCase(),
    );
    expect(canonical.status).toBe(200);
    expect(upper.status).toBe(200);
    expect(upper.body).toEqual(canonical.body);
    expect(
      (await send(resource, f.branch.toUpperCase(), f.secondBusiness.toUpperCase())).status,
    ).toBe(404);
  }
});
it('default OPEN page hides voided exceptions, validates bounds and paginates through the HTTP contract', async () => {
  expect(attendanceExceptionsListQuery.parse({})).toEqual({ status: 'OPEN', limit: 50 });
  const first = attendanceExceptionPage.parse(
    (await send('attendance-exceptions', f.branch, f.business, '?limit=1')).body,
  );
  const second = attendanceExceptionPage.parse(
    (
      await send(
        'attendance-exceptions',
        f.branch,
        f.business,
        `?limit=1&cursor=${encodeURIComponent(first.next_cursor ?? '')}`,
      )
    ).body,
  );
  expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(2);
  expect(second.next_cursor).toBeNull();
  expect([...first.items, ...second.items].some((row) => row.id === f.hidden.id)).toBe(false);
  const resolved = attendanceExceptionPage.parse(
    (await send('attendance-exceptions', f.branch, f.business, '?status=RESOLVED')).body,
  );
  expect(resolved.items[0]?.id).toBe(f.resolved.id);
  for (const query of [
    '?status=PENDING',
    '?limit=101',
    '?limit=0',
    '?cursor=invalid',
    `?branch_id=${f.branch}`,
  ]) {
    const result = await send('attendance-exceptions', f.branch, f.business, query);
    expect(result.status).toBe(400);
    expect(result.body.code).toBe('VALIDATION_FAILED');
  }
  const history = attendanceCorrectionHistory.parse((await send(resources()[1] ?? '')).body);
  expect(history.items).toHaveLength(3);
  expect(history.items[1]?.corrected_by.name).toEqual(f.actor.name);
});
it('staff feature disabled returns FEATURE_DISABLED after the shared permission check', async () => {
  await f.h
    .owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES(${f.company},'staff',false,'synthetic',${f.userId})`;
  try {
    for (const resource of resources()) {
      const result = await send(resource);
      expect(result.status).toBe(403);
      expect(result.body.code).toBe('FEATURE_DISABLED');
    }
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;
  }
});
it.each([true, false])(
  'session in A and exception in B resolves only with authority in B: %s',
  async (inB) => {
    await asRole(f, 'branch_manager');
    const exception = await openException(f, 'NONE');
    await f.h.owner`UPDATE attendance_exceptions SET branch_id=${f.secondBranch}
    WHERE company_id=${f.company} AND id=${exception.id}`;
    await f.h.owner`UPDATE memberships SET scope_id=${inB ? f.secondBranch : f.branch}
    WHERE company_id=${f.company} AND id=${f.approverMember}`;
    const readGrant = leaveIds.newId();
    await f.h
      .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${readGrant},${f.approverMember},'read:attendance:branch','ALLOW','BRANCH',${f.branch},'synthetic',${f.userId})`;
    try {
      const response = await send('attendance-exceptions');
      expect(response.status).toBe(200);
      const row = attendanceExceptionPage
        .parse(response.body)
        .items.find((item) => item.id === exception.id);
      expect(row).toMatchObject({ branch_id: f.secondBranch, own: false, can_resolve: inB });
      if (inB)
        expect(await f.resolve.execute(exceptionActor(f, exception.id), decision())).toMatchObject({
          status: 'RESOLVED',
        });
      else
        await expect(
          f.resolve.execute(exceptionActor(f, exception.id), decision()),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await f.h
        .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${readGrant}`;
      await asRole(f, 'branch_manager');
    }
  },
);
it('owner cannot resolve an exception on her own attendance', async () => {
  await asRole(f, 'owner');
  await f.h
    .owner`UPDATE employees SET user_id=${f.approverId} WHERE company_id=${f.company} AND id=${f.employee.id}`;
  try {
    const response = await send('attendance-exceptions');
    expect(response.status).toBe(200);
    expect(
      attendanceExceptionPage
        .parse(response.body)
        .items.every((row) => row.own && !row.can_resolve),
    ).toBe(true);
  } finally {
    await f.h
      .owner`UPDATE employees SET user_id=${f.userId} WHERE company_id=${f.company} AND id=${f.employee.id}`;
  }
});
it('shared authorization starts after the list transaction releases its connection', async () => {
  let reading = false;
  let checks = 0;
  const database: TenantWrappers = {
    ...f.db,
    withTenant: (companyId, work, options) =>
      f.db.withTenant(
        companyId,
        async (tx) => {
          reading = true;
          try {
            return await work(tx);
          } finally {
            reading = false;
          }
        },
        options,
      ),
  };
  const shared = f.h.app.get<AttendanceExceptionReadAccess>(REQUEST_AUTHORIZER);
  const authorizer: AttendanceExceptionReadAccess = {
    executeBranches: (input) => {
      expect(reading).toBe(false);
      checks++;
      return shared.executeBranches(input);
    },
  };
  const controller = new AttendanceExceptionsReadController(
    database,
    attendanceBoardContext,
    authorizer,
  );
  const request = {
    principal: { companyId: f.company, userId: f.approverId },
  } as unknown as FastifyRequest;
  const page = await controller.list(f.business, f.branch, { status: 'OPEN', limit: 50 }, request);
  expect(page.items.length).toBeGreaterThan(0);
  expect(checks).toBe(1);
});

it('a page spanning many movement branches makes one batched access read', async () => {
  await asRole(f, 'owner');
  const branches = Array.from({ length: 12 }, () => leaveIds.newId());
  const exceptions: string[] = [];
  for (const branch of branches) {
    await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en)
      VALUES(${f.company},${branch},${f.business},'Synthetic movement branch')`;
    for (let n = 0; n < 2; n++) {
      const exception = await openException(f, 'NONE');
      exceptions.push(exception.id);
      await f.h.owner`UPDATE attendance_exceptions SET branch_id=${branch}
        WHERE company_id=${f.company} AND id=${exception.id}`;
    }
  }
  const shared = f.h.app.get<AttendanceExceptionReadAccess>(REQUEST_AUTHORIZER);
  let reads = 0;
  const authorizer: AttendanceExceptionReadAccess = {
    executeBranches: (input) => {
      reads++;
      expect(new Set(input.branchParams).size).toBe(input.branchParams.length);
      expect(input.branchParams).toEqual(expect.arrayContaining(branches));
      return shared.executeBranches(input);
    },
  };
  const controller = new AttendanceExceptionsReadController(
    f.db,
    attendanceBoardContext,
    authorizer,
  );
  const request = {
    principal: { companyId: f.company, userId: f.approverId },
  } as unknown as FastifyRequest;
  const statementsBefore = f.h.calls.statements.length;
  const page = await controller.list(f.business, f.branch, { status: 'OPEN', limit: 50 }, request);
  expect(page.items.filter((row) => exceptions.includes(row.id))).toHaveLength(24);
  expect(page.items.every((row) => row.can_resolve && !row.own)).toBe(true);
  expect(reads).toBe(1);
  expect(
    f.h.calls.statements
      .slice(statementsBefore)
      .filter(({ sql }) => sql.includes('rp.permission_code AS permission')),
  ).toHaveLength(1);
});
