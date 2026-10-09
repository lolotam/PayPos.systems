import { expect } from 'vitest';
import { createS3Storage, FILE_UPLOAD_POLICY } from '@pospay/storage';
import { fakeS3, fakeCredentials } from '../../../../../../packages/storage/test/fake-s3.ts';
import {
  permissionFixture,
  newHeldMember,
  save,
  type PermissionFixture,
} from './permissions-screen.fixture.ts';

export const documentPdf = Buffer.from('%PDF-1.7\nSynthetic employee document\n%%EOF');

export async function documentsOwnerFixture() {
  const fake = await fakeS3();
  const storage = createS3Storage({
    endpoint: fake.endpoint,
    region: 'auto',
    bucket: 'private',
    ...fakeCredentials,
  });
  const f = await permissionFixture({
    files: { storage, policy: FILE_UPLOAD_POLICY, queue: { enqueue: async () => undefined } },
  });
  const employees = await seedDocumentEmployees(f);
  return { ...f, ...employees, fake, storage };
}
export type DocumentsOwnerFixture = Awaited<ReturnType<typeof documentsOwnerFixture>>;

async function seedDocumentEmployees(f: PermissionFixture) {
  const otherBranch = f.ids.newId();
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES (${f.company},${otherBranch},${f.otherBusiness},'Synthetic other branch')`;
  const employee = f.ids.newId(),
    otherEmployee = f.ids.newId();
  for (const [id, business, branch] of [
    [employee, f.business, f.branch],
    [otherEmployee, f.otherBusiness, otherBranch],
  ] as const)
    await f.h
      .owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,role_code,hire_date)
      VALUES (${f.company},${id},${business},${branch},'Synthetic document employee','staff','2026-01-01')`;
  for (const code of ['civil_id', 'work_contract'])
    await f.h
      .owner`INSERT INTO document_types(company_id,id,code,name_en,alert_days,requires_expiry)
      VALUES (${f.company},${f.ids.newId()},${code},${code},30,true) ON CONFLICT DO NOTHING`;
  return { employee, otherEmployee };
}

export async function documentActor(f: PermissionFixture, code: string) {
  const cookie = await f.h.signedInOperator(`documents-${code}@example.test`);
  const [user] = await f.h
    .owner`SELECT id FROM "user" WHERE email=${`documents-${code}@example.test`}`;
  const userId = user?.['id'] as string;
  const membership = await newHeldMember(f, { userId }, code);
  if (['business_manager', 'cashier', 'device'].includes(code))
    await f.h.owner`UPDATE memberships SET scope_type='BUSINESS',scope_id=${f.business}
      WHERE company_id=${f.company} AND id=${membership}`;
  return { cookie, userId, membership };
}
export type DocumentActor = Awaited<ReturnType<typeof documentActor>>;

export function documentPath(f: DocumentsOwnerFixture, other = false) {
  return `/v1/businesses/${other ? f.otherBusiness : f.business}/employees/${other ? f.otherEmployee : f.employee}/documents`;
}
export function documentRequest(
  f: PermissionFixture,
  cookie: string,
  method: 'GET' | 'POST',
  path: string,
  body?: object,
) {
  return f.h.send(method, path, {
    cookie,
    company: f.company,
    key: f.ids.newId(),
    ...(body === undefined ? {} : { body }),
  });
}
export function requestUpload(
  f: DocumentsOwnerFixture,
  cookie: string,
  bytes = documentPdf,
  contentType = 'application/pdf',
  business = f.business,
) {
  return documentRequest(f, cookie, 'POST', `/v1/businesses/${business}/files/uploads`, {
    owner_module: 'staff',
    owner_entity_id: contentType === 'application/pdf' ? f.employee : business,
    content_type: contentType,
    size_bytes: bytes.length,
    required_permission: 'read:files:business',
  });
}
export async function readyUpload(
  f: DocumentsOwnerFixture,
  cookie: string,
  bytes = documentPdf,
  contentType = 'application/pdf',
) {
  const ticket = await requestUpload(f, cookie, bytes, contentType);
  expect(ticket.status).toBe(201);
  const uploaded = await fetch(ticket.body['upload_url'] as string, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: bytes,
  });
  expect(uploaded.status).toBe(200);
  const id = ticket.body['id'] as string;
  expect((await documentRequest(f, cookie, 'POST', `/v1/files/${id}/confirm`)).status).toBe(202);
  // اختبارات التفويض تحاكي اكتمال العامل؛ فحص المحتوى نفسه تغطيه اختبارات files.
  const key = `${f.company}/${f.business}/${id}/verified`;
  f.fake.objects.set(key, { bytes, type: contentType });
  await f.h.owner`UPDATE file_objects SET status='READY',storage_key=${key}
    WHERE company_id=${f.company} AND id=${id}`;
  const [file] = await f.h
    .owner`SELECT status FROM file_objects WHERE company_id=${f.company} AND id=${id}`;
  expect(file?.['status']).toBe('READY');
  return id;
}
export function recordDocument(f: DocumentsOwnerFixture, cookie: string, fileId: string) {
  return documentRequest(f, cookie, 'POST', documentPath(f), {
    type_code: 'civil_id',
    file_id: fileId,
    expires_on: '2027-01-01',
  });
}
export async function grantDocumentPermission(
  f: PermissionFixture,
  membership: string,
  permission_code: string,
  scope_type: 'BUSINESS' | 'COMPANY' = 'BUSINESS',
) {
  const result = await save(f, membership, {
    permission_code,
    scope_type,
    scope_id: scope_type === 'BUSINESS' ? f.business : f.company,
  });
  expect(result.status).toBe(201);
  return result.body['id'] as string;
}
export async function closeDocumentFixture(f: DocumentsOwnerFixture | undefined) {
  await f?.db.close();
  await f?.h.close();
  f?.storage.close();
  await f?.fake.close();
}
