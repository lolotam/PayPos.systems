import 'reflect-metadata';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { attendanceCapabilities } from '@pospay/contracts';
import { SYSTEM_ROLES } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { REQUIRE_ACCESS } from '../../../shared/access.decorators.ts';
import { REQUEST_AUTHORIZER, type RequestAuthorizer } from '../../../shared/request-authorizer.ts';
import { readAttendanceCapabilities } from '../queries/attendance-capabilities.query.ts';
import {
  attendanceCorrectionFixture,
  type AttendanceCorrectionFixture,
} from './attendance-correction.fixture.ts';
import { asRole } from './attendance-exception.fixture.ts';
import { leaveIds } from './leave.fixture.ts';

let f: AttendanceCorrectionFixture;
let authorizer: RequestAuthorizer;
let guard: CanActivate;
const codes = {
  correct: 'correct:attendance:branch',
  resolve: 'resolve:attendance:branch',
  request_change: 'request:attendance-change:branch',
  decide: 'decide:attendance-change:company',
} as const;
beforeAll(async () => {
  f = await attendanceCorrectionFixture();
  authorizer = f.h.app.get<RequestAuthorizer>(REQUEST_AUTHORIZER);
  const modules = f.h.app.get(ModulesContainer);
  const provider = [...modules.values()]
    .flatMap((module) => [...module.providers.values()])
    .find((entry) => entry.metatype?.name === 'AccessGuard');
  if (!provider?.instance) throw new Error('SHARED_ACCESS_GUARD_MISSING');
  guard = provider.instance as CanActivate;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const scope = () => ({
  companyId: f.company,
  businessId: f.business,
  branchId: f.branch,
  timezone: 'Asia/Kuwait',
});
const send = (branch = f.branch, business = f.business) =>
  f.h.send('GET', `/v1/businesses/${business}/branches/${branch}/attendance-capabilities`, {
    cookie: f.approverCookie,
    company: f.company,
  });

async function guardAllows(permission: string) {
  const handler = () => undefined;
  Reflect.defineMetadata(
    REQUIRE_ACCESS,
    {
      permissions: [permission],
      target: permission.endsWith(':company') ? {} : { branch: 'branchId' },
    },
    handler,
  );
  const request = {
    headers: { 'x-company-id': f.company },
    params: { branchId: f.branch },
    principal: { userId: f.approverId, grants: [] },
  };
  const context = {
    getHandler: () => handler,
    getClass: () => Object,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  try {
    return await guard.canActivate(context);
  } catch (error) {
    expect(error).toMatchObject({ code: 'FORBIDDEN' });
    return false;
  }
}
async function overrides(effect: 'ALLOW' | 'DENY') {
  for (const permission of Object.values(codes))
    await f.h
      .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
      VALUES(${f.company},${leaveIds.newId()},${f.approverMember},${permission},${effect},'COMPANY',${f.company},'Synthetic parity grant',${f.userId})`;
}
it.each([
  'role default',
  'personal ALLOW',
  'personal DENY',
  'owner with DENY',
  'device role',
  'expired membership',
])('capabilities equal the shared guard: %s', async (cell) => {
  await f.h
    .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.approverMember}`;
  await f.h
    .owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${f.company} AND id=${f.approverMember}`;
  await asRole(f, cell === 'owner with DENY' ? 'owner' : 'general_manager');
  if (cell === 'personal ALLOW') {
    await asRole(f, 'accountant');
    await overrides('ALLOW');
  } else if (cell === 'personal DENY' || cell === 'owner with DENY') await overrides('DENY');
  else if (cell === 'device role') {
    const device = SYSTEM_ROLES.find((role) => role.code === 'device');
    if (!device) throw new Error('MISSING_DEVICE_ROLE');
    await f.h
      .owner`UPDATE memberships SET role_id=${device.id} WHERE company_id=${f.company} AND id=${f.approverMember}`;
  } else if (cell === 'expired membership')
    await f.h
      .owner`UPDATE memberships SET starts_at=now()-interval '1 day',ends_at=now()-interval '1 second'
        WHERE company_id=${f.company} AND id=${f.approverMember}`;
  const result = await readAttendanceCapabilities(authorizer, scope(), f.approverId);
  for (const [key, permission] of Object.entries(codes))
    expect(result[key as keyof typeof codes], permission).toBe(await guardAllows(permission));
  expect(result).toEqual(
    cell === 'role default'
      ? { correct: true, resolve: true, request_change: true, decide: false }
      : {
          correct: cell === 'owner with DENY',
          resolve: cell === 'owner with DENY',
          request_change: ['personal ALLOW', 'owner with DENY'].includes(cell),
          decide: ['personal ALLOW', 'owner with DENY'].includes(cell),
        },
  );
  const response = await send();
  expect(response.status).toBe(['device role', 'expired membership'].includes(cell) ? 404 : 200);
  if (response.status === 200) expect(attendanceCapabilities.parse(response.body)).toEqual(result);
});
it('read-only accountant receives four false booleans; branch manager cannot read other branches', async () => {
  await f.h
    .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.approverMember}`;
  await f.h
    .owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${f.company} AND id=${f.approverMember}`;
  await asRole(f, 'accountant');
  expect((await send()).body).toEqual({
    correct: false,
    resolve: false,
    request_change: false,
    decide: false,
  });
  await asRole(f, 'branch_manager');
  expect((await send()).body).toEqual({
    correct: true,
    resolve: true,
    request_change: true,
    decide: false,
  });
  const denied = await send(f.secondBranch);
  expect(denied.status).toBe(404);
  expect((await send(f.foreignBranch)).body).toEqual(denied.body);
  expect((await send(leaveIds.newId())).body).toEqual(denied.body);
});
it('requires board business/branch consistency and the staff feature', async () => {
  await asRole(f, 'owner');
  expect((await send(f.branch.toUpperCase(), f.business.toUpperCase())).status).toBe(200);
  expect((await send(f.branch, f.secondBusiness)).status).toBe(404);
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'staff',false,'Synthetic disabled feature',${f.userId})`;
  try {
    expect((await send()).body).toMatchObject({ code: 'FEATURE_DISABLED' });
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;
  }
});
it('delegated read queries retain indexed plans under the restricted application role', async () => {
  await asRole(f, 'owner');
  const statements: { sql: string; params: unknown[] }[] = [];
  const compile = PgDialect.prototype.sqlToQuery;
  const spy = vi.spyOn(PgDialect.prototype, 'sqlToQuery').mockImplementation(function (
    this: PgDialect,
    ...args
  ) {
    const statement = compile.apply(this, args);
    if (/^\s*(SELECT|WITH)\b/.test(statement.sql) && !statement.sql.includes('set_config'))
      statements.push(statement);
    return statement;
  });
  try {
    expect(await readAttendanceCapabilities(authorizer, scope(), f.approverId)).toEqual({
      correct: true,
      resolve: true,
      request_change: true,
      decide: true,
    });
  } finally {
    spy.mockRestore();
  }
  const plans: string[] = [];
  await f.db.withTenant(
    f.company,
    async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan=off`);
      for (const captured of statements) {
        const statement = sql.join(
          captured.sql
            .split(/\$(\d+)/)
            .map((part, index) =>
              index % 2 === 0 ? sql.raw(part) : sql`${captured.params[Number(part) - 1]}`,
            ),
          sql``,
        );
        plans.push(
          JSON.stringify(await tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON) ${statement}`)),
        );
      }
    },
    { userId: f.approverId },
  );
  expect(plans.some((plan) => plan.includes('memberships_'))).toBe(true);
  expect(plans.some((plan) => plan.includes('role_permissions_'))).toBe(true);
  expect(plans.every((plan) => plan.includes('Index'))).toBe(true);
});
