import { afterAll, beforeAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import {
  createS3Storage,
  buildObjectKey,
  FILE_UPLOAD_POLICY,
  type ObjectStorage,
} from '@pospay/storage';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { seedTwoTenants, USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { PROVISIONAL_PLAN_ID } from '../../../../../../packages/db/src/seed.ts';
import { fakeS3, fakeCredentials } from '../../../../../../packages/storage/test/fake-s3.ts';
import { artifactRepository } from '../persistence/artifact.repository.ts';
import { verificationRepository } from '../persistence/verification.repository.ts';
import { verificationStorage } from '../persistence/verification-storage.adapter.ts';
import { CleanupArtifacts } from '../use-cases/cleanup-artifacts/cleanup-artifacts.ts';
import { VerifyUpload } from '../use-cases/verify-upload/verify-upload.ts';

export const ids = systemUuidV7(),
  pdf = Buffer.from('%PDF-1.7\nsynthetic cleanup\n%%EOF');
export let testDb: TestDatabase, db: Database, owner: postgres.Sql;
export let fake: Awaited<ReturnType<typeof fakeS3>>, storage: ObjectStorage;
export let company: string, business: string, now: Date;
export const clock = { now: () => now };
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
  company = ids.newId();
  business = ids.newId();
  await owner`INSERT INTO companies(id,owner_user_id,plan_id,name_en) VALUES (${company},${USER},${PROVISIONAL_PLAN_ID},'Synthetic artifacts')`;
  await owner`INSERT INTO businesses(company_id,id,vertical_type,name_en) VALUES (${company},${business},'salon','Synthetic artifacts')`;
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  storage?.close();
  await fake?.close();
  await testDb?.drop();
});
export function advance(ms: number) {
  now = new Date(now.getTime() + ms);
}
export function cleanup(target: Pick<ObjectStorage, 'remove'> = storage) {
  return new CleanupArtifacts(artifactRepository(db, ids), target, ids, clock);
}
export function verifier(
  overrides: Partial<ReturnType<typeof verificationRepository>> = {},
  target = storage,
  artifacts = cleanup(),
) {
  return new VerifyUpload(
    { ...verificationRepository(db), ...overrides },
    verificationStorage(target, FILE_UPLOAD_POLICY),
    ids,
    clock,
    artifacts,
  );
}
export async function pendingFile() {
  const id = ids.newId(),
    key = buildObjectKey(company, business, id, 'staging');
  await owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,staging_key,content_type,size_bytes,required_permission,created_by,created_at)
    VALUES (${company},${id},${business},'staff',${id},${key},'application/pdf',${pdf.length},'read:files:business',${USER},${now})`;
  const url = await storage.presignUpload(key, 'application/pdf', pdf.length);
  await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: pdf });
  return { id, key, url };
}
export async function ownedCandidate(id: string, leaseId = ids.newId()) {
  const repo = verificationRepository(db),
    until = new Date(now.getTime() + 120000);
  await repo.claim(company, id, leaseId, now, until);
  const candidateId = ids.newId(),
    key = buildObjectKey(company, business, candidateId, 'verified');
  await repo.reserve(company, id, leaseId, candidateId, key, now, until);
  return { candidateId, key, leaseId, until };
}
export async function auditCount(id: string) {
  const [row] =
    await owner`SELECT count(*)::int AS n FROM audit_log WHERE company_id = ${company} AND entity_id = ${id} AND action = 'artifact.deleted'`;
  return row?.['n'];
}
