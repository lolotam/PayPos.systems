import { employeeNameMatchKey } from '@pospay/domain';
import { deriveEmployeeCardKey } from '@pospay/auth';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';

import { createEmployeeCardHash } from '../persistence/employee-card-hash.ts';
const hash = createEmployeeCardHash(
  deriveEmployeeCardKey('test-secret-that-is-long-enough-for-hmac'),
);

import { personalFixture } from '../../../../test/personal-staff.fixture.ts';

let f: Awaited<ReturnType<typeof personalFixture>>;
let cardId: string;

beforeAll(async () => {
  f = await personalFixture();
  cardId = f.ids.newId();
  await f.owner`INSERT INTO employee_cards(company_id,id,business_id,employee_id,card_code_hash,card_code_suffix,issued_at,issued_by)
    VALUES(${f.companyId},${cardId},${f.businessId},${f.employeeId},${hash(f.companyId, 'RLS-CARD-1')},'RD-1',clock_timestamp(),${f.userId})`;
});
afterAll(async () => {
  await f?.close();
});

function insert(company: string, id = f.ids.newId(), code = 'RLS-CARD-2') {
  return sql`INSERT INTO employee_cards(company_id,id,business_id,employee_id,card_code_hash,card_code_suffix,issued_at,issued_by)
    VALUES(${company},${id},${f.businessId},${f.employeeId},${hash(f.companyId, code)},'RD-2',clock_timestamp(),${f.userId})`;
}

it('forces RLS and hides reads/updates outside the tenant and without context', async () => {
  const [flags] =
    await f.owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='employee_cards'`;
  expect(flags).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  await f.database.withTenant(f.otherCompany, async (tx) => {
    expect(
      await tx.execute(sql`SELECT id FROM employee_cards WHERE company_id=${f.companyId}`),
    ).toHaveLength(0);
    expect(
      await tx.execute(
        sql`UPDATE employee_cards SET revoked_at=clock_timestamp() WHERE company_id=${f.companyId} RETURNING id`,
      ),
    ).toHaveLength(0);
  });
  const raw = postgres(f.test.appUrl, { max: 1, onnotice: () => undefined });
  const auth = postgres(f.test.authUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await raw.unsafe(`SELECT id FROM employee_cards`)).toHaveLength(0);
    await expect(auth.unsafe(`SELECT id FROM employee_cards`)).rejects.toThrow();
  } finally {
    await raw.end();
    await auth.end();
  }
});

it('rejects a cross-tenant insert, an identity change and a delete', async () => {
  await expect(
    f.database.withTenant(f.otherCompany, (tx) => tx.execute(insert(f.companyId))),
  ).rejects.toThrow();
  await expect(
    f.database.withTenant(f.companyId, (tx) =>
      tx.execute(sql`UPDATE employee_cards SET company_id=${f.otherCompany} WHERE id=${cardId}`),
    ),
  ).rejects.toThrow();
  await expect(
    f.database.withTenant(f.companyId, (tx) =>
      tx.execute(sql`DELETE FROM employee_cards WHERE id=${cardId}`),
    ),
  ).rejects.toThrow();
});

it('rejects foreign employee references and cross-tenant upsert, and keeps the hash immutable', async () => {
  await expect(
    f.database.withTenant(f.otherCompany, (tx) => tx.execute(insert(f.otherCompany))),
  ).rejects.toThrow();
  await expect(
    f.database.withTenant(f.otherCompany, (tx) =>
      tx.execute(sql`
    INSERT INTO employee_cards(company_id,id,business_id,employee_id,card_code_hash,card_code_suffix,issued_at,issued_by)
    VALUES(${f.companyId},${cardId},${f.businessId},${f.employeeId},${hash(f.companyId, 'RLS-CARD-1')},'RD-1',clock_timestamp(),${f.userId})
    ON CONFLICT (company_id,id) DO UPDATE SET revoked_at=clock_timestamp(),revoked_by=${f.userId}`),
    ),
  ).rejects.toThrow();
  await expect(
    f.database.withTenant(f.companyId, (tx) =>
      tx.execute(sql`
    UPDATE employee_cards SET card_code_hash=${hash(f.companyId, 'CHANGED-CARD')} WHERE id=${cardId}`),
    ),
  ).rejects.toThrow();
});

it('holds one active card per employee and one active code per company', async () => {
  await expect(
    f.database.withTenant(f.companyId, (tx) => tx.execute(insert(f.companyId))),
  ).rejects.toThrow();
  const secondEmployee = f.ids.newId();
  await f.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
    VALUES(${f.companyId},${secondEmployee},${f.businessId},${f.branchId},'Synthetic second',${employeeNameMatchKey('Synthetic second')},'staff','2026-01-01')`;
  await expect(
    f.database.withTenant(f.companyId, (tx) =>
      tx.execute(sql`INSERT INTO employee_cards(company_id,id,business_id,employee_id,card_code_hash,card_code_suffix,issued_at,issued_by)
        VALUES(${f.companyId},${f.ids.newId()},${f.businessId},${secondEmployee},${hash(f.companyId, 'RLS-CARD-1')},'RD-1',clock_timestamp(),${f.userId})`),
    ),
  ).rejects.toThrow();
});
