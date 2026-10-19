import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { createDatabase, type Database } from '../index.ts';
import { systemUuidV7 } from '@pospay/ids';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { seedOrders, ORDER_IDS } from '../../test/orders-fixture.ts';
import {
  commitChange,
  performer,
  recordLine,
  type ChangeCtx,
} from '../../test/service-line-performer-change.ts';

let testDb: TestDatabase, owner: postgres.Sql, db: Database;
const ids = systemUuidV7(),
  { A, B } = TENANT;
const id = ids.newId();
const person = performer(ORDER_IDS.employee, { nameEn: 'Synthetic performer', snapshotted: false });
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  db = createDatabase({ url: testDb.appUrl, ids, maxConnections: 2 });
  for (const t of [A, B]) await seedChange(t);
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
  line = ORDER_IDS.line,
  revision = 2,
  count = 0,
) => sql`INSERT INTO service_line_performer_notices(company_id,id,business_id,line_id,revision,source_event_id,decided_at,recipient_count)
 VALUES(${company},${fresh},${business},${line},${revision},${ids.newId()},clock_timestamp(),${count})`;
const asA = (q: SQLQuery) => db.withTenant(A.company, (tx) => tx.execute(q));
type SQLQuery = ReturnType<typeof sql>;
it('FORCE RLS, split policies, restricted role and grants', async () => {
  const [row] =
    await owner`SELECT relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='service_line_performer_notices'::regclass`;
  expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  expect(row?.['owner']).not.toBe('pospay_app');
  const policies = await owner<
    { policyname: string; cmd: string; qual: string | null; with_check: string | null }[]
  >`SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename='service_line_performer_notices' ORDER BY policyname`;
  expect(policies).toMatchObject([
    {
      policyname: 'service_line_performer_notices_insert',
      cmd: 'INSERT',
      with_check: expect.stringContaining('app_company_id()'),
    },
    {
      policyname: 'service_line_performer_notices_select',
      cmd: 'SELECT',
      qual: expect.stringContaining('app_company_id()'),
    },
  ]);
  for (const query of [
    sql`UPDATE service_line_performer_notices SET recipient_count=1`,
    sql`DELETE FROM service_line_performer_notices`,
    sql`TRUNCATE service_line_performer_notices`,
  ])
    await rejected(asA(query), '42501');
  const [role] = await owner`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='pospay_app'`;
  expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
});
it('names every constraint, including the performer-change header', async () => {
  const rows = await owner<{ conname: string }[]>`SELECT conname FROM pg_constraint
    WHERE conrelid='service_line_performer_notices'::regclass ORDER BY conname`;
  expect(rows.map((row) => row.conname)).toEqual([
    'service_line_performer_notices_change_fk',
    'service_line_performer_notices_company_fk',
    'service_line_performer_notices_line_fk',
    'service_line_performer_notices_line_revision_key',
    'service_line_performer_notices_pkey',
    'service_line_performer_notices_recipient_count',
    'service_line_performer_notices_revision',
  ]);
});
it('same ID in two companies isolates read; a cross-company write fails', async () => {
  expect(await asA(sql`SELECT company_id,id FROM service_line_performer_notices`)).toEqual([
    { company_id: A.company, id },
  ]);
  await expect(asA(insert(B.company, B.business))).rejects.toThrow();
  await expect(
    asA(
      sql`${insert(B.company, B.business, id)} ON CONFLICT(company_id,line_id,revision) DO NOTHING`,
    ),
  ).rejects.toThrow();
});
it('a notice for a line with no performer-change header is refused', async () => {
  const active = ids.newId();
  await recordLine(db, ctxOf(A), ids, active, 2, [person]);
  await rejected(
    asA(insert(A.company, A.business, ids.newId(), active, 2)),
    '23503',
    'service_line_performer_notices_change_fk',
  );
});
it('negative count and a recording revision fail; a duplicate line revision returns no row', async () => {
  await rejected(
    asA(insert(A.company, A.business, ids.newId(), ORDER_IDS.line, 2, -1)),
    '23514',
    'service_line_performer_notices_recipient_count',
  );
  await rejected(
    asA(insert(A.company, A.business, ids.newId(), ORDER_IDS.line, 1)),
    '23514',
    'service_line_performer_notices_revision',
  );
  expect(
    await asA(
      sql`${insert(A.company, A.business)} ON CONFLICT(company_id,line_id,revision) DO NOTHING RETURNING id`,
    ),
  ).toHaveLength(0);
});
it('no context, failed transaction, reused pool and concurrent tenants never leak', async () => {
  const raw = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await raw`SELECT id FROM service_line_performer_notices`).toHaveLength(0);
  } finally {
    await raw.end();
  }
  await expect(
    db.withTenant(B.company, async (tx) => {
      await tx.execute(sql`SELECT id FROM service_line_performer_notices`);
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  const rows = await Promise.all(
    [A.company, B.company, A.company].map((company) =>
      db.withTenant(company, (tx) =>
        tx.execute(sql`SELECT company_id FROM service_line_performer_notices`),
      ),
    ),
  );
  expect(rows.map((r) => r[0]?.['company_id'])).toEqual([A.company, B.company, A.company]);
});
function ctxOf(t: { company: string; business: string; branch: string }): ChangeCtx {
  return {
    company: t.company,
    business: t.business,
    branch: t.branch,
    userId: USER,
    membershipId: ORDER_IDS.membership,
    sessionId: ORDER_IDS.session,
    serviceId: ORDER_IDS.service,
  };
}
function seedChange(t: { company: string; business: string; branch: string }) {
  return commitChange(db, ctxOf(t), ids, {
    lineId: ORDER_IDS.line,
    previous: 1,
    revision: 2,
    before: [person],
    after: [person],
    live: [person],
    changerNameEn: 'Changer',
  });
}
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
