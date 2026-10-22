import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { createDatabase, type Database } from '../index.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';

let testDb: TestDatabase, owner: postgres.Sql, db: Database;
const ids = systemUuidV7(),
  { A, B } = TENANT;
const sharedId = ids.newId();
type SQLQuery = ReturnType<typeof sql>;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`INSERT INTO "user" (id,name,email) VALUES (${USER},'Synthetic user','alerts@example.test')
    ON CONFLICT DO NOTHING`;
  db = createDatabase({ url: testDb.appUrl, ids, maxConnections: 2 });
  for (const t of [A, B])
    await db.withTenant(t.company, (tx) =>
      tx.execute(insert(t.company, t.business, null, 'SHIFT_NOT_CLOCKED_IN', sharedId)),
    );
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

function insert(
  company: string,
  business: string,
  branch: string | null,
  kind: string,
  id = ids.newId(),
  extra: { roles?: string; channels?: string; lead?: number | null } = {},
): SQLQuery {
  const roles = sql.raw(extra.roles ?? "ARRAY['owner']::text[]");
  const channels = sql.raw(extra.channels ?? "ARRAY['IN_APP']::text[]");
  return sql`INSERT INTO alert_rules(company_id,id,business_id,branch_id,kind,enabled,recipient_roles,channels,
    delay_minutes,lead_minutes,updated_by,revision)
    VALUES(${company},${id},${business},${branch},${kind},true,${roles},${channels},20,${extra.lead ?? null},${USER},1)`;
}
const asA = (q: SQLQuery) => db.withTenant(A.company, (tx) => tx.execute(q));

it('FORCE RLS, split policies, restricted role and column-only updates', async () => {
  const [row] =
    await owner`SELECT relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='alert_rules'::regclass`;
  expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  expect(row?.['owner']).not.toBe('pospay_app');
  const policies = await owner<{ policyname: string; cmd: string }[]>`
    SELECT policyname, cmd FROM pg_policies WHERE tablename='alert_rules' ORDER BY policyname`;
  expect(policies.map((p) => `${p.policyname}:${p.cmd}`)).toEqual([
    'alert_rules_delete:DELETE',
    'alert_rules_insert:INSERT',
    'alert_rules_select:SELECT',
    'alert_rules_update:UPDATE',
  ]);
  for (const query of [
    sql`UPDATE alert_rules SET kind='ATTENDANCE_EXCEPTION'`,
    sql`UPDATE alert_rules SET branch_id=NULL`,
    sql`TRUNCATE alert_rules`,
  ])
    await rejected(asA(query), '42501');
});

it('names every constraint', async () => {
  const rows = await owner<{ conname: string }[]>`SELECT conname FROM pg_constraint
    WHERE conrelid='alert_rules'::regclass ORDER BY conname`;
  expect(rows.map((r) => r.conname)).toEqual([
    'alert_rules_branch_fk',
    'alert_rules_business_fk',
    'alert_rules_channels',
    'alert_rules_delay_minutes',
    'alert_rules_document_lead',
    'alert_rules_kind',
    'alert_rules_lead_minutes',
    'alert_rules_pkey',
    'alert_rules_recipient_roles',
    'alert_rules_revision',
    'alert_rules_updated_by_user_id_fk',
  ]);
});

it('same ID in two companies isolates read; cross-company insert, update and re-home fail', async () => {
  expect(await asA(sql`SELECT company_id,id FROM alert_rules`)).toEqual([
    { company_id: A.company, id: sharedId },
  ]);
  await expect(asA(insert(B.company, B.business, null, 'ATTENDANCE_EXCEPTION'))).rejects.toThrow();
  expect(
    await asA(sql`UPDATE alert_rules SET enabled=false WHERE company_id=${B.company} RETURNING id`),
  ).toHaveLength(0);
  await rejected(
    asA(sql`UPDATE alert_rules SET company_id=${B.company} WHERE id=${sharedId}`),
    '42501',
  );
  expect(
    await asA(sql`DELETE FROM alert_rules WHERE company_id=${B.company} RETURNING id`),
  ).toHaveLength(0);
});

it('a branch of another business or company is refused; one rule per kind and scope', async () => {
  await rejected(
    asA(insert(A.company, A.business, B.branch, 'SHIFT_NOT_CLOCKED_IN')),
    '23503',
    'alert_rules_branch_fk',
  );
  await rejected(asA(insert(A.company, A.business, null, 'SHIFT_NOT_CLOCKED_IN')), '23505');
  await asA(insert(A.company, A.business, A.branch, 'SHIFT_NOT_CLOCKED_IN'));
  await rejected(asA(insert(A.company, A.business, A.branch, 'SHIFT_NOT_CLOCKED_IN')), '23505');
});

it('the business rule cannot be deleted; a branch override can', async () => {
  expect(
    await asA(sql`DELETE FROM alert_rules WHERE id=${sharedId} RETURNING id`),
  ).toHaveLength(0);
  const branchRule = ids.newId();
  await asA(insert(A.company, A.business, A.branch, 'ATTENDANCE_EXCEPTION', branchRule));
  expect(
    await asA(sql`DELETE FROM alert_rules WHERE id=${branchRule} RETURNING id`),
  ).toHaveLength(1);
});

it('checks refuse an unknown kind or role, a non-app channel and a document lead', async () => {
  await rejected(asA(insert(A.company, A.business, null, 'LOW_RATING')), '23514', 'alert_rules_kind');
  await rejected(
    asA(insert(A.company, A.business, null, 'LATE_SERVICE_SESSION', ids.newId(), { roles: "ARRAY['cashier']::text[]" })),
    '23514',
    'alert_rules_recipient_roles',
  );
  await rejected(
    asA(insert(A.company, A.business, null, 'LATE_SERVICE_SESSION', ids.newId(), { channels: "ARRAY['EMAIL']::text[]" })),
    '23514',
    'alert_rules_channels',
  );
  await rejected(
    asA(insert(A.company, A.business, null, 'DOCUMENT_EXPIRING', ids.newId(), { lead: 60 })),
    '23514',
    'alert_rules_document_lead',
  );
});

it('no context, failed transaction, reused pool and concurrent tenants never leak', async () => {
  const raw = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await raw`SELECT id FROM alert_rules`).toHaveLength(0);
  } finally {
    await raw.end();
  }
  await expect(
    db.withTenant(B.company, async (tx) => {
      await tx.execute(sql`SELECT id FROM alert_rules`);
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  const rows = await Promise.all(
    [A.company, B.company, A.company].map((company) =>
      db.withTenant(company, (tx) => tx.execute(sql`SELECT company_id FROM alert_rules LIMIT 1`)),
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
