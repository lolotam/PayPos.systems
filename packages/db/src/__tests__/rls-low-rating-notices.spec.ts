import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ALERT_KINDS } from '@pospay/domain';
import { createDatabase, type Database } from '../index.ts';
import {
  claimRequest,
  consumeAndRate,
  insertRequest,
  RATING_TENANT,
  seedRatingTenants,
  type RatingTenant,
} from '../../test/rating-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

let testDb: TestDatabase, owner: postgres.Sql, db: Database;
const ids = systemUuidV7();
const { A, B } = RATING_TENANT;
const NOW = '2026-06-02T00:00:00Z';
const ratingOf: Record<string, string> = {};
let hashByte = 100;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedRatingTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  for (const tenant of [A, B]) {
    const rating = await seedRating(tenant, '2026-12-01');
    ratingOf[tenant.company] = rating;
    await db.withTenant(tenant.company, (tx) => tx.execute(insert(tenant, rating)));
  }
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

/** بيعمل تقييماً حقيقياً بنجمة واحدة في الشركة المعطاة، لأن السجل بيشاور عليه بمفتاح مركب. */
async function seedRating(tenant: RatingTenant, date: string): Promise<string> {
  const tokenHash = Buffer.alloc(32, hashByte++);
  return db.withTenant(tenant.company, async (tx) => {
    const requestId = await insertRequest(tx, { tenant, date });
    await claimRequest(tx, {
      tenant,
      requestId,
      tokenHash,
      readyEventId: ids.newId(),
      now: NOW,
      performers: [tenant.employees[0]],
    });
    const rating = await consumeAndRate(tx, {
      tenant,
      requestId,
      tokenHash,
      now: NOW,
      stars: 1,
      attribute: [tenant.employees[0]],
    });
    return rating as string;
  });
}

type SQLQuery = ReturnType<typeof sql>;
const asA = (query: SQLQuery) => db.withTenant(A.company, (tx) => tx.execute(query));
const insert = (
  tenant: Pick<RatingTenant, 'company' | 'business' | 'branch'>,
  ratingId: string,
  count = 0,
  companyOverride: string = tenant.company,
) => sql`INSERT INTO low_rating_notices(company_id,id,business_id,branch_id,rating_id,source_event_id,decided_at,recipient_count)
  VALUES(${companyOverride},${ids.newId()},${tenant.business},${tenant.branch},${ratingId},${ids.newId()},clock_timestamp(),${count})`;

it('FORCE RLS, split policies, restricted role and grants', async () => {
  const [row] =
    await owner`SELECT relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='low_rating_notices'::regclass`;
  expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  expect(row?.['owner']).not.toBe('pospay_app');
  const policies = await owner<
    { policyname: string; cmd: string; roles: string[]; qual: string | null; with_check: string | null }[]
  >`SELECT policyname, cmd, roles, qual, with_check FROM pg_policies WHERE tablename='low_rating_notices' ORDER BY policyname`;
  expect(policies).toMatchObject([
    {
      policyname: 'low_rating_notices_insert',
      cmd: 'INSERT',
      roles: ['pospay_app'],
      with_check: expect.stringContaining('app_company_id()'),
    },
    {
      policyname: 'low_rating_notices_select',
      cmd: 'SELECT',
      roles: ['pospay_app'],
      qual: expect.stringContaining('app_company_id()'),
    },
  ]);
  const grants = await owner<{ grantee: string; privilege: string }[]>`
    SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
           a.privilege_type AS privilege
    FROM pg_class c, aclexplode(c.relacl) a
    WHERE c.oid = 'low_rating_notices'::regclass AND a.grantee <> c.relowner
    ORDER BY 1, 2`;
  expect(grants).toEqual([
    { grantee: 'pospay_app', privilege: 'INSERT' },
    { grantee: 'pospay_app', privilege: 'SELECT' },
  ]);
  const [role] = await owner`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='pospay_app'`;
  expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
});

it('names every constraint of the decision ledger', async () => {
  const rows = await owner<{ conname: string }[]>`SELECT conname FROM pg_constraint
    WHERE conrelid='low_rating_notices'::regclass ORDER BY conname`;
  expect(rows.map((row) => row.conname)).toEqual([
    'low_rating_notices_company_id_companies_id_fk',
    'low_rating_notices_pkey',
    'low_rating_notices_rating_fk',
    'low_rating_notices_rating_key',
    'low_rating_notices_recipient_count',
  ]);
});

it('a notice of another company is invisible and cannot be written', async () => {
  const rows = await asA(sql`SELECT company_id,rating_id FROM low_rating_notices`);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['company_id']).toBe(A.company);
  expect(rows[0]?.['rating_id']).toBe(ratingOf[A.company]);
  expect(
    await db.withTenant(B.company, (tx) =>
      tx.execute(sql`SELECT id FROM low_rating_notices WHERE company_id=${A.company}`),
    ),
  ).toEqual([]);
  expect(
    await db.withTenant(B.company, (tx) =>
      tx.execute(sql`SELECT company_id FROM low_rating_notices`),
    ),
  ).toEqual([{ company_id: B.company }]);
  await rejected(asA(insert(B, ratingOf[B.company] as string)), '42501');
  await rejected(asA(insert(A, ratingOf[A.company] as string, 0, B.company)), '42501');
});

it('a stored notice cannot be re-homed, updated, deleted or truncated', async () => {
  const [stored] = await asA(sql`SELECT id FROM low_rating_notices`);
  expect(stored?.['id']).toBeDefined();
  for (const query of [
    sql`UPDATE low_rating_notices SET company_id=${B.company} WHERE id=${stored?.['id'] as string}`,
    sql`UPDATE low_rating_notices SET recipient_count=9`,
    sql`DELETE FROM low_rating_notices`,
    sql`TRUNCATE low_rating_notices`,
  ])
    await rejected(asA(query), '42501');
  expect(await asA(sql`SELECT recipient_count FROM low_rating_notices`)).toEqual([
    { recipient_count: 0 },
  ]);
});

it('a second decision for the same rating is refused and a rating of another company is not referenceable', async () => {
  await rejected(
    asA(insert(A, ratingOf[A.company] as string)),
    '23505',
    'low_rating_notices_rating_key',
  );
  await asA(insert(A, await seedRating(A, '2026-12-02')));
  await rejected(
    asA(insert(A, ratingOf[B.company] as string)),
    '23503',
    'low_rating_notices_rating_fk',
  );
});

it('a negative recipient count is refused, zero and positive counts are stored', async () => {
  const refused = await seedRating(A, '2026-12-03');
  await rejected(asA(insert(A, refused, -1)), '23514', 'low_rating_notices_recipient_count');
  await asA(insert(A, refused, 0));
  const counted = await seedRating(A, '2026-12-04');
  await asA(insert(A, counted, 4));
  expect(
    await asA(sql`SELECT recipient_count FROM low_rating_notices WHERE rating_id=${counted}`),
  ).toEqual([{ recipient_count: 4 }]);
});

it('no context, failed transaction, reused pool and concurrent tenants never leak', async () => {
  const raw = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await raw`SELECT id FROM low_rating_notices`).toHaveLength(0);
  } finally {
    await raw.end();
  }
  await expect(
    db.withTenant(B.company, async (tx) => {
      await tx.execute(sql`SELECT id FROM low_rating_notices`);
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  const rows = await Promise.all(
    [A.company, B.company, A.company].map((company) =>
      db.withTenant(company, (tx) =>
        tx.execute(sql`SELECT company_id FROM low_rating_notices LIMIT 1`),
      ),
    ),
  );
  expect(rows.map((r) => r[0]?.['company_id'])).toEqual([A.company, B.company, A.company]);
});

it('alert_rules_kind database CHECK constraint and domain ALERT_KINDS stay the same set', async () => {
  const [row] = await owner<{ def: string }[]>`SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conname = 'alert_rules_kind' AND conrelid = 'alert_rules'::regclass`;
  expect(row).toBeDefined();
  const kinds = [...(row?.def ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  expect(kinds).toEqual([...ALERT_KINDS].sort());
  expect(kinds).toContain('LOW_RATING');
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
