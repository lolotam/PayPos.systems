import { afterAll, beforeAll, expect, it } from 'vitest';
import { employeeDocumentsView } from '@pospay/contracts';
import { OWNER_GRANTED_PERMISSIONS, SYSTEM_ROLES } from '@pospay/db';
import { newMember, revoke, save } from './permissions-screen.fixture.ts';
import {
  documentsOwnerFixture,
  documentActor,
  documentPath,
  documentRequest,
  readyUpload,
  requestUpload,
  recordDocument,
  grantDocumentPermission,
  closeDocumentFixture,
  type DocumentsOwnerFixture,
  type DocumentActor,
} from './documents-owner-default.fixture.ts';

let f: DocumentsOwnerFixture;
let general: DocumentActor,
  business: DocumentActor,
  accountant: DocumentActor,
  cashier: DocumentActor;
let existingFile: string;
beforeAll(async () => {
  f = await documentsOwnerFixture();
  general = await documentActor(f, 'general_manager');
  business = await documentActor(f, 'business_manager');
  accountant = await documentActor(f, 'accountant');
  cashier = await documentActor(f, 'cashier');
  existingFile = await readyUpload(f, f.cookie);
  expect((await recordDocument(f, f.cookie, existingFile)).status).toBe(200);
  await f.h.owner`UPDATE file_objects SET created_at='2026-10-01T00:00:00Z'
    WHERE company_id=${f.company} AND id=${existingFile}`;
});
afterAll(() => closeDocumentFixture(f));

it('ODOC-01: owner lists, opens and uploads employee documents', async () => {
  const listed = await documentRequest(f, f.cookie, 'GET', documentPath(f));
  expect(listed.status).toBe(200);
  const view = employeeDocumentsView.parse(listed.body);
  expect(view.can_manage).toBe(true);
  expect(view.items).toHaveLength(1);
  const opened = await documentRequest(f, f.cookie, 'POST', `/v1/files/${existingFile}/download`);
  expect(opened.status).toBe(200);
  expect((await fetch(opened.body['download_url'] as string)).status).toBe(200);
  expect((await recordDocument(f, f.cookie, await readyUpload(f, f.cookie))).status).toBe(200);
});

for (const [scenario, actor] of [
  ['ODOC-02', () => general],
  ['ODOC-03', () => business],
] as const) {
  it(`${scenario}: manager defaults cannot list, record, download old files or upload`, async () => {
    const cookie = actor().cookie;
    expect((await documentRequest(f, cookie, 'GET', documentPath(f))).status).toBe(404);
    expect((await recordDocument(f, cookie, existingFile)).status).toBe(404);
    expect(
      (await documentRequest(f, cookie, 'POST', `/v1/files/${existingFile}/download`)).status,
    ).toBe(404);
    expect((await requestUpload(f, cookie)).status).toBe(403);
  });
}
it('ODOC-04: the general manager cannot list or create document types by default', async () => {
  expect((await documentRequest(f, general.cookie, 'GET', '/v1/document-types')).status).toBe(403);
  expect(
    (
      await documentRequest(f, general.cookie, 'POST', '/v1/document-types', {
        name_en: 'Synthetic denied type',
        alert_days: 10,
        requires_expiry: true,
      })
    ).status,
  ).toBe(403);
});

it('ODOC-05: owner-granted accountant read is scoped and cannot upload; manage enables recording', async () => {
  const read = await grantDocumentPermission(f, accountant.membership, 'read:files:business');
  const listed = await documentRequest(f, accountant.cookie, 'GET', documentPath(f));
  expect(listed.status).toBe(200);
  const view = employeeDocumentsView.parse(listed.body);
  expect(view.can_manage).toBe(false);
  expect(view.items).toHaveLength(1);
  expect(
    (await documentRequest(f, accountant.cookie, 'POST', `/v1/files/${existingFile}/download`))
      .status,
  ).toBe(200);
  expect((await requestUpload(f, accountant.cookie)).status).toBe(403);
  expect((await documentRequest(f, accountant.cookie, 'GET', documentPath(f, true))).status).toBe(
    404,
  );
  const manage = await grantDocumentPermission(f, accountant.membership, 'manage:files:business');
  expect(
    (await recordDocument(f, accountant.cookie, await readyUpload(f, accountant.cookie))).status,
  ).toBe(200);
  expect(
    (await requestUpload(f, accountant.cookie, undefined, undefined, f.otherBusiness)).status,
  ).toBe(403);
  expect((await revoke(f, accountant.membership, manage)).status).toBe(200);
  expect((await revoke(f, accountant.membership, read)).status).toBe(200);
  expect((await documentRequest(f, accountant.cookie, 'GET', documentPath(f))).status).toBe(404);
  expect(
    (await documentRequest(f, accountant.cookie, 'POST', `/v1/files/${existingFile}/download`))
      .status,
  ).toBe(404);
});

it('ODOC-06: owner-granted general manager creates document types', async () => {
  await grantDocumentPermission(f, general.membership, 'manage:document-types:company', 'COMPANY');
  const created = await documentRequest(f, general.cookie, 'POST', '/v1/document-types', {
    name_en: 'Synthetic delegated type',
    alert_days: 20,
    requires_expiry: true,
  });
  expect(created.status).toBe(201);
});

it('ODOC-07: a delegated business manager cannot grant files onward; DENY and revoke remain permitted', async () => {
  for (const permission of [
    'read:files:business',
    'manage:files:business',
    'manage:memberships:business',
  ])
    await grantDocumentPermission(f, business.membership, permission);
  const path = `/v1/businesses/${f.business}/permissions/memberships/${cashier.membership}/overrides`;
  const terms = {
    permission_code: 'read:files:business',
    effect: 'ALLOW',
    scope_type: 'BUSINESS',
    scope_id: f.business,
    reason: 'Synthetic onward grant',
    expires_at: null,
  };
  const before = await f.h
    .owner`SELECT id FROM permission_overrides WHERE company_id=${f.company} ORDER BY id`;
  const denied = await documentRequest(f, business.cookie, 'POST', path, terms);
  expect(denied.status).toBe(403);
  expect(denied.body).toMatchObject({
    code: 'PERMISSION_OWNER_ONLY',
    message_ar: 'صاحب الشركة فقط يقدر يمنح الصلاحية دي',
    message_en: 'Only the company owner can grant this permission',
  });
  expect(
    await f.h.owner`SELECT id FROM permission_overrides WHERE company_id=${f.company} ORDER BY id`,
  ).toEqual(before);
  const decision = await documentRequest(f, business.cookie, 'POST', path, {
    ...terms,
    effect: 'DENY',
  });
  expect(decision.status).toBe(201);
  expect(
    (
      await documentRequest(f, business.cookie, 'POST', `${path}/${decision.body['id']}/revoke`, {
        reason: 'Synthetic deny revoked',
      })
    ).status,
  ).toBe(200);
});

it.each(SYSTEM_ROLES)(
  'ODOC-07: owner can grant the three codes to $code, except Device',
  async ({ code }) => {
    const member = await newMember(f, code);
    for (const permission_code of OWNER_GRANTED_PERMISSIONS) {
      const result = await save(f, member, { permission_code });
      expect(result.status).toBe(code === 'device' ? 403 : 201);
      if (code === 'device') expect(result.body['code']).toBe('PERMISSION_ROLE_FORBIDDEN');
    }
  },
);
