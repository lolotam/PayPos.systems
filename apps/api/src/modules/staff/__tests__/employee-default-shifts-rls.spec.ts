import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { salaryFixture, salaryIds, type SalaryFixture } from './salary.fixture.ts';

let f: SalaryFixture;
beforeAll(async () => { f = await salaryFixture(); });
afterAll(async () => { await f?.db.close(); await f?.h.close(); });

function insert(company = f.company, business = f.business, employee = f.employee.id,
  branch = f.branch, day = 0, breakStart: string | null = null) {
  return sql`INSERT INTO employee_default_shifts
    (company_id,business_id,employee_id,branch_id,day,start,"end",break_start,updated_by,updated_at)
    VALUES(${company},${business},${employee},${branch},${day},'09:00','17:00',${breakStart},${f.userId},now())`;
}

it('forces RLS and DH tenant read/insert/delete isolation with no UPDATE grant', async () => {
  const [table] = await f.h.owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class
    WHERE relname='employee_default_shifts'`;
  expect(table).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  await f.db.withTenant(f.company, (tx) => tx.execute(insert()));
  expect(await f.db.withTenant(f.otherCompany, (tx) => tx.execute(
    sql`SELECT * FROM employee_default_shifts WHERE employee_id=${f.employee.id}`))).toHaveLength(0);
  await expect(f.db.withTenant(f.otherCompany, (tx) => tx.execute(insert()))).rejects.toThrow();
  expect(await f.db.withTenant(f.otherCompany, (tx) => tx.execute(
    sql`DELETE FROM employee_default_shifts WHERE employee_id=${f.employee.id} RETURNING day`))).toHaveLength(0);
  await expect(f.db.withTenant(f.company, (tx) => tx.execute(
    sql`UPDATE employee_default_shifts SET day=1 WHERE employee_id=${f.employee.id}`))).rejects.toThrow();
  const grants = await f.h.owner`SELECT privilege_type FROM information_schema.role_table_grants
    WHERE table_name='employee_default_shifts' AND grantee='pospay_app' ORDER BY privilege_type`;
  expect(grants.map((r) => r['privilege_type'])).toEqual(['DELETE', 'INSERT', 'SELECT']);
});

it('rejects foreign employee/branch/business FKs and day/half-break CHECKs', async () => {
  const foreignEmployee = salaryIds.newId();
  await f.h.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
    SELECT ${f.otherCompany},${foreignEmployee},business_id,id,'Synthetic foreign employee','synthetic foreign employee','staff','2026-01-01'
    FROM branches WHERE company_id=${f.otherCompany} AND id=${f.foreignBranch}`;
  for (const statement of [
    insert(f.otherCompany),
    insert(f.company, f.business, f.employee.id, f.foreignBranch, 1),
    insert(f.company, f.business, foreignEmployee, f.branch, 1),
    insert(f.company, f.business, f.employee.id, f.otherBranch, 1),
    insert(f.company, f.secondBusiness, f.employee.id, f.otherBranch, 1),
    insert(f.company, f.business, f.employee.id, f.branch, 7),
    insert(f.company, f.business, f.employee.id, f.branch, 1, '13:00'),
  ]) {
    await expect(f.db.withTenant(f.company, (tx) => tx.execute(statement))).rejects.toThrow();
  }
});
