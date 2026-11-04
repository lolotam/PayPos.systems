import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { createDatabase, type Database } from '../index.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { seedOrders } from '../../test/orders-fixture.ts';

let testDb: TestDatabase, owner: postgres.Sql, db: Database;
const ids = systemUuidV7();
const { A, B } = TENANT;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  db = createDatabase({ url: testDb.appUrl, ids });
  for (const tenant of [A, B])
    await db.withTenant(tenant.company, (tx) =>
      tx.execute(insert(tenant.company, tenant.business, ids.newId(), ids.newId())),
    );
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

type SQLQuery = ReturnType<typeof sql>;
const asA = (query: SQLQuery) => db.withTenant(A.company, (tx) => tx.execute(query));
const insert = (
  company: string,
  business: string,
  fresh = ids.newId(),
  source = ids.newId(),
  count = 0,
) => sql`INSERT INTO discount_self_approval_notices(company_id,id,business_id,source_event_id,decided_at,recipient_count)
  VALUES(${company},${fresh},${business},${source},clock_timestamp(),${count})`;
const saveRule = (
  kind: string,
) => sql`INSERT INTO alert_rules(company_id,id,business_id,branch_id,kind,enabled,
    recipient_roles,channels,delay_minutes,lead_minutes,updated_by,revision)
  VALUES(${A.company},${ids.newId()},${A.business},NULL,${kind},true,ARRAY['owner']::text[],ARRAY['IN_APP']::text[],
    NULL,NULL,${USER},1)`;

it('FORCE RLS, split policies, restricted role and grants', async () => {
  const [row] =
    await owner`SELECT relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='discount_self_approval_notices'::regclass`;
  expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  expect(row?.['owner']).not.toBe('pospay_app');
  const policies = await owner<
    { policyname: string; cmd: string; qual: string | null; with_check: string | null }[]
  >`SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename='discount_self_approval_notices' ORDER BY policyname`;
  expect(policies).toMatchObject([
    {
      policyname: 'discount_self_approval_notices_insert',
      cmd: 'INSERT',
      with_check: expect.stringContaining('app_company_id()'),
    },
    {
      policyname: 'discount_self_approval_notices_select',
      cmd: 'SELECT',
      qual: expect.stringContaining('app_company_id()'),
    },
  ]);
  for (const query of [
    sql`UPDATE discount_self_approval_notices SET recipient_count=1`,
    sql`DELETE FROM discount_self_approval_notices`,
    sql`TRUNCATE discount_self_approval_notices`,
  ])
    await rejected(asA(query), '42501');
  const [role] = await owner`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='pospay_app'`;
  expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
});

it('names every constraint of the self-approval ledger', async () => {
  const rows = await owner<{ conname: string }[]>`SELECT conname FROM pg_constraint
    WHERE conrelid='discount_self_approval_notices'::regclass ORDER BY conname`;
  expect(rows.map((row) => row.conname)).toEqual([
    'discount_self_approval_notices_business_fk',
    'discount_self_approval_notices_company_fk',
    'discount_self_approval_notices_pkey',
    'discount_self_approval_notices_recipient_count',
    'discount_self_approval_notices_source_event_key',
  ]);
});

it('the application role reads and inserts only, and no runtime role touches the table', async () => {
  // pospay_owner مالك الجدول ترث صلاحياته من الملكية نفسها لا من منح صريحة، فلا تُحسب هنا؛
  // الممنوح صراحة لازم يكون pospay_app بس، و PUBLIC والأدوار التشغيلية الأخرى بلا أي منح.
  const grants = await owner<
    { grantee: string; privilege_type: string }[]
  >`SELECT grantee, privilege_type FROM information_schema.role_table_grants
    WHERE table_name='discount_self_approval_notices' AND grantee <> 'pospay_owner'
    ORDER BY grantee, privilege_type`;
  expect(grants).toEqual([
    { grantee: 'pospay_app', privilege_type: 'INSERT' },
    { grantee: 'pospay_app', privilege_type: 'SELECT' },
  ]);
  const denied = await owner<
    { grantee: string }[]
  >`SELECT DISTINCT grantee FROM information_schema.role_table_grants
    WHERE table_name='discount_self_approval_notices' AND grantee IN ('PUBLIC','pospay_auth','pospay_dispatcher')`;
  expect(denied).toEqual([]);
  expect(
    await asA(sql`SELECT company_id,source_event_id FROM discount_self_approval_notices`),
  ).toHaveLength(1);
});

it('a source event of another company is invisible, and its insert is refused by the RLS check', async () => {
  const rows = await asA(
    sql`SELECT company_id,source_event_id FROM discount_self_approval_notices`,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['company_id']).toBe(A.company);
  expect(
    await db.withTenant(B.company, (tx) =>
      tx.execute(sql`SELECT id FROM discount_self_approval_notices WHERE company_id=${A.company}`),
    ),
  ).toEqual([]);
  await rejected(asA(insert(B.company, B.business)), '42501');
});

it('a second row for the same source event is refused, and a negative count is refused', async () => {
  const [stored] = await asA(sql`SELECT source_event_id FROM discount_self_approval_notices`);
  await rejected(
    asA(insert(A.company, A.business, ids.newId(), stored?.['source_event_id'] as string)),
    '23505',
    'discount_self_approval_notices_source_event_key',
  );
  await rejected(
    asA(insert(A.company, A.business, ids.newId(), ids.newId(), -1)),
    '23514',
    'discount_self_approval_notices_recipient_count',
  );
});

it('the ledger refuses a business of another tenant, and accepts one of its own', async () => {
  await rejected(
    asA(insert(A.company, B.business)),
    '23503',
    'discount_self_approval_notices_business_fk',
  );
  await asA(insert(A.company, A.business));
  expect(await asA(sql`SELECT id FROM discount_self_approval_notices`)).toHaveLength(2);
});

it('the widened kind check accepts DISCOUNT_SELF_APPROVED and still refuses an unknown kind', async () => {
  await asA(saveRule('DISCOUNT_SELF_APPROVED'));
  await rejected(asA(saveRule('NOT_AN_ALERT_KIND')), '23514', 'alert_rules_kind');
});

it('no context, failed transaction, reused pool and concurrent tenants never leak', async () => {
  const raw = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await raw`SELECT id FROM discount_self_approval_notices`).toHaveLength(0);
  } finally {
    await raw.end();
  }
  await expect(
    db.withTenant(B.company, async (tx) => {
      await tx.execute(sql`SELECT id FROM discount_self_approval_notices`);
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  const rows = await Promise.all(
    [A.company, B.company, A.company].map((company) =>
      db.withTenant(company, (tx) =>
        tx.execute(sql`SELECT company_id FROM discount_self_approval_notices`),
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
