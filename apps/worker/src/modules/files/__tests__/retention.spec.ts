import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createS3Storage, buildObjectKey } from '@pospay/storage';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import {
  seedTwoTenants,
  TENANT,
  USER,
} from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { PROVISIONAL_PLAN_ID } from '../../../../../../packages/db/src/seed.ts';
import { fakeS3, fakeCredentials } from '../../../../../../packages/storage/test/fake-s3.ts';
import { createFileRepository } from '../../../../../api/src/modules/files/persistence/file-repository.ts';
import { retentionRepository } from '../persistence/retention.repository.ts';
import { verificationRepository } from '../persistence/verification.repository.ts';
import { CleanupFiles } from '../use-cases/cleanup-files/cleanup-files.ts';

const ids = systemUuidV7();
let testDb: TestDatabase, db: Database, owner: postgres.Sql;
let fake: Awaited<ReturnType<typeof fakeS3>>, storage: ReturnType<typeof createS3Storage>;
let tenant: { company: string; business: string };
let now: Date;
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  fake = await fakeS3();
  storage = createS3Storage({
    endpoint: fake.endpoint,
    region: 'auto',
    bucket: 'private',
    ...fakeCredentials,
  });
});
beforeEach(async () => {
  now = new Date('2026-10-10T12:00:00Z');
  tenant = { company: ids.newId(), business: ids.newId() };
  await owner`INSERT INTO companies(id, owner_user_id, plan_id, name_en) VALUES (${tenant.company},${USER},${PROVISIONAL_PLAN_ID},'Synthetic retention')`;
  await owner`INSERT INTO businesses(company_id,id,vertical_type,name_en) VALUES (${tenant.company},${tenant.business},'salon','Synthetic retention')`;
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  storage?.close();
  await fake?.close();
  await testDb?.drop();
});
async function file(
  patch: {
    status?: 'PENDING' | 'REJECTED' | 'READY';
    created?: Date;
    rejected?: Date;
    confirmed?: Date;
    tenant?: { company: string; business: string };
  } = {},
) {
  const id = ids.newId(),
    t = patch.tenant ?? tenant,
    key = buildObjectKey(t.company, t.business, id, 'staging');
  const published =
    patch.status === 'READY' ? buildObjectKey(t.company, t.business, id, 'verified') : null;
  await owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,staging_key,storage_key,content_type,size_bytes,required_permission,created_by,created_at,status,confirmed_at,rejected_at)
    VALUES (${t.company},${id},${t.business},'staff',${id},${key},${published},'application/pdf',10,'read:files:business',${USER},${patch.created ?? new Date('2026-10-01')},${patch.status ?? 'PENDING'},${patch.confirmed ?? null},${patch.rejected ?? null})`;
  await storage.put(key, new Uint8Array(10), 'application/pdf');
  if (published !== null) await storage.put(published, new Uint8Array(10), 'application/pdf');
  return { id, key, published };
}
function cleanup(target = storage) {
  return new CleanupFiles(retentionRepository(db, ids), target, ids, { now: () => now });
}
async function auditCount(id: string) {
  const [row] =
    await owner`SELECT count(*)::int AS n FROM audit_log WHERE entity_id = ${id} AND action = 'retention.deleted'`;
  return row?.['n'];
}
it('deletes at 24h/7d, preserves newer, confirmed and verified files, and audits only deletion', async () => {
  const abandoned = await file({ created: new Date(now.getTime() - 24 * 3600000) });
  const recent = await file({ created: new Date(now.getTime() - 24 * 3600000 + 1) });
  const confirmed = await file({ confirmed: new Date('2026-10-01') });
  const ready = await file({ status: 'READY' });
  const rejected = await file({
    status: 'REJECTED',
    rejected: new Date(now.getTime() - 7 * 24 * 3600000),
  });
  const recentReject = await file({
    status: 'REJECTED',
    rejected: new Date(now.getTime() - 7 * 24 * 3600000 + 1),
  });
  expect(await cleanup().execute(tenant.company, 'abandoned')).toBe(1);
  expect(await cleanup().execute(tenant.company, 'rejected')).toBe(1);
  for (const f of [abandoned, rejected]) {
    expect(fake.objects.has(f.key)).toBe(false);
    expect(await auditCount(f.id)).toBe(1);
    const [audit] =
      await owner`SELECT actor_user_id, after FROM audit_log WHERE entity_id = ${f.id}`;
    expect(audit?.['actor_user_id']).toBeNull();
    expect(JSON.stringify(audit)).not.toContain(f.key);
  }
  for (const f of [recent, confirmed, ready, recentReject]) {
    expect(fake.objects.has(f.key)).toBe(true);
    expect(await auditCount(f.id)).toBe(0);
  }
  expect(fake.objects.has(ready.published ?? '')).toBe(true);
  expect(await cleanup().execute(tenant.company, 'abandoned')).toBe(0);
});
it('caps each batch at 50 and repeats idempotently without losing immutable access audits', async () => {
  const files = await Promise.all(Array.from({ length: 51 }, () => file()));
  await db.withTenant(
    tenant.company,
    (tx) =>
      tx.execute(sql`INSERT INTO file_access_audit(company_id,id,file_id,actor_user_id,accessed_at,outcome)
    VALUES (${tenant.company},${ids.newId()},${files[0]?.id},${USER},now(),'DENY')`),
    { userId: USER },
  );
  expect(await cleanup().execute(tenant.company, 'abandoned')).toBe(50);
  expect(await cleanup().execute(tenant.company, 'abandoned')).toBe(1);
  expect(await cleanup().execute(tenant.company, 'abandoned')).toBe(0);
  const [audit] =
    await owner`SELECT count(*)::int AS n FROM file_access_audit WHERE company_id = ${tenant.company}`;
  expect(audit?.['n']).toBe(1);
});
it('provider failure retries an expired claim and writes one audit after successful deletion', async () => {
  const f = await file();
  let fail = true;
  const useCase = cleanup({
    ...storage,
    remove: async (key) => {
      if (fail) throw new Error('STORAGE_UNAVAILABLE');
      await storage.remove(key);
    },
  });
  await expect(useCase.execute(tenant.company, 'abandoned')).rejects.toThrow('STORAGE_UNAVAILABLE');
  expect(await auditCount(f.id)).toBe(0);
  expect(fake.objects.has(f.key)).toBe(true);
  expect(await useCase.execute(tenant.company, 'abandoned')).toBe(0);
  fail = false;
  now = new Date(now.getTime() + 20 * 60 * 1000);
  expect(await useCase.execute(tenant.company, 'abandoned')).toBe(1);
  expect(await useCase.execute(tenant.company, 'abandoned')).toBe(0);
  expect(await auditCount(f.id)).toBe(1);
});
it('confirmation wins before claim, purge fences later confirmation/verification, and stale leases cannot finish', async () => {
  const kept = await file(),
    purged = await file();
  const api = createFileRepository(db, ids),
    actor = { companyId: tenant.company, userId: USER };
  expect(await api.confirm(actor, kept.id, now)).toBe(true);
  const repo = retentionRepository(db, ids),
    lease = ids.newId();
  const claimed = await repo.claim(
    tenant.company,
    'abandoned',
    lease,
    now,
    new Date('2026-10-09T12:00:00Z'),
    new Date('2026-10-10T12:20:00Z'),
  );
  expect(claimed.map((f) => f.id)).toEqual([purged.id]);
  expect(await api.confirm(actor, purged.id, now)).toBe(false);
  expect(await api.find(actor, purged.id)).toBeNull();
  expect(
    await verificationRepository(db).claim(tenant.company, purged.id, ids.newId(), now, now),
  ).toBeNull();
  expect(await repo.complete(tenant.company, purged.id, 'abandoned', ids.newId(), now)).toBe(false);
  await storage.remove(purged.key);
  expect(await repo.complete(tenant.company, purged.id, 'abandoned', lease, now)).toBe(true);
  expect(await repo.complete(tenant.company, purged.id, 'abandoned', lease, now)).toBe(false);
  expect(await auditCount(purged.id)).toBe(1);
});
it('retention RLS refuses foreign reads/updates and does no foreign storage IO', async () => {
  const f = await file({ tenant: TENANT.B });
  expect(await cleanup().execute(tenant.company, 'abandoned')).toBe(0);
  expect(fake.objects.has(f.key)).toBe(true);
  const rows = await db.withTenant(tenant.company, (tx) =>
    tx.execute(sql`UPDATE file_objects SET purged_at = now(), purge_started_at = now(), confirmed_at = now(), rejected_at = now()
    WHERE company_id = ${TENANT.B.company} AND id = ${f.id} RETURNING id`),
  );
  expect(Array.from(rows)).toEqual([]);
});
it('upload creation records a durable id-only schedule event; failed creation rolls it back', async () => {
  const api = createFileRepository(db, ids),
    id = ids.newId(),
    actor = { companyId: tenant.company, userId: USER };
  const record = {
    id,
    businessId: tenant.business,
    branchId: null,
    createdBy: USER,
    requiredPermission: 'read:files:business',
    stagingKey: buildObjectKey(tenant.company, tenant.business, id, 'staging'),
    contentType: 'application/pdf',
    sizeBytes: 10,
    ownerModule: 'staff',
    ownerEntityId: id,
    createdAt: now,
  };
  await api.create(actor, record);
  const events =
    await owner`SELECT event_type,payload FROM outbox WHERE company_id = ${tenant.company} AND aggregate_id = ${id}`;
  expect(Array.from(events)).toEqual([
    { event_type: 'FileUploadRequested', payload: { fileId: id } },
  ]);
  const badId = ids.newId();
  await expect(
    api.create(actor, {
      ...record,
      id: badId,
      businessId: TENANT.B.business,
      stagingKey: 'synthetic-invalid-business',
    }),
  ).rejects.toThrow('FILE_PERSISTENCE_FAILED');
  expect(Array.from(await owner`SELECT id FROM outbox WHERE aggregate_id = ${badId}`)).toEqual([]);
});

it('a crash after S3 deletion retries missing-object deletion before committing one audit', async () => {
  const f = await file(),
    repo = retentionRepository(db, ids);
  let fail = true;
  const useCase = new CleanupFiles(
    {
      ...repo,
      complete: async (...args) => {
        if (fail) throw new Error('FILE_RETENTION_RETRY');
        return repo.complete(...args);
      },
    },
    storage,
    ids,
    { now: () => now },
  );
  await expect(useCase.execute(tenant.company, 'abandoned')).rejects.toThrow(
    'FILE_RETENTION_RETRY',
  );
  expect(fake.objects.has(f.key)).toBe(false);
  expect(await auditCount(f.id)).toBe(0);
  fail = false;
  now = new Date(now.getTime() + 20 * 60 * 1000);
  expect(await useCase.execute(tenant.company, 'abandoned')).toBe(1);
  expect(await useCase.execute(tenant.company, 'abandoned')).toBe(0);
  expect(await auditCount(f.id)).toBe(1);
});
