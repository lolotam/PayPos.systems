import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { createDatabase, type Database } from '../index.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, USER } from '../../test/tenancy-fixtures.ts';
import { seedOrders, ORDER_IDS } from '../../test/orders-fixture.ts';
import {
  openSession,
  revisionRow,
  revisionSql,
  seedSessionTipStaff,
  tenantA,
  tenantB,
  TIP,
  tipRow,
  tipSql,
  writeRevision,
  type TipCtx,
} from '../../test/session-tip.ts';

const FUNCTIONS = ['session_tip_revisions_begin', 'session_tips_insert_guard'];
const TABLES = ['session_tip_revisions', 'session_tips'] as const;

let testDb: TestDatabase, owner: postgres.Sql, db: Database;
const ids = systemUuidV7();
const ctx: TipCtx = tenantA();
const other: TipCtx = tenantB();

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  await seedSessionTipStaff(owner);
  db = createDatabase({ url: testDb.appUrl, ids });
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

const as = (company: string, query: ReturnType<typeof sql>) =>
  db.withTenant(company, (tx) => tx.execute(query), { userId: USER });

async function rejected(work: Promise<unknown>, code: string, constraint?: string) {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  const cause = (error as { cause?: { code?: string; constraint_name?: string } }).cause;
  if (constraint === undefined) {
    expect(cause?.code).toBe(code);
    return;
  }
  expect([cause?.code, cause?.constraint_name]).toEqual([code, constraint]);
}

async function session(): Promise<string> {
  const sessionId = ids.newId();
  await openSession(owner, ctx, sessionId);
  return sessionId;
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

it('returns no rows to the other company and refuses a cross-company insert', async () => {
  const sessionId = await session();
  const header = revisionRow(ids, sessionId, 1);
  await writeRevision(db, ctx, header, [tipRow(ids, header.id, sessionId)]);
  for (const table of TABLES) {
    expect(
      await as(
        other.company,
        sql`SELECT id FROM ${sql.identifier(table)} WHERE company_id=${ctx.company}`,
      ),
    ).toEqual([]);
  }
  await rejected(
    as(ctx.company, revisionSql(other, revisionRow(ids, ORDER_IDS.session, 1))),
    '42501',
  );
  await rejected(
    as(ctx.company, tipSql(other, tipRow(ids, ids.newId(), ORDER_IDS.session))),
    '42501',
  );
});

it('rejects a session that belongs to the other company', async () => {
  await rejected(
    writeRevision(db, ctx, revisionRow(ids, TIP.foreignSession, 1)),
    '23503',
    'session_tip_revisions_session_fk',
  );
});

it('rejects an employee that belongs to the other company', async () => {
  const sessionId = await session();
  const header = revisionRow(ids, sessionId, 1);
  await rejected(
    writeRevision(db, ctx, header, [
      tipRow(ids, header.id, sessionId, { employeeId: TIP.foreignEmployee }),
    ]),
    '23503',
    'session_tips_employee_fk',
  );
});

// الحارس يسبق المفتاح: المراجعة الأجنبية ليست في هذه المعاملة، فيُرفض الختم قبل فحص المرجعية.
it('rejects a revision that belongs to the other company', async () => {
  const sessionId = ids.newId();
  await openSession(owner, other, sessionId);
  const header = revisionRow(ids, sessionId, 1);
  await writeRevision(db, other, header);
  await rejected(
    as(ctx.company, tipSql(ctx, tipRow(ids, header.id, ORDER_IDS.session))),
    '23514',
    'session_tips_current_xact',
  );
});

it('refuses update, delete and truncate even in the current company', async () => {
  for (const table of TABLES) {
    await rejected(
      as(ctx.company, sql`UPDATE ${sql.identifier(table)} SET business_id=${ctx.business}`),
      '42501',
    );
    await rejected(as(ctx.company, sql`DELETE FROM ${sql.identifier(table)}`), '42501');
    await rejected(as(ctx.company, sql`TRUNCATE ${sql.identifier(table)}`), '42501');
  }
});

it('grants the tables and functions only to pospay_app', async () => {
  const privileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'];
  for (const role of ['pospay_auth', 'pospay_dispatcher']) {
    for (const table of TABLES) {
      const rows = await owner<{ allowed: boolean }[]>`
        SELECT has_table_privilege(${role}, ${table}, privilege) AS allowed
        FROM unnest(${privileges}::text[]) AS privilege`;
      expect(rows.every((row) => row.allowed === false)).toBe(true);
    }
  }
  const app = await owner<{ privilege: string; allowed: boolean }[]>`
    SELECT privilege, has_table_privilege('pospay_app', table_name, privilege) AS allowed
    FROM unnest(${TABLES}::text[]) AS table_name, unnest(${privileges}::text[]) AS privilege`;
  for (const row of app) {
    expect(row.allowed).toBe(row.privilege === 'SELECT' || row.privilege === 'INSERT');
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
