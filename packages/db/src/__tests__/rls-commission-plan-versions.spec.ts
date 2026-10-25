import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import {
  COMMISSION_TENANT,
  expectPgError,
  refusalCode,
  type CommissionTenant,
} from '../../test/commission-statement-fixtures.ts';
import {
  insertCommissionPlanVersion,
  seedCommissionPlanVersionTenants,
} from '../../test/commission-plan-version-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const { A, B } = COMMISSION_TENANT;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionPlanVersionTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

const insert = (
  tenant: CommissionTenant,
  row: Record<string, unknown> = {},
  asCompany = tenant.company,
) => db.withTenant(asCompany, (tx) => insertCommissionPlanVersion(tx, tenant, ids, row));

it('commission_plan_versions carries forced RLS and select/insert policies only', async () => {
  const [table] = await owner<
    { relrowsecurity: boolean; relforcerowsecurity: boolean }[]
  >`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='commission_plan_versions'`;
  expect(table).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  const policies = await owner<{ cmd: string }[]>`
    SELECT cmd FROM pg_policies WHERE tablename='commission_plan_versions' ORDER BY cmd`;
  expect(policies).toEqual([{ cmd: 'INSERT' }, { cmd: 'SELECT' }]);
});

it('CM-R01: company B reads no plan of company A and cannot insert one for A', async () => {
  await insert(A);
  expect(
    await db.withTenant(A.company, (tx) =>
      tx.execute(sql`SELECT id FROM commission_plan_versions`),
    ),
  ).toHaveLength(1);
  expect(
    await db.withTenant(B.company, (tx) =>
      tx.execute(sql`SELECT id FROM commission_plan_versions`),
    ),
  ).toEqual([]);

  expect(['23503', '42501']).toContain(await refusalCode(insert(A, {}, B.company)));
  expect(['23503', '42501']).toContain(
    await refusalCode(insert({ ...A, company: B.company }, {}, B.company)),
  );
  await expectPgError(insert({ ...B, company: A.company }, {}, B.company), '42501');
  expect(
    await db.withTenant(A.company, (tx) =>
      tx.execute(sql`SELECT id FROM commission_plan_versions`),
    ),
  ).toHaveLength(1);
});

it('pospay_app cannot update or delete a commission plan version', async () => {
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      tx.execute(sql`UPDATE commission_plan_versions SET version=2 WHERE company_id=${A.company}`),
    ),
    '42501',
  );
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      tx.execute(sql`DELETE FROM commission_plan_versions WHERE company_id=${A.company}`),
    ),
    '42501',
  );
  expect(
    await db.withTenant(A.company, (tx) =>
      tx.execute(sql`SELECT id FROM commission_plan_versions`),
    ),
  ).toHaveLength(1);
});
