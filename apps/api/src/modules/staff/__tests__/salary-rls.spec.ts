import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { salaryFixture, salaryCommand, salaryIds, type SalaryFixture } from './salary.fixture.ts';
let f: SalaryFixture;
let salaryId: string;
beforeAll(async () => {
  f = await salaryFixture();
  salaryId = (await f.set.execute(salaryCommand(f))).id;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
it('FORCE RLS hides cross-tenant reads and updates and rejects cross-tenant inserts/upserts', async () => {
  expect(
    await f.db.withTenant(f.otherCompany, (tx) =>
      tx.execute(sql`SELECT id FROM employee_salaries WHERE id=${salaryId}`),
    ),
  ).toHaveLength(0);
  expect(
    await f.db.withTenant(f.otherCompany, (tx) =>
      tx.execute(
        sql`UPDATE employee_salaries SET amount='1.000' WHERE id=${salaryId} RETURNING id`,
      ),
    ),
  ).toHaveLength(0);
  await expect(
    f.db.withTenant(f.otherCompany, (tx) =>
      tx.execute(
        sql`INSERT INTO employee_salaries(company_id,id,business_id,employee_id,effective_from,amount,set_by,revision,reason) VALUES (${f.company},${salaryIds.newId()},${f.business},${f.employee.id},'2026-06-01','1.000',${f.userId},1,'Synthetic')`,
      ),
    ),
  ).rejects.toThrow();
  await expect(
    f.db.withTenant(f.otherCompany, (tx) =>
      tx.execute(
        sql`INSERT INTO employee_salaries(company_id,id,business_id,employee_id,effective_from,amount,set_by,revision,reason) VALUES (${f.company},${salaryId},${f.business},${f.employee.id},'2026-01-01','1.000',${f.userId},2,'Synthetic') ON CONFLICT(company_id,employee_id,effective_from) DO UPDATE SET amount=EXCLUDED.amount`,
      ),
    ),
  ).rejects.toThrow();
});
it('foreign employee FK cannot cross companies; runtime cannot delete or rehome salary identity', async () => {
  await expect(
    f.db.withTenant(f.otherCompany, (tx) =>
      tx.execute(
        sql`INSERT INTO employee_salaries(company_id,id,business_id,employee_id,effective_from,amount,set_by,revision,reason) VALUES (${f.otherCompany},${salaryIds.newId()},${f.business},${f.employee.id},'2026-06-01','1.000',${f.userId},1,'Synthetic')`,
      ),
    ),
  ).rejects.toThrow();
  await expect(
    f.db.withTenant(f.company, (tx) =>
      tx.execute(sql`DELETE FROM employee_salaries WHERE id=${salaryId}`),
    ),
  ).rejects.toThrow();
  await expect(
    f.db.withTenant(f.company, (tx) =>
      tx.execute(
        sql`UPDATE employee_salaries SET company_id=${f.otherCompany} WHERE id=${salaryId}`,
      ),
    ),
  ).rejects.toThrow();
  await expect(
    f.db.withTenant(f.company, (tx) =>
      tx.execute(
        sql`UPDATE employee_salaries SET effective_from='2026-02-01' WHERE id=${salaryId}`,
      ),
    ),
  ).rejects.toThrow();
  const [table] = await f.h
    .owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='employee_salaries'`;
  expect(table).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
});
