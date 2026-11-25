import { systemUuidV7 } from '@pospay/ids';
import type { UpdateEmployeeInput } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  addEmployee,
  grant,
  nextPhone,
  staffAccessFixture,
  type Fixture,
} from '../../../../test/staff-access.fixture.ts';
import { ownAttendanceContext } from '../persistence/own-attendance-context.adapter.ts';
import { createEmployeeUpdateTransactions } from '../persistence/drizzle-employee-update.ts';
import { UpdateEmployeeUseCase } from '../use-cases/update-employee/update-employee.usecase.ts';

const ids = systemUuidV7();
let f: Fixture;
let ownerUserId: string;
let counter = 900;
const invalidated: { companyId: string; membershipId: string; committed: boolean }[] = [];
let cacheFails = false;

beforeAll(async () => {
  f = await staffAccessFixture({ staffAccessRoutes: true });
  const session = await f.h.auth.getSession(new Headers({ cookie: f.ownerCookie }));
  ownerUserId = session?.userId as string;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const update = () =>
  new UpdateEmployeeUseCase(
    createEmployeeUpdateTransactions(f.db, ids, {
      invalidate: async (input) => {
        const [row] = await f.h.owner`SELECT 1 AS seen FROM memberships
          WHERE company_id=${input.companyId} AND id=${input.membershipId}`;
        invalidated.push({ ...input, committed: row !== undefined });
        if (cacheFails) throw new Error('REDIS_DOWN');
      },
    }),
    ids,
  );

/** يبني مدخل التعديل من الصف المحفوظ بتغيير واحد أو أكثر، فيبقى كل ما عداه كما هو. */
async function execute(employee: string, change: Partial<UpdateEmployeeInput>) {
  const [row] = await f.h.owner`SELECT primary_branch_id, name_en, name_ar, role_code, user_id, revision,
    to_char(hire_date,'YYYY-MM-DD') AS hire_date, to_char(contract_end,'YYYY-MM-DD') AS contract_end
    FROM employees WHERE id=${employee}`;
  return update().execute({
    companyId: f.company,
    userId: ownerUserId,
    businessId: f.business,
    employeeId: employee,
    input: {
      primary_branch_id: row?.['primary_branch_id'],
      name_en: row?.['name_en'],
      name_ar: row?.['name_ar'],
      role_code: row?.['role_code'],
      hire_date: row?.['hire_date'],
      contract_end: row?.['contract_end'],
      user_id: row?.['user_id'],
      expected_revision: row?.['revision'],
      branch_ids: [row?.['primary_branch_id']],
      branch_effective_date: '2026-10-03',
      ...change,
    } as UpdateEmployeeInput,
  });
}

/** موظفة بدخول ACTIVE على السالمية بعضويتها الحقيقية التي يفتحها المنح. */
async function activeStaff() {
  counter += 1;
  const employee = await addEmployee(f, `Follow ${counter}`, f.salmiya, counter);
  expect((await grant(f, employee, nextPhone(f))).status).toBe(200);
  const [access] = await f.h.owner`SELECT id, user_id, membership_id FROM employee_staff_access
    WHERE employee_id=${employee}`;
  return {
    employee,
    accessId: access?.['id'] as string,
    userId: access?.['user_id'] as string,
    membershipId: access?.['membership_id'] as string,
  };
}
const membershipsOf = (userId: string) => f.h.owner`SELECT id, role_id, scope_id, ends_at FROM memberships
  WHERE company_id=${f.company} AND user_id=${userId} ORDER BY id`;
const accessOf = async (employee: string) =>
  (
    await f.h.owner`SELECT state, branch_id, membership_id FROM employee_staff_access
    WHERE employee_id=${employee}`
  )[0];
const overridesOf = (membershipId: string) => f.h.owner`SELECT id, effect FROM permission_overrides
  WHERE company_id=${f.company} AND membership_id=${membershipId}`;

it('F3-3 a primary-branch move ends the old membership, opens one on the new branch and drops every override', async () => {
  const staff = await activeStaff();
  for (const [effect, permission, branch] of [
    ['ALLOW', 'manage:employees:business', f.salmiya],
    ['DENY', 'read:attendance:own', f.hawalli],
  ] as const)
    await f.h.owner`INSERT INTO permission_overrides
      (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
      VALUES (${f.company},${ids.newId()},${staff.membershipId},${permission},${effect},
        'BRANCH',${branch},'Synthetic override',${ownerUserId})`;
  const own = async (branch: string) =>
    (await f.db.withTenant(f.company, (tx) =>
      ownAttendanceContext(
        tx,
        { companyId: f.company, businessId: f.business, userId: staff.userId, branchId: branch },
        new Date(),
      ),
    )) !== null;
  expect(await own(f.salmiya)).toBe(true);

  const moved = await execute(staff.employee, {
    primary_branch_id: f.hawalli,
    branch_ids: [f.hawalli],
  });
  expect(moved).toMatchObject({ primary_branch_id: f.hawalli });

  const rows = await membershipsOf(staff.userId);
  expect(rows).toHaveLength(2);
  const old = rows.find((row) => row['id'] === staff.membershipId);
  const fresh = rows.find((row) => row['id'] !== staff.membershipId);
  expect(old?.['ends_at']).not.toBeNull();
  expect(fresh).toMatchObject({ scope_id: f.hawalli, ends_at: null, role_id: old?.['role_id'] });
  expect(await accessOf(staff.employee)).toEqual({
    state: 'ACTIVE',
    branch_id: f.hawalli,
    membership_id: fresh?.['id'],
  });
  expect(await overridesOf(staff.membershipId)).toHaveLength(2);
  expect(await overridesOf(fresh?.['id'] as string)).toHaveLength(0);
  expect(await own(f.hawalli)).toBe(true);
  expect(await own(f.salmiya)).toBe(false);

  const audits = await f.h.owner`SELECT entity, entity_id, action FROM audit_log
    WHERE action IN ('staff.membership_ended','created','branch_moved')
      AND entity_id IN (${staff.membershipId}, ${fresh?.['id'] as string}, ${staff.accessId})`;
  expect(audits).toEqual(
    expect.arrayContaining([
      { entity: 'membership', entity_id: staff.membershipId, action: 'staff.membership_ended' },
      { entity: 'membership', entity_id: fresh?.['id'], action: 'created' },
      { entity: 'employee_staff_access', entity_id: staff.accessId, action: 'branch_moved' },
    ]),
  );
  const [employeeAudit] = await f.h.owner`SELECT after FROM audit_log
    WHERE entity_id=${staff.employee} AND action='updated'`;
  expect(Object.keys(employeeAudit?.['after'] as object)).not.toContain('membership_id');
});

it('F3-3 invalidates the grant cache for both memberships only after the commit, and survives a cache failure', async () => {
  const staff = await activeStaff();
  invalidated.length = 0;
  cacheFails = true;
  try {
    await execute(staff.employee, { primary_branch_id: f.hawalli, branch_ids: [f.hawalli] });
  } finally {
    cacheFails = false;
  }
  const fresh = (await accessOf(staff.employee))?.['membership_id'] as string;
  expect(invalidated).toEqual([
    { companyId: f.company, membershipId: staff.membershipId, committed: true },
    { companyId: f.company, membershipId: fresh, committed: true },
  ]);
  expect(await accessOf(staff.employee)).toMatchObject({ branch_id: f.hawalli });
});

it('F3-3 a membership move that fails rolls the whole employee update back', async () => {
  const staff = await activeStaff();
  await f.h.owner`UPDATE memberships SET ends_at=clock_timestamp()
    WHERE company_id=${f.company} AND id=${staff.membershipId}`;
  const read = async () => ({
    employee:
      await f.h.owner`SELECT primary_branch_id, revision FROM employees WHERE id=${staff.employee}`,
    branches:
      await f.h.owner`SELECT branch_id, "to" FROM employee_branches WHERE employee_id=${staff.employee}`,
    memberships: await membershipsOf(staff.userId),
    access: await accessOf(staff.employee),
    audits: await f.h.owner`SELECT id FROM audit_log WHERE entity_id=${staff.employee}`,
  });
  const before = await read();
  invalidated.length = 0;
  await expect(
    execute(staff.employee, { primary_branch_id: f.hawalli, branch_ids: [f.hawalli] }),
  ).rejects.toThrow('EMPLOYEE_PERSISTENCE_FAILED');
  expect(await read()).toEqual(before);
  expect(invalidated).toHaveLength(0);
});

it('F3-3 a rename keeps the same membership and a move without active access touches no membership', async () => {
  const staff = await activeStaff();
  const before = await membershipsOf(staff.userId);
  invalidated.length = 0;
  await execute(staff.employee, { name_en: 'Renamed with access' });
  expect(await membershipsOf(staff.userId)).toEqual(before);
  expect(await accessOf(staff.employee)).toMatchObject({ membership_id: staff.membershipId });
  expect(invalidated).toHaveLength(0);

  const stopped = await activeStaff();
  await f.h.owner`UPDATE memberships SET ends_at=clock_timestamp()
    WHERE company_id=${f.company} AND id=${stopped.membershipId}`;
  await f.h.owner`UPDATE employee_staff_access SET state='STOPPED',membership_id=NULL
    WHERE employee_id=${stopped.employee}`;
  const stoppedBefore = await membershipsOf(stopped.userId);
  await execute(stopped.employee, { primary_branch_id: f.hawalli, branch_ids: [f.hawalli] });
  expect(await membershipsOf(stopped.userId)).toEqual(stoppedBefore);
  expect(await accessOf(stopped.employee)).toMatchObject({ state: 'STOPPED', branch_id: f.salmiya });

  counter += 1;
  const bare = await addEmployee(f, `Bare ${counter}`, f.salmiya, counter);
  await execute(bare, { primary_branch_id: f.hawalli, branch_ids: [f.hawalli] });
  expect(await accessOf(bare)).toBeUndefined();
  expect(invalidated).toHaveLength(0);
});
