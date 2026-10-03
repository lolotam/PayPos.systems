import { CleanupArtifacts } from '../../../../../worker/src/modules/files/use-cases/cleanup-artifacts/cleanup-artifacts.ts';
import { artifactRepository } from '../../../../../worker/src/modules/files/persistence/artifact.repository.ts';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { createDatabase, type Database } from '@pospay/db';
import { createS3Storage } from '@pospay/storage';
import { fakeS3, fakeCredentials } from '../../../../../../packages/storage/test/fake-s3.ts';
import { startHarness, type Harness } from '../../../../test/harness.ts';
import { VerifyUpload } from '../../../../../worker/src/modules/files/use-cases/verify-upload/verify-upload.ts';
import { verificationRepository } from '../../../../../worker/src/modules/files/persistence/verification.repository.ts';
import { verificationStorage } from '../../../../../worker/src/modules/files/persistence/verification-storage.adapter.ts';

let fake: Awaited<ReturnType<typeof fakeS3>>, storage: ReturnType<typeof createS3Storage>;
let h: Harness, db: Database, verifier: VerifyUpload;
let cookie: string,
  company: string,
  business: string,
  readerCookie: string,
  readerId: string,
  readerMembership: string;
const ids = systemUuidV7(),
  jobs: { companyId: string; fileId: string }[] = [];
const policy = { 'application/pdf': 10000, 'image/png': 10000 };
const pdf = Buffer.from('%PDF-1.7\nsynthetic fixture\n%%EOF');
const input = () => ({
  owner_module: 'staff',
  owner_entity_id: ids.newId(),
  content_type: 'application/pdf',
  size_bytes: pdf.length,
  required_permission: 'read:files:business',
});
beforeAll(async () => {
  fake = await fakeS3();
  storage = createS3Storage({
    endpoint: fake.endpoint,
    region: 'auto',
    bucket: 'private',
    ...fakeCredentials,
  });
  h = await startHarness({
    files: {
      storage,
      policy,
      queue: {
        enqueue: async (companyId, fileId) => {
          jobs.push({ companyId, fileId });
        },
      },
    },
  });
  cookie = await h.signedInOperator('files-owner@synthetic.invalid');
  company = await h.onboard(cookie, 'Synthetic files');
  business = (
    await h.send('POST', '/v1/businesses', {
      cookie,
      company,
      key: 'files-business',
      body: { vertical_type: 'salon', name_en: 'Synthetic' },
    })
  ).body['id'] as string;
  readerCookie = await h.signedInOperator('files-reader@synthetic.invalid');
  const [user] =
    await h.owner`SELECT id FROM "user" WHERE email = 'files-reader@synthetic.invalid'`;
  readerId = user?.['id'] as string;
  readerMembership = ids.newId();
  await h.owner`INSERT INTO memberships (company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${company},${readerMembership},${readerId},'01920000-0000-7000-8000-00000000010d','global','BUSINESS',${business})`;
  db = createDatabase({ url: h.urls.app, ids });
  verifier = new VerifyUpload(
    verificationRepository(db),
    verificationStorage(storage, policy),
    ids,
    { now: () => new Date() },
    new CleanupArtifacts(artifactRepository(db, ids), storage, ids, { now: () => new Date() }),
  );
});
beforeEach(async () => {
  await h.owner`UPDATE memberships SET ends_at = NULL WHERE company_id = ${company} AND id = ${readerMembership}`;
  await h.owner`DELETE FROM permission_overrides WHERE company_id = ${company} AND membership_id = ${readerMembership}`;
});
afterAll(async () => {
  await db?.close();
  await h?.close();
  storage?.close();
  await fake?.close();
});

async function upload(overrides: object = {}) {
  const result = await h.send('POST', `/v1/businesses/${business}/files/uploads`, {
    cookie,
    company,
    body: { ...input(), ...overrides },
  });
  expect(result.status).toBe(201);
  expect(result.body).not.toHaveProperty('storage_key');
  expect(result.body['expires_in']).toBe(120);
  return { id: result.body['id'] as string, url: result.body['upload_url'] as string };
}
async function ready() {
  const ticket = await upload();
  expect(
    (
      await fetch(ticket.url, {
        method: 'PUT',
        headers: { 'content-type': 'application/pdf' },
        body: pdf,
      })
    ).status,
  ).toBe(200);
  const confirmation = await h.send('POST', `/v1/files/${ticket.id}/confirm`, { cookie, company });
  expect(confirmation.status).toBe(202);
  expect(jobs.at(-1)).toEqual({ companyId: company, fileId: ticket.id });
  await verifier.execute(company, ticket.id);
  return ticket;
}
async function grantRead(expiresAt: Date | null = null) {
  await h.owner`INSERT INTO permission_overrides (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by,expires_at)
    VALUES (${company},${ids.newId()},${readerMembership},'read:files:business','ALLOW','BUSINESS',${business},'synthetic grant',${readerId},${expiresAt})`;
}

export {
  fake,
  storage,
  h,
  db,
  verifier,
  cookie,
  company,
  business,
  readerCookie,
  readerId,
  readerMembership,
  ids,
  jobs,
  policy,
  pdf,
  input,
  upload,
  ready,
  grantRead,
};
