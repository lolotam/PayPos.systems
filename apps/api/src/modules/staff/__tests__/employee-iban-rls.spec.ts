import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  employeeIbanFixture,
  ibanIds,
  ibanTerms,
  type IbanFixture,
} from './employee-iban.fixture.ts';
let f: IbanFixture;
beforeAll(async () => {
  f = await employeeIbanFixture();
  await f.setIban.execute({ ...f.context, input: ibanTerms() });
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
it('forces RLS, hides cross-tenant reads and rejects cross-tenant inserts', async () => {
  const [table] = await f.h
    .owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='employee_ibans'`;
  expect(table).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  expect(
    await f.db.withTenant(f.otherCompany, (tx) =>
      tx.execute(sql`SELECT id FROM employee_ibans WHERE employee_id=${f.employee.id}`),
    ),
  ).toHaveLength(0);
  await expect(
    f.db.withTenant(f.otherCompany, (tx) =>
      tx.execute(sql`
    INSERT INTO employee_ibans(company_id,id,business_id,employee_id,revision,set_by,reason)
    VALUES (${f.company},${ibanIds.newId()},${f.business},${f.employee.id},2,${f.userId},'Synthetic')`),
    ),
  ).rejects.toThrow();
});
it('tenant-qualified employee FK refuses foreign company and business even with a matching tenant GUC', async () => {
  for (const [company, business] of [
    [f.otherCompany, f.business],
    [f.company, f.secondBusiness],
  ] as const) {
    await expect(
      f.db.withTenant(company, (tx) =>
        tx.execute(sql`
      INSERT INTO employee_ibans(company_id,id,business_id,employee_id,revision,set_by,reason)
      VALUES (${company},${ibanIds.newId()},${business},${f.employee.id},2,${f.userId},'Synthetic')`),
      ),
    ).rejects.toThrow();
  }
});
it('denies UPDATE and DELETE even for the owning tenant, and grants only SELECT/INSERT', async () => {
  for (const statement of [
    sql`UPDATE employee_ibans SET reason='Changed' WHERE employee_id=${f.employee.id}`,
    sql`DELETE FROM employee_ibans WHERE employee_id=${f.employee.id}`,
  ]) {
    await expect(f.db.withTenant(f.company, (tx) => tx.execute(statement))).rejects.toThrow();
  }
  const grants = await f.h.owner`SELECT privilege_type FROM information_schema.role_table_grants
    WHERE table_name='employee_ibans' AND grantee='pospay_app' ORDER BY privilege_type`;
  expect(grants.map((r) => r['privilege_type'])).toEqual(['INSERT', 'SELECT']);
});
it('database checks reject incoherent clearing, invalid shapes and zero revisions', async () => {
  for (const [revision, iban, bank, holder, reason] of [
    [0, null, null, null, 'Test'],
    [2, ibanTerms().iban, null, null, 'Test'],
    [2, 'KW12INVALID', 'kw-cbk', 'SYNTHETIC', 'Test'],
    [2, ibanTerms().iban, 'sa-snb', 'SYNTHETIC', 'Test'],
    [2, null, null, null, ' '],
    [2, ibanTerms().iban, 'kw-cbk', 'A'.repeat(101), 'Test'],
  ] as const) {
    await expect(
      f.db.withTenant(f.company, (tx) =>
        tx.execute(sql`
      INSERT INTO employee_ibans(company_id,id,business_id,employee_id,revision,iban,bank_id,holder_name_en,set_by,reason)
      VALUES (${f.company},${ibanIds.newId()},${f.business},${f.employee.id},${revision},${iban},${bank},${holder},${f.userId},${reason})`),
      ),
    ).rejects.toThrow();
  }
});
