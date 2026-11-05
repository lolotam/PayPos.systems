import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createTestDatabase } from '../../../../../../packages/db/test/test-database.ts';
import {
  seedTwoTenants,
  TENANT,
  USER,
} from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { documentFileFacts, documentFileStatement } from '../queries/document-file.query.ts';

const ids = systemUuidV7();
let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
let owner: postgres.Sql;
let db: ReturnType<typeof createDatabase>;
const fileId = ids.newId();
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  await owner`INSERT INTO "user"(id,name,email) VALUES(${USER},'Synthetic reader','worker-file-reader@example.test') ON CONFLICT(id) DO NOTHING`;
  const keys = [fileId, ...Array.from({ length: 1000 }, () => ids.newId())];
  await owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,staging_key,storage_key,
    content_type,size_bytes,required_permission,created_by,created_at,status)
    SELECT ${TENANT.A.company},k.id,${TENANT.A.business},'orders',${TENANT.A.business},'staging/'||k.id,'verified/'||k.id,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',100,'import:packages:business',${USER},now(),'READY'
    FROM unnest(${keys}::uuid[]) k(id)`;
  await owner`ANALYZE file_objects`;
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

it('returns scoped verified facts and a tenant/id index plan for the exact reader statement', async () => {
  await db.withTenant(TENANT.A.company, async (tx) => {
    expect(await documentFileFacts(tx, TENANT.A.company, fileId)).toMatchObject({
      business_id: TENANT.A.business,
      created_by: USER,
      status: 'READY',
      storage_key: `verified/${fileId}`,
      size_bytes: 100,
      purged: false,
      purge_started: false,
    });
    const statement = documentFileStatement(TENANT.A.company, fileId);
    const plan = JSON.stringify(await tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON) ${statement}`));
    expect(plan).toMatch(/Index(?: Only)? Scan/);
    expect(plan).toContain('Index Cond');
    expect(plan).toContain('company_id =');
    expect(plan).toContain('id =');
  });
  expect(
    await db.withTenant(TENANT.B.company, (tx) => documentFileFacts(tx, TENANT.A.company, fileId)),
  ).toBeNull();
});

it('reports purge state and hides the storage key before verification', async () => {
  await owner`UPDATE file_objects SET status='VERIFYING',storage_key=NULL,purge_started_at=now() WHERE id=${fileId}`;
  expect(
    await db.withTenant(TENANT.A.company, (tx) => documentFileFacts(tx, TENANT.A.company, fileId)),
  ).toMatchObject({ storage_key: null, purge_started: true });
});
