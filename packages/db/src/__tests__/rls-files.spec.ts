import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';

const { A, B } = TENANT;
const ID = '01920000-0000-7000-8000-000000000abc';
let testDb: TestDatabase, db: Database, owner: postgres.Sql;
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`INSERT INTO file_objects (company_id,id,business_id,owner_module,owner_entity_id,staging_key,content_type,size_bytes,required_permission,created_by,created_at)
    VALUES (${B.company},${ID},${B.business},'staff',${ID},'synthetic-staging-b','application/pdf',10,'read:files:business',${USER},now())`;
  await owner`INSERT INTO file_access_audit (company_id,id,file_id,actor_user_id,accessed_at,outcome) VALUES (${B.company},${ID},${ID},${USER},now(),'ALLOW')`;
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => ID } });
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});
const asA = (query: ReturnType<typeof sql>) =>
  db.withTenant(A.company, (tx) => tx.execute(query), { userId: USER });
const insert = (companyId: string, businessId: string, id = ID) => sql`
  INSERT INTO file_objects (company_id,id,business_id,owner_module,owner_entity_id,staging_key,content_type,size_bytes,required_permission,created_by,created_at)
  VALUES (${companyId},${id},${businessId},'staff',${ID},${`synthetic-${id}`},'application/pdf',10,'read:files:business',${USER},now()) RETURNING id`;
async function fails(work: Promise<unknown>, expected: RegExp) {
  const error = await work.catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(Error);
  const cause = (error as Error & { cause?: unknown }).cause;
  expect(cause instanceof Error ? cause.message : (error as Error).message).toMatch(expected);
}
it.each(['file_objects', 'file_access_audit'])('forces isolation on %s', async (table) => {
  const [row] =
    await owner`SELECT relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relname = ${table}`;
  expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  expect(row?.['owner']).not.toBe('pospay_app');
  expect(Array.from(await asA(sql`SELECT id FROM ${sql.identifier(table)}`))).toEqual([]);
});
it('refuses cross-tenant inserts and tenant-qualified foreign key substitution', async () => {
  await fails(asA(insert(B.company, B.business)), /row-level security/);
  await fails(asA(insert(A.company, B.business)), /foreign key/);
  await fails(
    asA(sql`INSERT INTO file_access_audit (company_id,id,file_id,actor_user_id,accessed_at,outcome)
    VALUES (${B.company},${ID},${ID},${USER},now(),'ALLOW')`),
    /row-level security/,
  );
  await fails(
    asA(sql`INSERT INTO file_access_audit (company_id,id,file_id,actor_user_id,accessed_at,outcome)
    VALUES (${A.company},${ID},${ID},${USER},now(),'ALLOW')`),
    /foreign key/,
  );
});
it('tenant ids do not leak existence; foreign rows cannot be updated or upserted', async () => {
  expect(Array.from(await asA(insert(A.company, A.business)))).toEqual([{ id: ID }]);
  expect(
    Array.from(
      await asA(
        sql`UPDATE file_objects SET status = 'REJECTED' WHERE company_id = ${B.company} RETURNING id`,
      ),
    ),
  ).toEqual([]);
  await fails(
    asA(sql`INSERT INTO file_objects (company_id,id,business_id,owner_module,owner_entity_id,staging_key,content_type,size_bytes,required_permission,created_by,created_at)
    VALUES (${B.company},${ID},${B.business},'staff',${ID},'synthetic-staging-b','application/pdf',10,'read:files:business',${USER},now())
    ON CONFLICT (company_id,id) DO UPDATE SET status = 'REJECTED'`),
    /row-level security/,
  );
});
it('ownership, permissions, staging keys and audit history are immutable to runtime', async () => {
  for (const column of ['company_id', 'business_id', 'created_by'])
    await fails(
      asA(sql`UPDATE file_objects SET ${sql.identifier(column)} = ${B.company} WHERE id = ${ID}`),
      /permission denied/,
    );
  await fails(
    asA(
      sql`UPDATE file_objects SET required_permission = 'read:settings:business' WHERE id = ${ID}`,
    ),
    /permission denied/,
  );
  await fails(
    asA(sql`UPDATE file_objects SET staging_key = 'changed' WHERE id = ${ID}`),
    /permission denied/,
  );
  await fails(asA(sql`DELETE FROM file_objects WHERE id = ${ID}`), /permission denied/);
  await asA(
    sql`INSERT INTO file_access_audit (company_id,id,file_id,actor_user_id,accessed_at,outcome) VALUES (${A.company},${ID},${ID},${USER},now(),'ALLOW')`,
  );
  await fails(
    asA(sql`UPDATE file_access_audit SET outcome = 'DENY' WHERE id = ${ID}`),
    /permission denied/,
  );
  await fails(asA(sql`DELETE FROM file_access_audit WHERE id = ${ID}`), /permission denied/);
  await fails(
    asA(
      sql`INSERT INTO file_access_audit (company_id,id,file_id,actor_user_id,accessed_at,outcome) VALUES (${A.company},${A.business},${ID},${B.business},now(),'ALLOW')`,
    ),
    /row-level security/,
  );
});
it('no-context and reused connections expose neither tenant table', async () => {
  await db.withTenant(B.company, (tx) => tx.execute(sql`SELECT id FROM file_objects`));
  await expect(
    db.withTenant(A.company, async () => {
      throw new Error('synthetic rollback');
    }),
  ).rejects.toThrow('synthetic rollback');
  for (const table of ['file_objects', 'file_access_audit'])
    expect(
      Array.from(
        await db.withUser(USER, (tx) => tx.execute(sql`SELECT id FROM ${sql.identifier(table)}`)),
      ),
    ).toEqual([]);
});
it.each(['authUrl', 'dispatcherUrl', 'notificationsUrl'] as const)(
  'other role %s has no files or audit access',
  async (url) => {
    const connection = postgres(testDb[url], { max: 1, onnotice: () => undefined });
    try {
      for (const table of ['file_objects', 'file_access_audit'])
        await expect(connection.unsafe(`SELECT id FROM ${table}`)).rejects.toThrow(
          /permission denied/,
        );
    } finally {
      await connection.end();
    }
  },
);
