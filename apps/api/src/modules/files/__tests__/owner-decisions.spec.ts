import { CleanupArtifacts } from '../../../../../worker/src/modules/files/use-cases/cleanup-artifacts/cleanup-artifacts.ts';
import { artifactRepository } from '../../../../../worker/src/modules/files/persistence/artifact.repository.ts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createS3Storage, FILE_UPLOAD_POLICY } from '@pospay/storage';
import { fakeS3, fakeCredentials } from '../../../../../../packages/storage/test/fake-s3.ts';
import { startHarness, type Harness } from '../../../../test/harness.ts';
import { VerifyUpload } from '../../../../../worker/src/modules/files/use-cases/verify-upload/verify-upload.ts';
import { verificationRepository } from '../../../../../worker/src/modules/files/persistence/verification.repository.ts';
import { verificationStorage } from '../../../../../worker/src/modules/files/persistence/verification-storage.adapter.ts';

const ids = systemUuidV7(),
  pdf = Buffer.from('%PDF-1.7\nsynthetic owner decision\n%%EOF');
let h: Harness,
  db: Database,
  fake: Awaited<ReturnType<typeof fakeS3>>,
  storage: ReturnType<typeof createS3Storage>;
let company: string, business: string, otherBusiness: string, cookie: string, ownerUser: string;
const actors: { role: string; cookie: string; membership: string; scope: string }[] = [];
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
    files: { storage, policy: FILE_UPLOAD_POLICY, queue: { enqueue: async () => undefined } },
  });
  cookie = await h.signedInOperator('files-policy-owner@synthetic.invalid');
  company = await h.onboard(cookie, 'Synthetic owner decision');
  const [user] =
    await h.owner`SELECT id FROM "user" WHERE email = 'files-policy-owner@synthetic.invalid'`;
  ownerUser = user?.['id'] as string;
  for (const name of ['Synthetic own business', 'Synthetic other business']) {
    const result = await h.send('POST', '/v1/businesses', {
      cookie,
      company,
      key: ids.newId(),
      body: { vertical_type: 'salon', name_en: name },
    });
    expect(result.status).toBe(201);
    if (business === undefined) business = result.body['id'] as string;
    else otherBusiness = result.body['id'] as string;
  }
  const [membership] =
    await h.owner`SELECT id FROM memberships WHERE company_id = ${company} AND user_id = ${ownerUser}`;
  actors.push({
    role: 'owner',
    cookie,
    membership: membership?.['id'] as string,
    scope: 'COMPANY',
  });
  for (const role of ['general_manager', 'business_manager']) {
    const email = `files-${role}@synthetic.invalid`,
      memberCookie = await h.signedInOperator(email),
      memberId = ids.newId();
    const [u] = await h.owner`SELECT id FROM "user" WHERE email = ${email}`;
    const [r] = await h.owner`SELECT id FROM roles WHERE code = ${role} AND owner_key = 'global'`;
    const scope = role === 'business_manager' ? 'BUSINESS' : 'COMPANY';
    await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
      VALUES (${company},${memberId},${u?.['id']},${r?.['id']},'global',${scope},${scope === 'BUSINESS' ? business : company})`;
    actors.push({ role, cookie: memberCookie, membership: memberId, scope });
  }
  db = createDatabase({ url: h.urls.app, ids });
});
afterAll(async () => {
  await db?.close();
  await h?.close();
  storage?.close();
  await fake?.close();
});
it('uses PR 7a file role bundles and rejects other types/oversize and broader staff read permissions', async () => {
  expect(
    Array.from(
      await h.owner`SELECT permission_code FROM role_permissions WHERE permission_code IN ('manage:files:business','read:files:business')`,
    ),
  ).toHaveLength(6);
  for (const patch of [
    { content_type: 'image/webp' },
    { content_type: 'text/plain' },
    { size_bytes: 10 * 1024 * 1024 + 1 },
  ])
    expect(
      (
        await h.send('POST', `/v1/businesses/${business}/files/uploads`, {
          cookie,
          company,
          body: { ...input(), ...patch },
        })
      ).status,
    ).toBe(400);
  expect(
    (
      await h.send('POST', `/v1/businesses/${business}/files/uploads`, {
        cookie,
        company,
        body: { ...input(), required_permission: 'read:businesses:company' },
      })
    ).status,
  ).toBe(403);
});
it('owner/GM read and upload across own company; BM has only own-business access using stored permission', async () => {
  const verifier = new VerifyUpload(
    verificationRepository(db),
    verificationStorage(storage, FILE_UPLOAD_POLICY),
    ids,
    { now: () => new Date() },
    new CleanupArtifacts(artifactRepository(db, ids), storage, ids, { now: () => new Date() }),
  );
  for (const actor of actors) {
    const own = await h.send('POST', `/v1/businesses/${business}/files/uploads`, {
      cookie: actor.cookie,
      company,
      body: input(),
    });
    expect(own.status).toBe(201);
    const other = await h.send('POST', `/v1/businesses/${otherBusiness}/files/uploads`, {
      cookie: actor.cookie,
      company,
      body: input(),
    });
    expect(other.status).toBe(actor.role === 'business_manager' ? 403 : 201);
  }
  const ticket = await h.send('POST', `/v1/businesses/${otherBusiness}/files/uploads`, {
    cookie,
    company,
    body: input(),
  });
  await fetch(ticket.body['upload_url'] as string, {
    method: 'PUT',
    headers: { 'content-type': 'application/pdf' },
    body: pdf,
  });
  expect(
    (await h.send('POST', `/v1/files/${ticket.body['id']}/confirm`, { cookie, company })).status,
  ).toBe(202);
  await verifier.execute(company, ticket.body['id'] as string);
  for (const actor of actors)
    expect(
      (
        await h.send('POST', `/v1/files/${ticket.body['id']}/download`, {
          cookie: actor.cookie,
          company,
        })
      ).status,
    ).toBe(actor.role === 'business_manager' ? 404 : 200);
});
