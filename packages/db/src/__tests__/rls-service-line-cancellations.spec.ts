import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { createDatabase, type Database } from '../index.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { seedOrders, ORDER_IDS } from '../../test/orders-fixture.ts';
import { cancelServiceLine } from '../../test/service-line-cancellation.ts';
import {
  performer,
  recordLine,
  tenantA,
  type ChangeCtx,
} from '../../test/service-line-performer-change.ts';

const FUNCTIONS = [
  'line_performers_cancel_guard',
  'service_lines_cancel_guard',
  'slc_complete',
  'slc_validate_line',
];
const TABLE = 'service_line_cancellations';
const LINE = '01920000-0000-7000-8000-000000004460';

let testDb: TestDatabase, owner: postgres.Sql, db: Database;
const ids = systemUuidV7();
const { A, B } = TENANT;
const ctx: ChangeCtx = tenantA();

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  db = createDatabase({ url: testDb.appUrl, ids });
  await recordLine(db, ctx, ids, LINE, 2, [performer(ORDER_IDS.employee)]);
  await db.withTenant(
    ctx.company,
    (tx) =>
      cancelServiceLine(tx, {
        companyId: ctx.company,
        lineId: LINE,
        expectedRevision: 1,
        cancelledBy: ctx.userId,
        membershipId: ctx.membershipId,
        cancellationId: ids.newId(),
      }),
    { userId: USER },
  );
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

const as = (company: string, query: ReturnType<typeof sql>) =>
  db.withTenant(company, (tx) => tx.execute(query), { userId: USER });

function pgError(error: unknown): { code?: string; constraint_name?: string } {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const candidate = current as Error & {
      code?: string;
      constraint_name?: string;
      cause?: unknown;
    };
    if (candidate.code !== undefined || candidate.constraint_name !== undefined) return candidate;
    current = candidate.cause;
  }
  return {};
}

async function refused(work: Promise<unknown>, code: string, constraint?: string) {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  expect(pgError(error).code).toBe(code);
  if (constraint !== undefined) expect(pgError(error).constraint_name).toBe(constraint);
}

const history = (company: string, business: string, line: string, membership: string) =>
  sql`INSERT INTO service_line_cancellations(company_id,id,business_id,line_id,revision,previous_revision,
    previous_price,previous_discount,previous_net,cancelled_by,cancelled_by_membership_id,cancelled_at,reason,canceller_name_en)
  VALUES(${company},${ids.newId()},${business},${line},2,1,1.000,0.000,1.000,${USER},${membership},clock_timestamp(),'Cancelled','Synthetic canceller')`;

it('forces select and insert policies and no bypass', async () => {
  const [row] =
    await owner`SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced, r.rolname
    FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE c.oid=${TABLE}::regclass`;
  expect(row).toMatchObject({ rls: true, forced: true });
  expect(row?.['rolname']).not.toBe('pospay_app');
  const policies = await owner`SELECT cmd FROM pg_policies WHERE tablename=${TABLE} ORDER BY cmd`;
  expect(policies.map((policy) => policy['cmd'])).toEqual(['INSERT', 'SELECT']);
  const [role] =
    await owner`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='pospay_app'`;
  expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
});

it('isolates history rows and refuses a cross-company insert', async () => {
  expect(
    await as(
      B.company,
      sql`SELECT id FROM service_line_cancellations WHERE company_id=${A.company}`,
    ),
  ).toEqual([]);
  await refused(
    as(A.company, history(B.company, B.business, ORDER_IDS.line, ORDER_IDS.membership)),
    '42501',
  );
});

it('refuses a foreign line and a foreign membership', async () => {
  await refused(
    as(A.company, history(A.company, A.business, ids.newId(), ORDER_IDS.membership)),
    '23503',
    'slc_line_fk',
  );
  await refused(
    as(A.company, history(A.company, A.business, ORDER_IDS.line, ids.newId())),
    '23503',
    'slc_membership_fk',
  );
});

it('refuses update, delete and truncate of history even in the current company', async () => {
  await refused(
    as(A.company, sql`UPDATE service_line_cancellations SET reason='Changed'`),
    '42501',
  );
  await refused(as(A.company, sql`DELETE FROM service_line_cancellations`), '42501');
  await refused(as(A.company, sql`TRUNCATE service_line_cancellations`), '42501');
});

it('grants the table and the new functions only to pospay_app', async () => {
  const privileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'];
  for (const role of ['pospay_auth', 'pospay_dispatcher']) {
    const rows = await owner<{ allowed: boolean }[]>`
      SELECT has_table_privilege(${role}, ${TABLE}, privilege) AS allowed
      FROM unnest(${privileges}::text[]) AS privilege`;
    expect(rows.every((row) => row.allowed === false)).toBe(true);
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

it('seeds the cancel permission on the four managers only', async () => {
  const rows = await owner<{ code: string }[]>`
    SELECT r.code FROM role_permissions rp JOIN roles r ON r.id=rp.role_id
    WHERE rp.permission_code='cancel:service-lines:branch' AND r.company_id IS NULL ORDER BY 1`;
  expect(rows.map((row) => row.code)).toEqual([
    'branch_manager',
    'business_manager',
    'general_manager',
    'owner',
  ]);
});
