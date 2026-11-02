import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import { expectPgError } from '../../test/commission-statement-fixtures.ts';
import {
  COMMISSION_LINE_TENANTS,
  insertCommissionLineHead,
  insertCommissionLineProjection,
  insertCommissionLineRow,
  seedCommissionLineTenants,
  type CommissionLineTenant,
} from '../../test/commission-line-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const { A, B } = COMMISSION_LINE_TENANTS;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionLineTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

const insert = (tenant: CommissionLineTenant, row: Record<string, unknown> = {}) =>
  db.withTenant(tenant.company, (tx) => insertCommissionLineProjection(tx, tenant, ids, row));
const asA = (query: ReturnType<typeof sql>) => db.withTenant(A.company, (tx) => tx.execute(query));
const asB = (query: ReturnType<typeof sql>) => db.withTenant(B.company, (tx) => tx.execute(query));

it.each([
  ['commission_line_heads', ['INSERT', 'SELECT', 'UPDATE'], ['INSERT', 'SELECT', 'UPDATE']],
  ['commission_lines', ['DELETE', 'INSERT', 'SELECT', 'UPDATE'], ['DELETE', 'INSERT', 'SELECT', 'UPDATE']],
] as const)('%s has forced RLS and exactly its designed policies and app grants', async (table, policies, grants) => {
  const [flags] = await owner<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
    SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=${table}`;
  expect(flags).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  const actualPolicies = await owner<{ cmd: string }[]>`
    SELECT cmd FROM pg_policies WHERE tablename=${table} ORDER BY cmd`;
  expect(actualPolicies.map((row) => row.cmd)).toEqual(policies);
  const actualGrants = await owner<{ privilege_type: string }[]>`
    SELECT a.privilege_type FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE c.relname=${table} AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname='pospay_app') ORDER BY 1`;
  expect(actualGrants.map((row) => row.privilege_type)).toEqual(grants);
});

it('has exactly the head and line indexes required by the PK, statement read and FKs', async () => {
  const heads = await owner<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes WHERE tablename='commission_line_heads' ORDER BY indexname`;
  expect(heads.map((row) => row.indexname)).toEqual([
    'commission_line_heads_branch_idx',
    'commission_line_heads_customer_idx',
    'commission_line_heads_pkey',
    'commission_line_heads_service_idx',
  ]);
  const lines = await owner<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes WHERE tablename='commission_lines' ORDER BY indexname`;
  expect(lines.map((row) => row.indexname)).toEqual([
    'commission_lines_branch_idx',
    'commission_lines_employee_idx',
    'commission_lines_period_employee_idx',
    'commission_lines_pkey',
    'commission_lines_service_idx',
  ]);
});

it('CM-R03: B reads none of A and cannot insert, update or delete A projection rows', async () => {
  const lineId = await insert(A, { net: '7.000', netShare: '7.000' });
  expect(await asA(sql`SELECT line_id FROM commission_line_heads WHERE line_id=${lineId}`)).toHaveLength(1);
  expect(await asA(sql`SELECT line_id FROM commission_lines WHERE line_id=${lineId}`)).toHaveLength(1);
  expect(await asB(sql`SELECT line_id FROM commission_line_heads WHERE line_id=${lineId}`)).toEqual([]);
  expect(await asB(sql`SELECT line_id FROM commission_lines WHERE line_id=${lineId}`)).toEqual([]);
  await expectPgError(
    db.withTenant(B.company, (tx) => insertCommissionLineHead(tx, A, ids)),
    '42501',
  );
  await expectPgError(
    db.withTenant(B.company, (tx) => insertCommissionLineRow(tx, A, ids, { lineId })),
    '42501',
  );
  await asB(sql`UPDATE commission_line_heads SET revision=99 WHERE line_id=${lineId}`);
  await asB(sql`UPDATE commission_lines SET net_share='0.000' WHERE line_id=${lineId}`);
  await asB(sql`DELETE FROM commission_lines WHERE line_id=${lineId}`);
  await expectPgError(asB(sql`DELETE FROM commission_line_heads WHERE line_id=${lineId}`), '42501');
  expect(await asA(sql`SELECT revision FROM commission_line_heads WHERE line_id=${lineId}`)).toEqual([{ revision: 1 }]);
  expect(await asA(sql`SELECT net_share FROM commission_lines WHERE line_id=${lineId}`)).toEqual([{ net_share: '7.000' }]);
});

it('the tenant context does not leak and the same line id can exist in two companies', async () => {
  const lineId = ids.newId();
  await insert(A, { lineId });
  expect(await asB(sql`SELECT line_id FROM commission_line_heads WHERE line_id=${lineId}`)).toEqual([]);
  await insert(B, { lineId });
  expect(await asA(sql`SELECT line_id FROM commission_line_heads WHERE line_id=${lineId}`)).toHaveLength(1);
  expect(await asB(sql`SELECT line_id FROM commission_line_heads WHERE line_id=${lineId}`)).toHaveLength(1);
  const app = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await app`SELECT line_id FROM commission_line_heads`).toEqual([]);
    expect(await app`SELECT line_id FROM commission_lines`).toEqual([]);
  } finally {
    await app.end();
  }
});

it('the app cannot delete or truncate heads and cannot truncate lines', async () => {
  const lineId = await insert(A);
  await expectPgError(asA(sql`DELETE FROM commission_line_heads WHERE line_id=${lineId}`), '42501');
  await expectPgError(asA(sql`TRUNCATE commission_line_heads`), '42501');
  await expectPgError(asA(sql`TRUNCATE commission_lines`), '42501');
  expect(await asA(sql`SELECT line_id FROM commission_lines WHERE line_id=${lineId}`)).toHaveLength(1);
});

it('same-tenant updates cannot move a row into another tenant', async () => {
  const lineId = await insert(A);
  await expectPgError(
    asA(sql`UPDATE commission_line_heads SET company_id=${B.company} WHERE line_id=${lineId}`),
    '42501',
  );
  await expectPgError(
    asA(sql`UPDATE commission_lines SET company_id=${B.company} WHERE line_id=${lineId}`),
    '42501',
  );
});

it.each(['authUrl', 'dispatcherUrl', 'notificationsUrl'] as const)(
  'foreign runtime role %s has no privileges on either projection table',
  async (url) => {
    const role = postgres(testDb[url], { max: 1, onnotice: () => undefined });
    try {
      await expect(role`SELECT line_id FROM commission_line_heads`).rejects.toThrow(/permission denied/);
      await expect(role`SELECT line_id FROM commission_lines`).rejects.toThrow(/permission denied/);
    } finally {
      await role.end();
    }
  },
);
