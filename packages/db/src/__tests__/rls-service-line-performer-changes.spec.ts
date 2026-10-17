import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { createDatabase, type Database } from '../index.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { seedOrders, ORDER_IDS } from '../../test/orders-fixture.ts';
import {
  commitChange,
  performer,
  recordLine,
  seedPerformerChangeStaff,
  tenantA,
  type ChangeCtx,
} from '../../test/service-line-performer-change.ts';

const FUNCTIONS = [
  'line_performers_change_guard',
  'service_lines_performer_transition',
  'slpc_begin',
  'slpc_change_complete',
  'slpc_same_tuple',
  'slpc_side_shape_ok',
  'slpc_tuple_matches',
  'slpc_validate_change',
  'slpcr_insert_guard',
];
const TABLES = ['service_line_performer_changes', 'service_line_performer_change_rows'] as const;
const LINE = '01920000-0000-7000-8000-000000004420';
const SHARED = '01920000-0000-7000-8000-000000004421';

let testDb: TestDatabase, owner: postgres.Sql, db: Database;
const ids = systemUuidV7();
const { A, B } = TENANT;
const ctx: ChangeCtx = tenantA();
const calm = performer(ORDER_IDS.employee);
const next = performer('01920000-0000-7000-8000-000000004410');

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  await seedPerformerChangeStaff(owner, ctx);
  db = createDatabase({ url: testDb.appUrl, ids });
  await recordLine(db, ctx, ids, LINE, 2, [calm]);
  await commitChange(db, ctx, ids, {
    lineId: LINE,
    changeId: SHARED,
    before: [calm],
    after: [next],
    live: [next],
  });
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

const as = (company: string, query: ReturnType<typeof sql>) =>
  db.withTenant(company, (tx) => tx.execute(query), { userId: USER });

async function rejected(work: Promise<unknown>, code: string) {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as { cause?: { code?: string } }).cause?.code).toBe(code);
}

it('forces split select and insert policies and no bypass', async () => {
  for (const table of TABLES) {
    const [row] =
      await owner`SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced, r.rolname
      FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE c.oid=${table}::regclass`;
    expect(row).toMatchObject({ rls: true, forced: true });
    expect(row?.['rolname']).not.toBe('pospay_app');
    const policies =
      await owner`SELECT policyname, cmd FROM pg_policies WHERE tablename=${table} ORDER BY cmd`;
    expect(policies.map((policy) => policy['cmd'])).toEqual(['INSERT', 'SELECT']);
  }
  const [role] =
    await owner`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='pospay_app'`;
  expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
});

it('isolates history rows and refuses a cross-company insert', async () => {
  for (const table of TABLES) {
    expect(
      await as(
        B.company,
        sql`SELECT id FROM ${sql.identifier(table)} WHERE company_id=${A.company}`,
      ),
    ).toEqual([]);
  }
  await rejected(
    as(
      A.company,
      sql`INSERT INTO service_line_performer_changes(company_id,id,business_id,line_id,revision,previous_revision,reason,changed_at,changed_by,changed_by_membership_id,changer_name_en,write_xid)
      VALUES(${B.company},${ids.newId()},${B.business},${ORDER_IDS.line},2,1,'Changed performers',clock_timestamp(),${USER},${ORDER_IDS.membership},'Changer','1'::xid8)`,
    ),
    '42501',
  );
  await rejected(
    as(
      A.company,
      sql`INSERT INTO service_line_performer_change_rows(company_id,id,business_id,change_id,side,employee_id,performer_ordinal,share_bps,name_en,linked_user_snapshotted,not_clocked_in_warning,approved_leave_warning)
      VALUES(${B.company},${ids.newId()},${B.business},${SHARED},'AFTER',${ORDER_IDS.employee},1,10000,'Synthetic',true,false,false)`,
    ),
    '42501',
  );
});

it('lets a cross-company performer delete match no row', async () => {
  const [row] = await as(
    A.company,
    sql`WITH removed AS (
    DELETE FROM line_performers WHERE company_id=${B.company} RETURNING id
  ) SELECT count(*)::int AS n FROM removed`,
  );
  expect(row).toEqual({ n: 0 });
});

it('refuses update, delete and truncate of history even in the current company', async () => {
  for (const table of TABLES) {
    await rejected(
      as(A.company, sql`UPDATE ${sql.identifier(table)} SET business_id=${A.business}`),
      '42501',
    );
    await rejected(as(A.company, sql`DELETE FROM ${sql.identifier(table)}`), '42501');
    await rejected(as(A.company, sql`TRUNCATE ${sql.identifier(table)}`), '42501');
  }
});

it('grants history and the new functions only to pospay_app', async () => {
  const privileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'];
  for (const role of ['pospay_auth', 'pospay_dispatcher']) {
    for (const table of TABLES) {
      const rows = await owner<{ allowed: boolean }[]>`
        SELECT has_table_privilege(${role}, ${table}, privilege) AS allowed
        FROM unnest(${privileges}::text[]) AS privilege`;
      expect(rows.every((row) => row.allowed === false)).toBe(true);
    }
  }
  const rows = await owner<{ app: boolean; auth: boolean; dispatcher: boolean; acl: string }[]>`
    SELECT has_function_privilege('pospay_app', p.oid, 'EXECUTE') AS app,
      has_function_privilege('pospay_auth', p.oid, 'EXECUTE') AS auth,
      has_function_privilege('pospay_dispatcher', p.oid, 'EXECUTE') AS dispatcher,
      p.proacl::text AS acl
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY(${FUNCTIONS})`;
  expect(rows).toHaveLength(FUNCTIONS.length);
  for (const row of rows) {
    expect(row.app).toBe(true);
    expect(row.auth).toBe(false);
    expect(row.dispatcher).toBe(false);
    expect(row.acl.includes('{=X/') || row.acl.includes(',=X/')).toBe(false);
  }
});

it('seeds the performer permission on the four managers only', async () => {
  const rows = await owner<{ code: string }[]>`
    SELECT r.code FROM role_permissions rp JOIN roles r ON r.id=rp.role_id
    WHERE rp.permission_code='change:service-line-performers:branch' AND r.company_id IS NULL ORDER BY 1`;
  expect(rows.map((row) => row.code)).toEqual([
    'branch_manager',
    'business_manager',
    'general_manager',
    'owner',
  ]);
});
