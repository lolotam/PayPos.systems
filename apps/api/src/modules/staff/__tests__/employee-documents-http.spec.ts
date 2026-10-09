import { employeeDocumentsView } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  documentFile,
  documentIds,
  documentsFixture,
  type DocumentsFixture,
} from './documents.fixture.ts';

let f: DocumentsFixture;
let businessManager: string;
let typeId: string;
let ownerUser: string;
beforeAll(async () => {
  f = await documentsFixture();
  const [owner] = await f.h.owner`SELECT user_id FROM memberships WHERE company_id=${f.company}
    AND role_id='01920000-0000-7000-8000-000000000101' AND role_owner_key='global'
    AND scope_type='COMPANY' AND scope_id=${f.company} ORDER BY id LIMIT 1`;
  ownerUser = owner?.['user_id'] as string;
  const [role] = await f.h
    .owner`SELECT id FROM roles WHERE code='business_manager' AND company_id IS NULL`;
  businessManager = role?.['id'] as string;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const send = (method: 'GET' | 'POST', path: string, body?: object, key?: string) =>
  f.h.send(method, path, {
    cookie: f.cookie,
    company: f.company,
    ...(key === undefined ? {} : { key }),
    ...(body === undefined ? {} : { body }),
  });
const body = (fileId: string) => ({
  type_code: 'civil_id',
  file_id: fileId,
  expires_on: '2027-01-01',
});
async function asBusinessManager() {
  await f.h.owner`UPDATE memberships SET role_id=${businessManager},role_owner_key='global',
    scope_type='BUSINESS',scope_id=${f.business} WHERE company_id=${f.company} AND id=${f.memberId}`;
}
async function override(
  permission: string,
  effect: string,
  scope = 'BUSINESS',
  scopeId = f.business,
) {
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${f.company},${documentIds.newId()},${f.memberId},${permission},${effect},${scope},${scopeId},'Synthetic document access',${ownerUser})`;
}

it('the owner records over HTTP with a mandatory key and lists the current documents with status', async () => {
  const fileId = await documentFile(f);
  expect((await send('POST', f.path, body(fileId))).body['code']).toBe('IDEMPOTENCY_KEY_REQUIRED');
  const recorded = await send('POST', f.path, body(fileId), documentIds.newId());
  expect(recorded.status).toBe(200);
  const view = await send('GET', f.path);
  expect(view.status).toBe(200);
  const parsed = employeeDocumentsView.parse(view.body);
  expect(parsed).toMatchObject({
    can_manage: true,
    items: [{ id: recorded.body['id'], status: 'VALID' }],
  });
  expect(parsed.types.map((t) => t.code).sort()).toEqual(['civil_id', 'passport', 'work_contract']);
});

it('an explicitly granted business manager reaches only their own business; every other employee looks unknown', async () => {
  await override('read:files:business', 'ALLOW');
  await override('manage:files:business', 'ALLOW');
  await asBusinessManager();
  expect(employeeDocumentsView.parse((await send('GET', f.path)).body).can_manage).toBe(true);
  const missing = await send(
    'GET',
    `/v1/businesses/${f.business}/employees/${documentIds.newId()}/documents`,
  );
  const foreign = await send(
    'GET',
    `/v1/businesses/${f.secondBusiness}/employees/${f.employee.id}/documents`,
  );
  expect(missing.status).toBe(404);
  expect(foreign.body).toEqual(missing.body);
  await override('manage:files:business', 'DENY');
  expect(employeeDocumentsView.parse((await send('GET', f.path)).body).can_manage).toBe(false);
  const refused = await send('POST', f.path, body(await documentFile(f)), documentIds.newId());
  expect(refused.status).toBe(404);
  expect(refused.body).toEqual(missing.body);
  await override('read:files:business', 'DENY');
  expect((await send('GET', f.path)).body).toEqual(missing.body);
  await f.h
    .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.memberId}
    AND permission_code IN ('read:files:business','manage:files:business')`;
});

it('document types need manage:document-types:company: a business manager only by personal company ALLOW', async () => {
  await override('read:files:business', 'ALLOW');
  await asBusinessManager();
  expect((await send('GET', '/v1/document-types')).status).toBe(403);
  await override('manage:document-types:company', 'ALLOW', 'COMPANY', f.company);
  const list = await send('GET', '/v1/document-types');
  expect(list.status).toBe(200);
  const created = await send(
    'POST',
    '/v1/document-types',
    { name_en: ' Visa ', alert_days: 10, requires_expiry: true },
    documentIds.newId(),
  );
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({ name_en: 'Visa', active: true, revision: 1 });
  expect(String(created.body['code'])).toMatch(/^custom_[0-9a-f]{32}$/);
  typeId = created.body['id'] as string;
});

it('type revisions: edit, stale edit, deactivate, reactivate, unknown id, each audited', async () => {
  const id = typeId;
  const patch = (expected: number) =>
    f.h.app.inject({
      method: 'PATCH',
      url: `/v1/document-types/${id}`,
      headers: {
        cookie: f.cookie,
        'x-company-id': f.company,
        'idempotency-key': documentIds.newId(),
      },
      payload: {
        name_en: 'Work visa',
        alert_days: 20,
        requires_expiry: false,
        expected_revision: expected,
      },
    });
  expect((await patch(1)).json()).toMatchObject({ name_en: 'Work visa', revision: 2 });
  expect((await patch(1)).json()['code']).toBe('DOCUMENT_TYPE_REVISION_CONFLICT');
  const off = await send(
    'POST',
    `/v1/document-types/${id}/deactivate`,
    { expected_revision: 2 },
    documentIds.newId(),
  );
  expect(off.body).toMatchObject({ active: false, revision: 3 });
  const on = await send(
    'POST',
    `/v1/document-types/${id}/reactivate`,
    { expected_revision: 3 },
    documentIds.newId(),
  );
  expect(on.body).toMatchObject({ active: true, revision: 4 });
  const missing = await send(
    'POST',
    `/v1/document-types/${documentIds.newId()}/deactivate`,
    { expected_revision: 1 },
    documentIds.newId(),
  );
  expect(missing.status).toBe(404);
  const audits = await f.h
    .owner`SELECT action FROM audit_log WHERE company_id=${f.company} AND entity_id=${id} ORDER BY id`;
  expect(audits.map((a) => a['action'])).toEqual([
    'document_type.create',
    'document_type.update',
    'document_type.deactivate',
    'document_type.reactivate',
  ]);
});

it('the staff feature gate applies after access on both document routes', async () => {
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES (${f.company},'staff',false,'Synthetic feature decision',${f.userId})`;
  expect((await send('GET', f.path)).body['code']).toBe('FEATURE_DISABLED');
  expect((await send('GET', '/v1/document-types')).body['code']).toBe('FEATURE_DISABLED');
});
