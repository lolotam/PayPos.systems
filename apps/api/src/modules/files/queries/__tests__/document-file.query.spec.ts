import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  seedTwoTenants,
  TENANT,
  USER,
} from '../../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../../packages/db/test/test-database.ts';
import { documentFileFacts, documentFileStatement } from '../document-file.query.ts';

// CLAUDE.md §9: شكل حقائق الملف التي تربط بها staff وثيقة الموظف، وخطة الفهرس.
const ids = systemUuidV7();
let testDb: TestDatabase;
let db: Database;
let owner: postgres.Sql;
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});
async function file(status: 'PENDING' | 'READY') {
  const id = ids.newId();
  const { company, business } = TENANT.A;
  await owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,staging_key,storage_key,
    content_type,size_bytes,required_permission,created_by,created_at,status)
    VALUES (${company},${id},${business},'staff',${id},${`${id}/staging`},${status === 'READY' ? `${id}/verified` : null},
      'application/pdf',10,'read:files:business',${USER},now(),${status})`;
  return id;
}

it('exposes the key only once READY and never across tenants', async () => {
  const { A, B } = TENANT;
  const ready = await file('READY');
  const pending = await file('PENDING');
  expect(await db.withTenant(A.company, (tx) => documentFileFacts(tx, A.company, ready))).toEqual({
    business_id: A.business,
    branch_id: null,
    owner_module: 'staff',
    owner_entity_id: ready,
    required_permission: 'read:files:business',
    created_by: USER,
    status: 'READY',
    storage_key: `${ready}/verified`,
    purged: false,
  });
  const waiting = await db.withTenant(A.company, (tx) => documentFileFacts(tx, A.company, pending));
  expect(waiting?.storage_key).toBeNull();
  expect(
    await db.withTenant(B.company, (tx) => documentFileFacts(tx, A.company, ready)),
  ).toBeNull();
  const plan = await db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${documentFileStatement(A.company, ready)}`,
    );
  });
  expect(JSON.stringify(plan)).toMatch(/Index (Only )?Scan|Bitmap Index Scan/);
});
