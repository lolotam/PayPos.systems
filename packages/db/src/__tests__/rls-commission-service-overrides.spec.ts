import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import { expectPgError } from '../../test/commission-statement-fixtures.ts';
import {
  insertCommissionServiceOverride,
  seedCommissionServiceOverrideTenants,
  SERVICE_OVERRIDE_TENANTS,
  type ServiceOverrideTenant,
} from '../../test/commission-service-override-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { USER } from '../../test/tenancy-fixtures.ts';

type SQLQuery = ReturnType<typeof sql>;

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const { A, B } = SERVICE_OVERRIDE_TENANTS;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionServiceOverrideTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

const asA = (query: SQLQuery) => db.withTenant(A.company, (tx) => tx.execute(query));
const asB = (query: SQLQuery) => db.withTenant(B.company, (tx) => tx.execute(query));
const insert = (tenant: ServiceOverrideTenant, row: Record<string, unknown> = {}) =>
  db.withTenant(tenant.company, (tx) => insertCommissionServiceOverride(tx, tenant, ids, row));

it('the table carries forced row-level security and only the SELECT and INSERT policies', async () => {
  const [table] = await owner<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
    SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='commission_service_overrides'`;
  expect(table).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  const policies = await owner<{ cmd: string }[]>`
    SELECT cmd FROM pg_policies WHERE tablename='commission_service_overrides' ORDER BY cmd`;
  expect(policies).toEqual([{ cmd: 'INSERT' }, { cmd: 'SELECT' }]);
  const [role] = await owner`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='pospay_app'`;
  expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
});

it('the app role holds exactly SELECT and INSERT on the table', async () => {
  const rows = await owner<{ privilege_type: string }[]>`
    SELECT a.privilege_type FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE c.relname='commission_service_overrides'
      AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname='pospay_app')
    ORDER BY 1`;
  expect(rows.map((row) => row.privilege_type)).toEqual(['INSERT', 'SELECT']);
});

it('the table has the three indexes the list and the foreign keys need, and nothing else', async () => {
  const indexes = await owner<{ indexname: string; indexdef: string }[]>`
    SELECT indexname,indexdef FROM pg_indexes WHERE tablename='commission_service_overrides' ORDER BY indexname`;
  expect(indexes.map((row) => row.indexname)).toEqual([
    'commission_service_overrides_created_by_idx',
    'commission_service_overrides_employee_service_idx',
    'commission_service_overrides_pkey',
    'commission_service_overrides_service_idx',
  ]);
  const main = indexes.find((row) => row.indexname === 'commission_service_overrides_employee_service_idx');
  expect(main?.indexdef).toContain(
    'company_id, business_id, employee_id, service_id, created_at DESC NULLS LAST, id DESC NULLS LAST',
  );
  expect(indexes.find((row) => row.indexname === 'commission_service_overrides_service_idx')?.indexdef).toContain(
    'company_id, business_id, service_id',
  );
  expect(indexes.find((row) => row.indexname === 'commission_service_overrides_created_by_idx')?.indexdef).toContain(
    'created_by',
  );
});

it('CM-R02: company B reads no override of company A and cannot insert one for A', async () => {
  const rowId = ids.newId();
  await insert(A, { id: rowId });
  expect(await asA(sql`SELECT id FROM commission_service_overrides WHERE id=${rowId}`)).toHaveLength(1);
  expect(await asB(sql`SELECT id FROM commission_service_overrides WHERE id=${rowId}`)).toEqual([]);
  // كل صف بتاه شركة B نفسها، مش صف من شركة A.
  const visibleToB = await asB(sql`SELECT company_id FROM commission_service_overrides`);
  expect(visibleToB.map((row) => row['company_id'])).not.toContain(A.company);
  await expectPgError(
    asB(sql`INSERT INTO commission_service_overrides(
        company_id,id,business_id,employee_id,service_id,rule_kind,effective_from,created_at,created_by)
      VALUES(${A.company},${ids.newId()},${A.business},${A.employee},${A.service},'ZERO','2026-11-01',
        '2026-11-01T09:00:00Z',${USER})`),
    '42501',
  );
  expect(await asA(sql`SELECT id FROM commission_service_overrides WHERE id=${rowId}`)).toHaveLength(1);
});

it('the tenant context does not leak between transactions, and one id is allowed in two companies', async () => {
  const sharedId = ids.newId();
  await insert(A, { id: sharedId });
  expect(await asA(sql`SELECT id FROM commission_service_overrides WHERE id=${sharedId}`)).toHaveLength(1);
  expect(await asB(sql`SELECT id FROM commission_service_overrides WHERE id=${sharedId}`)).toEqual([]);
  // المفتاح مركّب (الشركة، المعرّف)، فالمعرّف نفسه بيتقبل في شركتين.
  await insert(B, { id: sharedId });
  expect(await asB(sql`SELECT id FROM commission_service_overrides WHERE id=${sharedId}`)).toHaveLength(1);
  expect(await asA(sql`SELECT id FROM commission_service_overrides WHERE id=${sharedId}`)).toHaveLength(1);
  const app = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await app`SELECT id FROM commission_service_overrides`).toEqual([]);
  } finally {
    await app.end();
  }
});

it('the app cannot update, delete or truncate an override, and the stored row survives', async () => {
  const rowId = ids.newId();
  await insert(A, { id: rowId, ruleKind: 'PCT', rulePctBps: 1500 });
  await expectPgError(
    asA(sql`UPDATE commission_service_overrides SET rule_kind='ZERO' WHERE company_id=${A.company} AND id=${rowId}`),
    '42501',
  );
  await expectPgError(
    asA(sql`DELETE FROM commission_service_overrides WHERE company_id=${A.company} AND id=${rowId}`),
    '42501',
  );
  await expectPgError(asA(sql`TRUNCATE commission_service_overrides`), '42501');
  expect(await asA(sql`SELECT rule_kind,rule_pct_bps FROM commission_service_overrides WHERE id=${rowId}`)).toEqual([
    { rule_kind: 'PCT', rule_pct_bps: 1500 },
  ]);
});

it.each(['authUrl', 'dispatcherUrl', 'notificationsUrl'] as const)(
  'the foreign runtime role %s has no access to the table',
  async (url) => {
    const role = postgres(testDb[url], { max: 1, onnotice: () => undefined });
    try {
      await expect(role`SELECT id FROM commission_service_overrides`).rejects.toThrow(/permission denied/);
    } finally {
      await role.end();
    }
  },
);
