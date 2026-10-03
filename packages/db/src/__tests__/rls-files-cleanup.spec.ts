import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { createDatabase, type Database } from '../index.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';

const { A, B } = TENANT,
  ID = '01920000-0000-7000-8000-000000000cbc';
let testDb: TestDatabase, db: Database, owner: postgres.Sql;
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,staging_key,content_type,size_bytes,required_permission,created_by,created_at)
    VALUES (${B.company},${ID},${B.business},'staff',${ID},'synthetic-staging-b','application/pdf',10,'read:files:business',${USER},now())`;
  await owner`INSERT INTO file_cleanup_objects(company_id,id,file_id,object_key,kind,expiry_at,cleanup_after)
    VALUES (${B.company},${ID},${ID},'synthetic-candidate-b','CANDIDATE',now(),now())`;
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => ID } });
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});
const tenant = (companyId: string, query: ReturnType<typeof sql>) =>
  db.withTenant(companyId, (tx) => tx.execute(query));
async function refuses(work: Promise<unknown>, message: RegExp) {
  const error = await work.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(Error);
  const cause = (error as Error & { cause?: unknown }).cause;
  expect(cause instanceof Error ? cause.message : (error as Error).message).toMatch(message);
}
it('forces RLS and hides cross-tenant reads and updates, including missing context', async () => {
  const [row] =
    await owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname = 'file_cleanup_objects'`;
  expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  expect(await tenant(A.company, sql`SELECT id FROM file_cleanup_objects`)).toHaveLength(0);
  expect(
    await tenant(
      A.company,
      sql`UPDATE file_cleanup_objects SET state = 'DELETING' WHERE id = ${ID} RETURNING id`,
    ),
  ).toHaveLength(0);
  expect(
    await db.withUser(USER, (tx) => tx.execute(sql`SELECT id FROM file_cleanup_objects`)),
  ).toHaveLength(0);
});
it('rejects foreign company inserts and a tenant-qualified file FK substitution', async () => {
  for (const companyId of [A.company, B.company])
    await refuses(
      tenant(
        A.company,
        sql`
    INSERT INTO file_cleanup_objects(company_id,id,file_id,object_key,kind,expiry_at,cleanup_after)
    VALUES (${companyId},${A.business},${ID},'synthetic-attempt','CANDIDATE',now(),now())`,
      ),
      companyId === A.company ? /foreign key/ : /row-level security/,
    );
});
it('runtime cannot alter ownership or delete the immutable-key cleanup ledger', async () => {
  for (const column of [
    'company_id',
    'id',
    'file_id',
    'object_key',
    'kind',
    'verification_lease_id',
    'expiry_at',
  ])
    await refuses(
      tenant(
        B.company,
        sql`UPDATE file_cleanup_objects SET ${sql.identifier(column)} = ${sql.identifier(column)} WHERE id = ${ID}`,
      ),
      /permission denied/,
    );
  await refuses(
    tenant(B.company, sql`DELETE FROM file_cleanup_objects WHERE id = ${ID}`),
    /permission denied/,
  );
});
it.each(['authUrl', 'dispatcherUrl', 'notificationsUrl'] as const)(
  'role %s cannot access cleanup keys',
  async (url) => {
    const connection = postgres(testDb[url], { max: 1, onnotice: () => undefined });
    try {
      await expect(connection`SELECT id FROM file_cleanup_objects`).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await connection.end();
    }
  },
);
