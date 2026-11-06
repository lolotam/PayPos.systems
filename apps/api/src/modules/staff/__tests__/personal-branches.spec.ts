import { personalBranchReads as reads } from '../persistence/personal-branches.adapter.ts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { systemUuidV7 } from '@pospay/ids';
import { employeeUserMembership } from './employees.fixture.ts';
import {
  monthlyReportFixture,
  type MonthlyReportFixture,
} from './attendance-monthly-report.fixture.ts';
import {
  readPersonalBranches,
  personalBranchesStatement,
} from '../queries/personal-branches.query.ts';
let f: MonthlyReportFixture;
const now = new Date('2026-10-11T10:00:00Z');
const context = () => ({
  companyId: f.company,
  businessId: f.business,
  userId: f.userId,
  employeeId: f.employee.id,
});
const read = (patch: Partial<ReturnType<typeof context>> = {}) =>
  f.db.withTenant(f.company, (tx) =>
    readPersonalBranches(tx, { ...context(), ...patch }, now, reads),
  );
beforeAll(async () => {
  f = await monthlyReportFixture();
  await f.h
    .owner`UPDATE memberships SET starts_at='2026-01-01' WHERE company_id=${f.company} AND id=${f.memberId}`;
  await f.h
    .owner`UPDATE employees SET user_id=${f.userId} WHERE company_id=${f.company} AND id=${f.employee.id}`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
it('returns exactly own current branch names and effective timezones without leave permission', async () => {
  const response = await read();
  expect(response.items.map((b) => b.id).sort()).toEqual([f.branch, f.secondBranch].sort());
  for (const branch of response.items) {
    expect(Object.keys(branch).sort()).toEqual(['id', 'name_ar', 'name_en', 'timezone']);
    expect(branch.timezone).toBe('Asia/Kuwait');
  }
});
it('isolates real colleagues and tenants even when every supplied identity exists', async () => {
  const ids = systemUuidV7();
  const subjects = [];
  for (const [companyId, businessId, branchId, email] of [
    [f.company, f.business, ids.newId(), 'branch-colleague@example.test'],
    [f.otherCompany, f.foreignBusiness, f.foreignBranch, 'branch-foreign@example.test'],
  ] as const) {
    await f.h.signedInOperator(email);
    const [user] = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
    const userId = user?.['id'] as string;
    const employeeId = ids.newId();
    if (companyId === f.company)
      await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en)
        VALUES(${companyId},${branchId},${businessId},'Synthetic colleague branch')`;
    await employeeUserMembership(f, userId, { companyId, businessId });
    await f.h.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,user_id,
      name_en,name_en_key,role_code,hire_date,employee_number)
      VALUES(${companyId},${employeeId},${businessId},${branchId},${userId},
        ${email},${email},'staff','2026-01-01',999998)`;
    await f.h
      .owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
      VALUES(${companyId},${ids.newId()},${businessId},${employeeId},${branchId},'2026-01-01')`;
    const subject = { companyId, businessId, userId, employeeId };
    // القراءة الناجحة تثبت وجود الموظفة وارتباطها قبل اختبار خلط الهوية أو المستأجر.
    const own = await f.db.withTenant(companyId, (tx) =>
      readPersonalBranches(tx, subject, now, reads),
    );
    expect(own.items.map((item) => item.id)).toEqual([branchId]);
    subjects.push({ subject, branchId });
  }
  for (const { subject, branchId } of subjects) {
    await expect(read({ employeeId: subject.employeeId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(read({ userId: subject.userId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    if (subject.companyId !== f.company)
      await expect(read(subject)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await read()).items.map((item) => item.id)).not.toContain(branchId);
  }
  await expect(
    f.db.withTenant(f.otherCompany, (tx) => readPersonalBranches(tx, context(), now, reads)),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
it('uses each effective branch timezone and inclusive employment endpoints', async () => {
  await f.h
    .owner`UPDATE branches SET timezone='Pacific/Pago_Pago' WHERE company_id=${f.company} AND id=${f.secondBranch}`;
  await f.h
    .owner`UPDATE employees SET hire_date='2026-10-10',contract_end='2026-10-10' WHERE company_id=${f.company} AND id=${f.employee.id}`;
  try {
    expect((await read()).items.map((b) => ({ id: b.id, timezone: b.timezone }))).toEqual([
      { id: f.secondBranch, timezone: 'Pacific/Pago_Pago' },
    ]);
  } finally {
    await f.h
      .owner`UPDATE employees SET hire_date='2026-01-01',contract_end=NULL WHERE company_id=${f.company} AND id=${f.employee.id}`;
    await f.h
      .owner`UPDATE branches SET timezone=NULL WHERE company_id=${f.company} AND id=${f.secondBranch}`;
  }
});
it.each(['deleted', 'unlinked', 'not-hired', 'ended', 'membership-ended'])(
  'rechecks live eligibility: %s',
  async (kind) => {
    if (kind === 'deleted')
      await f.h
        .owner`UPDATE employees SET deleted_at=now() WHERE company_id=${f.company} AND id=${f.employee.id}`;
    if (kind === 'unlinked')
      await f.h
        .owner`UPDATE employees SET user_id=NULL WHERE company_id=${f.company} AND id=${f.employee.id}`;
    if (kind === 'not-hired')
      await f.h
        .owner`UPDATE employees SET hire_date='2026-10-12' WHERE company_id=${f.company} AND id=${f.employee.id}`;
    if (kind === 'ended')
      await f.h
        .owner`UPDATE employees SET contract_end='2026-10-10' WHERE company_id=${f.company} AND id=${f.employee.id}`;
    if (kind === 'membership-ended')
      await f.h
        .owner`UPDATE memberships SET ends_at=${now.toISOString()} WHERE company_id=${f.company} AND id=${f.memberId}`;
    try {
      await expect(read()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    } finally {
      await f.h
        .owner`UPDATE employees SET deleted_at=NULL,user_id=${f.userId},hire_date='2026-01-01',contract_end=NULL WHERE company_id=${f.company} AND id=${f.employee.id}`;
      await f.h
        .owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${f.company} AND id=${f.memberId}`;
    }
  },
);
it('honours exclusive attachment end, active branch and membership coverage', async () => {
  expect((await read()).items).toHaveLength(2);
  await f.h
    .owner`UPDATE employee_branches SET "to"='2026-10-11' WHERE company_id=${f.company} AND employee_id=${f.employee.id} AND branch_id=${f.secondBranch}`;
  expect((await read()).items.map((b) => b.id)).toEqual([f.branch]);
  await f.h
    .owner`UPDATE branches SET is_active=false WHERE company_id=${f.company} AND id=${f.branch}`;
  try {
    await expect(read()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  } finally {
    await f.h
      .owner`UPDATE branches SET is_active=true WHERE company_id=${f.company} AND id=${f.branch}`;
  }
  await f.h
    .owner`UPDATE memberships SET scope_type='BRANCH',scope_id=${f.secondBranch} WHERE company_id=${f.company} AND id=${f.memberId}`;
  try {
    await expect(read()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  } finally {
    await f.h
      .owner`UPDATE memberships SET scope_type='COMPANY',scope_id=${f.company} WHERE company_id=${f.company} AND id=${f.memberId}`;
  }
});
it('uses existing employee and attachment indexes in real EXPLAIN ANALYZE', async () => {
  const branches = await f.db.withTenant(f.company, (tx) => reads.workspaces(tx, f.business));
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${personalBranchesStatement(context(), branches, now)}`,
    );
  });
  const rendered = JSON.stringify(plan);
  expect(rendered).toMatch(/Index Name[^,]*employees/);
  expect(rendered).toMatch(/Index Name[^,]*employee_branches/);
  expect(rendered).toContain('employee_branches');
  expect(rendered).toContain('employees');
});
