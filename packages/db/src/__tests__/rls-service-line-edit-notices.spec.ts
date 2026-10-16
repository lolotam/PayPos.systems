import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { createDatabase, type Database } from '../index.ts';
import { systemUuidV7 } from '@pospay/ids';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { seedOrders, ORDER_IDS } from '../../test/orders-fixture.ts';
let testDb: TestDatabase, owner: postgres.Sql, db: Database;
const ids = systemUuidV7(),
  { A, B } = TENANT;
const id = ids.newId();
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  db = createDatabase({ url: testDb.appUrl, ids, maxConnections: 2 });
  for (const t of [A, B])
    await db.withTenant(t.company, (tx) => tx.execute(insert(t.company, t.business, id)));
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});
const insert = (
  company: string,
  business: string,
  fresh = ids.newId(),
  session = ORDER_IDS.session,
  line = ORDER_IDS.line,
  revision = 2,
  count = 0,
) => sql`INSERT INTO service_line_edit_notices(company_id,id,business_id,session_id,line_id,revision,source_event_id,decided_at,recipient_count)
 VALUES(${company},${fresh},${business},${session},${line},${revision},${ids.newId()},clock_timestamp(),${count})`;
const asA = (q: SQLQuery) => db.withTenant(A.company, (tx) => tx.execute(q));
type SQLQuery = ReturnType<typeof sql>;
it('FORCE RLS, tenant PK/unique, explicit predicates, restricted role and grants', async () => {
  const [row] =
    await owner`SELECT relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='service_line_edit_notices'::regclass`;
  expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  expect(row?.['owner']).not.toBe('pospay_app');
  const [policy] =
    await owner`SELECT qual,with_check FROM pg_policies WHERE tablename='service_line_edit_notices'`;
  expect(policy?.['qual']).toContain('app_company_id()');
  expect(policy?.['with_check']).toContain('app_company_id()');
  for (const query of [
    sql`UPDATE service_line_edit_notices SET recipient_count=1`,
    sql`DELETE FROM service_line_edit_notices`,
    sql`TRUNCATE service_line_edit_notices`,
  ])
    await rejected(asA(query), '42501');
  const [role] = await owner`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='pospay_app'`;
  expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
});
it('same ID in two companies isolates read; cross-company write and a foreign parent fail', async () => {
  expect(await asA(sql`SELECT company_id,id FROM service_line_edit_notices`)).toEqual([
    { company_id: A.company, id },
  ]);
  await expect(asA(insert(B.company, B.business))).rejects.toThrow();
  await expect(
    asA(
      sql`${insert(B.company, B.business, id)} ON CONFLICT(company_id,line_id,revision) DO NOTHING`,
    ),
  ).rejects.toThrow();
  const unclaimed = ids.newId(),
    foreignSession = ids.newId(),
    other = ids.newId();
  for (const [company, session] of [
    [A.company, unclaimed],
    [B.company, foreignSession],
  ] as const)
    await owner`INSERT INTO service_sessions SELECT (jsonb_populate_record(NULL::service_sessions,
      to_jsonb(s)||jsonb_build_object('id',${session}::text))).* FROM service_sessions s
      WHERE company_id=${company} AND id=${ORDER_IDS.session}`;
  await rejected(
    asA(insert(A.company, A.business, ids.newId(), foreignSession, ORDER_IDS.line, 3)),
    '23503',
    'service_line_edit_notices_session_fk',
  );
  await rejected(
    asA(insert(A.company, A.business, ids.newId(), unclaimed, ids.newId())),
    '23503',
    'service_line_edit_notices_line_fk',
  );
  await owner`INSERT INTO businesses(company_id,id,name_en,vertical_type) VALUES(${A.company},${other},'Synthetic second salon','salon')`;
  await rejected(
    asA(insert(A.company, other, ids.newId(), unclaimed, ORDER_IDS.line, 4)),
    '23503',
    'service_line_edit_notices_session_fk',
  );
});
it('negative count fails; duplicate line revision returns no row', async () => {
  await expect(
    asA(insert(A.company, A.business, ids.newId(), ORDER_IDS.session, ORDER_IDS.line, 2, -1)),
  ).rejects.toThrow();
  expect(
    await asA(
      sql`${insert(A.company, A.business)} ON CONFLICT(company_id,line_id,revision) DO NOTHING RETURNING id`,
    ),
  ).toHaveLength(0);
});
it('no context, failed transaction, reused pool and concurrent tenants never leak', async () => {
  const raw = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await raw`SELECT id FROM service_line_edit_notices`).toHaveLength(0);
  } finally {
    await raw.end();
  }
  await expect(
    db.withTenant(B.company, async (tx) => {
      await tx.execute(sql`SELECT id FROM service_line_edit_notices`);
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  const rows = await Promise.all(
    [A.company, B.company, A.company].map((company) =>
      db.withTenant(company, (tx) =>
        tx.execute(sql`SELECT company_id FROM service_line_edit_notices`),
      ),
    ),
  );
  expect(rows.map((r) => r[0]?.['company_id'])).toEqual([A.company, B.company, A.company]);
});
async function rejected(work: Promise<unknown>, code: string, constraint?: string) {
  const error = await work.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(Error);
  const cause = (error as Error & { cause?: { code: string; constraint_name?: string } }).cause;
  expect(cause?.code).toBe(code);
  if (constraint !== undefined) expect(cause?.constraint_name).toBe(constraint);
}
